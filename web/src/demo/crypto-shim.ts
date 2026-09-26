// Browser replacement for node:crypto's randomInt (used by the shuffler).
export function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max; // rejection sampling: no modulo bias
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}
