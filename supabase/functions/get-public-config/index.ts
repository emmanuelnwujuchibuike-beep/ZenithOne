/**
 * ZenithOne Credit Union — Public Config Edge Function
 *
 * Returns the Supabase project URL and anon key from server-side Deno.env secrets.
 * Credentials are NEVER stored in any JS or HTML file — only here, encrypted in
 * Supabase Vault. No JWT required (verify_jwt = false in config.toml).
 */

import { cors, json, errJson } from '../_shared/cors.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();

  try {
    const url      = Deno.env.get('SUPABASE_URL');
    const anon_key = Deno.env.get('SUPABASE_ANON_KEY');

    if (!url || !anon_key) {
      return errJson(new Error('Server configuration incomplete'), 500);
    }

    return json({ url, anon_key });

  } catch (err) {
    return errJson(err, 500);
  }
});
