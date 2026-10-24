/**
 * Structured JSON logs (one line each) so Vercel, Datadog or Logtail can filter by
 * order_id, reference and so on. Errors are also sent to Sentry when SENTRY_DSN is set.
 */
type Ctx = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function emit(level: Level, msg: string, ctx: Ctx = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...ctx });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

async function captureException(err: unknown, ctx?: Ctx) {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err, { extra: ctx });
  } catch {
    /* monitoring must never break a request */
  }
}

export const logger = {
  debug: (msg: string, ctx?: Ctx) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', msg, ctx);
  },
  info: (msg: string, ctx?: Ctx) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Ctx) => emit('warn', msg, ctx),
  error: (msg: string, err?: unknown, ctx?: Ctx) => {
    emit('error', msg, {
      ...ctx,
      error: err === undefined ? undefined : errorMessage(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined,
    });
    void captureException(err ?? new Error(msg), ctx);
  },
};
