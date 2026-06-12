/**
 * ZenithOne Credit Union — Supabase Client Configuration
 *
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your actual
 * project credentials from https://app.supabase.com/project/_/settings/api
 */

const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

// Initialize Supabase client (loaded via CDN in each HTML page)
let supabase;
if (typeof window !== 'undefined' && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession:   true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  window._supabase = supabase;
}

// Edge Function base URL helper
const edgeFn = (name) => `${SUPABASE_URL}/functions/v1/${name}`;

// Authenticated fetch wrapper for Edge Functions
async function callEdgeFunction(name, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(edgeFn(name), {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':        SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Edge Function error');
  }
  return res.json();
}

// Load Supabase CDN if not already included
(function () {
  if (typeof window === 'undefined') return;
  if (window.supabase) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = () => {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true },
    });
    window._supabase = supabase;
    document.dispatchEvent(new Event('supabaseReady'));
  };
  document.head.appendChild(s);
})();
