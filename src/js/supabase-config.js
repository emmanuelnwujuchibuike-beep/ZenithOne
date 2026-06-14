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
        // Routes to localStorage when "remember me for 30 days" is active, sessionStorage otherwise.
        // Clearing browser history clears sessionStorage → forces re-login when not remembered.
        storage: (function () {
          const R = 'zo_remember', U = 'zo_remember_until';
          function _ls() { return localStorage.getItem(R) === '1' && Date.now() < +localStorage.getItem(U); }
          return {
            getItem:    function (k) { return _ls() ? localStorage.getItem(k)    : sessionStorage.getItem(k); },
            setItem:    function (k, v) { _ls() ? localStorage.setItem(k, v)    : sessionStorage.setItem(k, v); },
            removeItem: function (k) { localStorage.removeItem(k); sessionStorage.removeItem(k); },
          };
        })(),
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

// ── ZenithOne Toast + Confirm System ─────────────────────────────────────────
(function () {
  const ICONS = {
    success: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="rgba(74,222,128,.15)"/><path d="M5 9l3 3 5-5" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="rgba(248,113,113,.15)"/><path d="M6 6l6 6M12 6l-6 6" stroke="#f87171" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="rgba(96,165,250,.15)"/><rect x="8.1" y="8" width="1.8" height="5" rx=".9" fill="#60a5fa"/><circle cx="9" cy="6" r="1" fill="#60a5fa"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="rgba(251,191,36,.12)"/><rect x="8.1" y="5.5" width="1.8" height="5" rx=".9" fill="#fbbf24"/><circle cx="9" cy="13" r="1" fill="#fbbf24"/></svg>`,
  };
  const COLORS = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };

  function getContainer() {
    let c = document.getElementById('z-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'z-toast-container';
      c.style.cssText = 'position:fixed;top:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(c);
    }
    return c;
  }

  window.zenithToast = function (message, type = 'info', duration = 4500) {
    const container = getContainer();
    const color = COLORS[type] || COLORS.info;
    const icon  = ICONS[type]  || ICONS.info;

    const t = document.createElement('div');
    t.style.cssText = `
      pointer-events:all;
      display:flex;align-items:flex-start;gap:12px;
      background:linear-gradient(135deg,rgba(10,21,37,.98),rgba(13,30,53,.97));
      border:1px solid rgba(255,255,255,.08);
      border-left:3px solid ${color};
      border-radius:12px;
      padding:14px 16px 14px 14px;
      min-width:300px;max-width:380px;
      box-shadow:0 8px 32px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3);
      backdrop-filter:blur(12px);
      transform:translateX(120%);
      transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .3s ease;
      opacity:0;
      position:relative;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;

    t.innerHTML = `
      <div style="flex-shrink:0;margin-top:1px;">${icon}</div>
      <div style="flex:1;font-size:.84rem;color:rgba(255,255,255,.9);line-height:1.5;">${message}</div>
      <button onclick="this.closest('[id^=zt]').remove()" style="flex-shrink:0;background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:1rem;padding:0;line-height:1;margin-top:1px;transition:color .15s;" onmouseover="this.style.color='rgba(255,255,255,.8)'" onmouseout="this.style.color='rgba(255,255,255,.35)'">✕</button>
      <div style="position:absolute;bottom:0;left:0;height:2px;background:${color};opacity:.5;animation:z-toast-prog ${duration}ms linear forwards;"></div>
    `;

    const id = 'zt' + Date.now();
    t.id = id;
    container.appendChild(t);

    // Inject progress keyframe once
    if (!document.getElementById('z-toast-styles')) {
      const s = document.createElement('style');
      s.id = 'z-toast-styles';
      s.textContent = `@keyframes z-toast-prog{from{width:100%}to{width:0%}}`;
      document.head.appendChild(s);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        t.style.transform = 'translateX(0)';
        t.style.opacity   = '1';
      });
    });

    const timer = setTimeout(() => {
      t.style.transform = 'translateX(120%)';
      t.style.opacity   = '0';
      setTimeout(() => t.remove(), 350);
    }, duration);

    t.querySelector('button').addEventListener('click', () => clearTimeout(timer));
  };

  window.zenithConfirm = function (message, { title = 'Confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel', type = 'warning' } = {}) {
    return new Promise(resolve => {
      const color = COLORS[type] || COLORS.warning;
      const icon  = ICONS[type]  || ICONS.warning;

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:z-conf-in .15s ease;';

      overlay.innerHTML = `
        <style>@keyframes z-conf-in{from{opacity:0}to{opacity:1}}@keyframes z-conf-slide{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}</style>
        <div style="background:linear-gradient(150deg,#0a1525,#0d1e35);border:1px solid rgba(255,255,255,.1);border-top:2px solid ${color};border-radius:16px;padding:28px 28px 22px;width:380px;max-width:90vw;box-shadow:0 24px 60px rgba(0,0,0,.6);animation:z-conf-slide .2s ease;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            ${icon}
            <div style="font-size:1rem;font-weight:600;color:rgba(255,255,255,.9);">${title}</div>
          </div>
          <div style="font-size:.87rem;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:22px;">${message}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="z-conf-cancel" style="padding:9px 20px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);cursor:pointer;font-size:.85rem;transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,.1)'" onmouseout="this.style.background='rgba(255,255,255,.05)'">${cancelLabel}</button>
            <button id="z-conf-ok" style="padding:9px 20px;border-radius:8px;border:none;background:${color};color:#000;cursor:pointer;font-size:.85rem;font-weight:600;transition:opacity .15s;" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">${confirmLabel}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      overlay.querySelector('#z-conf-ok').focus();

      function close(val) { overlay.remove(); resolve(val); }
      overlay.querySelector('#z-conf-ok').addEventListener('click', () => close(true));
      overlay.querySelector('#z-conf-cancel').addEventListener('click', () => close(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    });
  };
})();
