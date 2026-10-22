// Shared request helpers for the Worker's routes.

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what} must be an object.`);
  return v as Record<string, unknown>;
};
export const str = (v: unknown, what: string, max = 200, pattern?: RegExp): string => {
  if (typeof v !== 'string' || v.length > max || (pattern && !pattern.test(v))) throw new HttpError(400, `${what} is invalid.`);
  return v;
};
export const num = (v: unknown, what: string, min = -1e9, max = 1e9): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${what} is invalid.`);
  return v;
};
