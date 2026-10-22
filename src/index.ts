import { createApp } from './app';
import { postgresDb } from './db';
import { standinIdentity } from './standin/rails';

interface Env {
  HYPERDRIVE: Hyperdrive;
  /** Set in the Cloudflare dashboard by the founder. Never in code. */
  ADMIN_KEY: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> }; // declared in wrangler.jsonc
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Hyperdrive pools the real connections, so a fresh client per request is cheap.
    const db = postgresDb(env.HYPERDRIVE.connectionString);
    const limit = async (key: string) => (await env.RATE_LIMITER.limit({ key })).success;
    return createApp({ db, identity: standinIdentity(db), adminKey: env.ADMIN_KEY ?? '', limit }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
