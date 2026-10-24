import 'server-only';

export const isProd = process.env.NODE_ENV === 'production';

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Read a required server-side variable, failing with a message that says how to fix it. */
export function requireEnv(name: string): string {
  const v = optionalEnv(name);
  if (!v) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return v;
}
