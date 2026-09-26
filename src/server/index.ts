import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { prisma } from './db.js';
import { HttpError } from './http.js';
import { attachRealtime } from './realtime.js';
import { resumeAutoPlay } from './services/declare-service.js';
import { gameRoutes } from './routes/games.js';
import { groupRoutes } from './routes/groups.js';
import { joinRoutes } from './routes/join.js';
import { meRoutes } from './routes/me.js';
import { sessionRoutes } from './routes/sessions.js';

const here = dirname(fileURLToPath(import.meta.url));
// In production the bundle lives in dist/server and the SPA in dist/web.
const webRoot = [join(here, '../web'), join(here, '../../dist/web')].find((p) => existsSync(join(p, 'index.html')));

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });

  await app.register(fastifyCookie);

  // Accept empty JSON bodies (e.g. POST /close) instead of rejecting them.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'Invalid JSON'), undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = err.statusCode;
    if (status && status < 500) return reply.status(status).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong' });
  });

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  await app.register(meRoutes);
  await app.register(joinRoutes);
  await app.register(groupRoutes);
  await app.register(sessionRoutes);
  await app.register(gameRoutes);

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    // SPA fallback: any non-API GET serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  return app;
}

const app = await buildApp();
attachRealtime(app.server);
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
await resumeAutoPlay();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
