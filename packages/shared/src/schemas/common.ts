import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

export const cuidSchema = z.string().min(8).max(64);
export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'must be lowercase alphanumeric with hyphens');

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}

export const resourceSpecSchema = z.object({
  /** CPU in fractional cores, e.g. 0.5 */
  cpu: z.number().positive().max(128).default(0.5),
  /** Memory in MB */
  memoryMb: z.number().int().positive().max(1_048_576).default(512),
});
export type ResourceSpec = z.infer<typeof resourceSpecSchema>;

/** Parses "512MB", "1GB", "512" (MB assumed) into an integer MB value. */
export function parseMemoryToMb(input: string | number): number {
  if (typeof input === 'number') return Math.round(input);
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*(mb|gb|g|m)?$/i);
  if (!m) throw new Error(`Invalid memory value: ${input}`);
  const value = Number(m[1]);
  const unit = (m[2] ?? 'mb').toLowerCase();
  return Math.round(unit === 'gb' || unit === 'g' ? value * 1024 : value);
}

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
