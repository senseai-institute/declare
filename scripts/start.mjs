// Production entry point: check config, apply migrations (retrying while the
// database comes up — Railway's private network can take a few seconds), then
// start the server. Every failure prints what to do about it.
import { spawnSync } from 'node:child_process';

const log = (msg) => console.log(`[start] ${msg}`);
const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    '\n✗ DATABASE_URL is not set, so Declare has no database.\n' +
      '  On Railway: add a PostgreSQL database to the project, then open this\n' +
      '  service → Variables → New Variable → Add Reference → DATABASE_URL from Postgres.\n' +
      '  (Raw value: ${{Postgres.DATABASE_URL}})\n',
  );
  process.exit(1);
}

let where = 'unknown host';
try {
  const u = new URL(url);
  where = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch {
  console.error('\n✗ DATABASE_URL is not a valid URL. It should look like postgresql://user:password@host:5432/dbname\n');
  process.exit(1);
}
log(`Node ${process.version}, database at ${where}, port ${process.env.PORT ?? 3000}`);

const attempts = 10;
for (let i = 1; i <= attempts; i++) {
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
  if (r.status === 0) break;
  if (i === attempts) {
    console.error(
      `\n✗ Could not apply database migrations after ${attempts} tries.\n` +
        '  Check that the Postgres service is running and that DATABASE_URL on this\n' +
        '  service references it (not a copy of an old value).\n',
    );
    process.exit(1);
  }
  const wait = Math.min(2000 * i, 10000);
  log(`Database not ready (try ${i}/${attempts}); retrying in ${wait / 1000}s…`);
  await new Promise((res) => setTimeout(res, wait));
}

log('Migrations applied; starting server');
await import('../dist/server/index.js');
