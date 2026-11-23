import type { PluginErrorPayload } from '@owox/plugin-sdk';

export function describeError(error: unknown): string {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.name === 'PluginTransportError' && 'payload' in current) {
      const { code, status, message } = current.payload as PluginErrorPayload;
      return [code, status, message].filter(Boolean).join(' ');
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Every HTTP status on the error and its `cause` chain: `status` or `payload.status`, first to last. */
export function statusesOf(error: unknown): number[] {
  const out: number[] = [];
  for (let c = error; c instanceof Error; c = c.cause) {
    const p = (c as { payload?: { status?: unknown } }).payload;
    for (const s of [(c as { status?: unknown }).status, p?.status]) if (typeof s === 'number') out.push(s);
  }
  return out;
}
/** The first HTTP status found, or undefined. */
export const statusOf = (error: unknown): number | undefined => statusesOf(error)[0];

/** Like describeError, but a refused schedule action keeps its code: "TOO_MANY_SCHEDULES Too many". */
export function describeActionError(e: unknown): string {
  if (e instanceof Error && e.name === 'PluginActionError') return `${(e as Error & { code?: string }).code ?? ''} ${e.message}`.trim();
  return describeError(e);
}
