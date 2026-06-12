/**
 * ZenithOne Credit Union — Supabase Runtime Configuration
 *
 * NO credentials are stored here. The anon key and project URL are fetched at
 * runtime from the get-public-config edge function, where they live exclusively
 * as encrypted Deno.env secrets inside Supabase Vault.
 *
 * The only value here is the edge-function base URL, which is derived from the
 * public project ref — not a secret (visible in every network request anyway).
 */

const _EDGE = 'https://tfxuhnusogtwqukfypxb.supabase.co/functions/v1';

// Resolves true (Supabase live) or false (demo mode) once bootstrap completes
let _resolveReady;
const _ready = new Promise(res => { _resolveReady = res; });

// ── Bootstrap: fetch credentials from edge function, then init client ─────────
(async function _bootstrap() {
  try {
    const res = await fetch(`${_EDGE}/get-public-config`, { cache: 'no-store' });
    if (!res.ok) throw new Error('config fetch failed');
    const { url, anon_key } = await res.json();
    _loadClient(url, anon_key);
  } catch {
    console.warn('ZenithOne: Supabase unreachable — running in demo mode.');
    _resolveReady(false);
  }
})();

function _loadClient(url, anonKey) {
  if (window._supabase) { _resolveReady(true); return; }

  function _create() {
    // Store anon key on window so callEdgeFunction can add it as the apikey header.
    // This is intentional: the anon key is a public credential designed for browser use.
    window._supabaseAnonKey = anonKey;
    window._supabase = window.supabase.createClient(url, anonKey, {
      auth: {
        autoRefreshToken:   true,
        persistSession:     true,
        detectSessionInUrl: true, // handles magic-link & password-recovery callbacks
      },
    });
    document.dispatchEvent(new Event('supabaseReady'));
    _resolveReady(true);
  }

  if (window.supabase) {
    _create();
  } else {
    const s   = document.createElement('script');
    s.src     = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload  = _create;
    s.onerror = () => {
      console.warn('ZenithOne: Supabase CDN unavailable — demo mode.');
      _resolveReady(false);
    };
    document.head.appendChild(s);
  }
}

// ── Authenticated edge-function caller ────────────────────────────────────────
async function callEdgeFunction(name, body = {}) {
  await _ready; // wait for bootstrap to complete

  const sb = window._supabase;
  if (!sb) throw new Error('Supabase not initialised');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('No active session');

  const res = await fetch(`${_EDGE}/${name}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey':        window._supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Edge function "${name}" failed`);
  }
  return res.json();
}
