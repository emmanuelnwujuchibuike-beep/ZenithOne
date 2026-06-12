/**
 * ZenithOne Credit Union — Shared Edge Function Utilities
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

export function errJson(err: unknown, status = 400): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, status);
}

export function cors(): Response {
  return new Response('ok', { headers: corsHeaders });
}

export function getAuthToken(req: Request): string {
  const header = req.headers.get('Authorization');
  if (!header) throw new Error('Missing authorization header');
  return header.replace('Bearer ', '');
}
