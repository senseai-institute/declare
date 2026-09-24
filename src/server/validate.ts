import { z } from 'zod';
import { badRequest } from './http.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest(issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message);
  }
  return r.data;
}

export const nameSchema = z.string().trim().min(1, 'Required').max(40, 'Too long');
export { z };
