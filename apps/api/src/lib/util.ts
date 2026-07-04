import { MAX_PAGE_SIZE } from '@noderail/shared';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** Simple createdAt+id cursor pagination decode/encode. */
export function decodeCursor(cursor?: string): { id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return { id: decoded };
  } catch {
    return undefined;
  }
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function clampLimit(limit: number): number {
  return Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
