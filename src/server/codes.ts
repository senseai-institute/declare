import { randomInt } from 'node:crypto';
import { prisma } from './db.js';

// No 0/O, 1/I/L — easy to read aloud and type on a phone.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A code unique across groups and sessions, so /join/:code is unambiguous. */
export async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    const [g, s] = await Promise.all([
      prisma.group.findUnique({ where: { joinCode: code }, select: { id: true } }),
      prisma.session.findUnique({ where: { joinCode: code }, select: { id: true } }),
    ]);
    if (!g && !s) return code;
  }
  throw new Error('Could not allocate a join code');
}
