import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Player } from '@prisma/client';
import { parseCookie } from 'cookie';
import { prisma } from './db.js';
import { HttpError } from './http.js';

export const COOKIE_NAME = 'declare_device';
const FIVE_YEARS = 60 * 60 * 24 * 365 * 5;

export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setDeviceCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: FIVE_YEARS,
  });
}

export async function playerFromToken(token: string | undefined): Promise<Player | null> {
  if (!token) return null;
  return prisma.player.findUnique({ where: { deviceToken: token } });
}

export function playerFromCookieHeader(header: string | undefined) {
  const cookies = header ? parseCookie(header) : {};
  return playerFromToken(cookies[COOKIE_NAME]);
}

export async function currentPlayer(req: FastifyRequest): Promise<Player | null> {
  return playerFromToken(req.cookies[COOKIE_NAME]);
}

export async function requirePlayer(req: FastifyRequest): Promise<Player> {
  const p = await currentPlayer(req);
  if (!p) throw new HttpError(401, 'Tell us your name first');
  return p;
}
