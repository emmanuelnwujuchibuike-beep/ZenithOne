/*!
 * ZenithOne Credit Union — Face ID / Biometric Authentication
 * Uses the WebAuthn platform authenticator (Face ID · Touch ID · Windows Hello).
 * Self-contained: injects its own CSS + premium scanning overlay.
 *
 * Public API (window.ZenithFaceID):
 *   isAvailable()        → Promise<bool>  device supports platform biometrics
 *   isEnrolled()         → bool           a credential is stored on this device
 *   enroll()             → Promise<bool>  register Face ID (must be signed in)
 *   verify(reason)       → Promise<bool>  biometric gate (must already be enrolled)
 *   loginWithFaceId()    → Promise<bool>  biometric gate + restore Supabase session
 *   disable()            → void           remove credential from this device
 *   syncToken()          → Promise        keep stored refresh token fresh
 *   txEnabled() / setTxEnabled(bool)      Face-ID-for-transactions preference
 */
(function (global) {
  'use strict';

  const LS_CRED  = 'zo_faceid_cred';   // { id, email, userId }
  const LS_TOKEN = 'zo_faceid_rt';     // Supabase refresh token (biometric-gated)
  const LS_LOGIN = 'zo_faceid_login';  // '0' to disable Face ID sign-in (default on once enrolled)
  const LS_TX    = 'zo_faceid_tx';     // '0' to disable Face ID for transactions (default on once enrolled)

  // ─── base64url <-> ArrayBuffer ──────────────────────────────────────────────
  function bufToB64u(buf) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uToBuf(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function randChallenge() { return crypto.getRandomValues(new Uint8Array(32)); }

  // ─── State helpers ──────────────────────────────────────────────────────────
  function getCred() { try { return JSON.parse(localStorage.getItem(LS_CRED) || 'null'); } catch { return null; } }
  function isEnrolled() { return !!getCred(); }
  // Both features default ON once a credential is enrolled (only '0' disables them).
  function loginEnabled() { return isEnrolled() && localStorage.getItem(LS_LOGIN) !== '0'; }
  function setLoginEnabled(v) { localStorage.setItem(LS_LOGIN, v ? '1' : '0'); }
  function txEnabled() { return isEnrolled() && localStorage.getItem(LS_TX) !== '0'; }
  function setTxEnabled(v) { localStorage.setItem(LS_TX, v ? '1' : '0'); }

  async function isAvailable() {
    if (!global.PublicKeyCredential || !global.isSecureContext) return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch { return false; }
  }

  // ─── Premium scanning overlay ───────────────────────────────────────────────
  const CSS = `
    .zfid-overlay {
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(2,5,14,.82); backdrop-filter: blur(14px);
      display: flex; align-items: center; justify-content: center; padding: 24px;
      opacity: 0; pointer-events: none; transition: opacity .3s ease;
    }
    .zfid-overlay.open { opacity: 1; pointer-events: auto; }
    .zfid-card {
      width: 360px; max-width: 100%; text-align: center;
      background: linear-gradient(165deg,#0b1829 0%,#060e1c 100%);
      border: 1px solid rgba(201,168,76,.18); border-radius: 26px;
      padding: 40px 36px 34px; position: relative; overflow: hidden;
      transform: scale(.94) translateY(10px); transition: transform .32s cubic-bezier(.34,1.2,.64,1);
      box-shadow: 0 40px 120px rgba(0,0,0,.7);
    }
    .zfid-overlay.open .zfid-card { transform: scale(1) translateY(0); }
    .zfid-card::before {
      content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background: linear-gradient(90deg,transparent,rgba(201,168,76,.7) 50%,transparent);
    }
    .zfid-eyebrow {
      font-size: .58rem; letter-spacing: .3em; text-transform: uppercase;
      color: rgba(201,168,76,.6); margin-bottom: 22px;
    }

    /* Face scan frame */
    .zfid-frame {
      width: 124px; height: 124px; margin: 0 auto 26px; position: relative;
    }
    .zfid-bracket {
      position: absolute; width: 30px; height: 30px;
      border: 2.5px solid #c9a84c; border-radius: 4px;
    }
    .zfid-bracket.tl { top:0; left:0; border-right:none; border-bottom:none; border-top-left-radius:14px; }
    .zfid-bracket.tr { top:0; right:0; border-left:none; border-bottom:none; border-top-right-radius:14px; }
    .zfid-bracket.bl { bottom:0; left:0; border-right:none; border-top:none; border-bottom-left-radius:14px; }
    .zfid-bracket.br { bottom:0; right:0; border-left:none; border-top:none; border-bottom-right-radius:14px; }
    .zfid-face {
      position: absolute; inset: 18px; display: flex; align-items: center; justify-content: center;
      color: rgba(201,168,76,.85);
    }
    /* Scanning line */
    .zfid-scan {
      position: absolute; left: 14px; right: 14px; height: 2px; top: 18px;
      background: linear-gradient(90deg, transparent, #e8d07a, transparent);
      box-shadow: 0 0 14px 2px rgba(201,168,76,.7);
      animation: zfidScan 1.9s cubic-bezier(.45,0,.55,1) infinite;
    }
    @keyframes zfidScan {
      0%,100% { top: 18px; opacity:.4; }
      50%     { top: 104px; opacity:1; }
    }
    /* Pulsing brackets while scanning */
    .zfid-frame.scanning .zfid-bracket { animation: zfidPulse 1.9s ease infinite; }
    @keyframes zfidPulse { 0%,100%{ border-color:rgba(201,168,76,.45);} 50%{ border-color:#e8d07a;} }

    .zfid-title {
      font-family: 'Cormorant Garamond','Georgia',serif;
      font-size: 1.5rem; font-weight: 300; color: #fff; margin-bottom: 8px; line-height: 1.15;
    }
    .zfid-msg { font-size: .82rem; color: rgba(255,255,255,.45); line-height: 1.55; min-height: 38px; }
    .zfid-cancel {
      margin-top: 22px; background: none; border: 1px solid rgba(255,255,255,.1);
      color: rgba(255,255,255,.4); font-size: .78rem; padding: 9px 22px; border-radius: 10px;
      cursor: pointer; transition: all .16s;
    }
    .zfid-cancel:hover { border-color: rgba(255,255,255,.25); color: rgba(255,255,255,.7); }

    /* Success / error states */
    .zfid-frame.done .zfid-scan { display: none; }
    .zfid-result { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .25s; }
    .zfid-frame.done .zfid-result { opacity: 1; }
    .zfid-frame.done .zfid-face { opacity: 0; }
    @keyframes zfidPop { from{transform:scale(.4);opacity:0} to{transform:scale(1);opacity:1} }
    .zfid-frame.done .zfid-result svg { animation: zfidPop .35s cubic-bezier(.34,1.56,.64,1) both; }

    @media (max-width: 420px) {
      .zfid-card { padding: 34px 26px 28px; border-radius: 22px 22px 0 0; }
      .zfid-overlay { align-items: flex-end; padding: 0; }
    }
  `;

  let _overlayEl = null, _onCancel = null;

  function injectStyles() {
    if (document.getElementById('zfidCSS')) return;
    const s = document.createElement('style');
    s.id = 'zfidCSS'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  const FACE_SVG = `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>
    <path d="M9 10h.01M15 10h.01"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/><path d="M12 10v3"/></svg>`;

  function ensureOverlay() {
    injectStyles();
    if (_overlayEl) return _overlayEl;
    const el = document.createElement('div');
    el.className = 'zfid-overlay';
    el.innerHTML = `
      <div class="zfid-card">
        <div class="zfid-eyebrow">ZenithOne Secure Authentication</div>
        <div class="zfid-frame scanning" id="zfidFrame">
          <span class="zfid-bracket tl"></span><span class="zfid-bracket tr"></span>
          <span class="zfid-bracket bl"></span><span class="zfid-bracket br"></span>
          <span class="zfid-scan"></span>
          <span class="zfid-face">${FACE_SVG}</span>
          <span class="zfid-result" id="zfidResult"></span>
        </div>
        <div class="zfid-title" id="zfidTitle">Face ID</div>
        <div class="zfid-msg" id="zfidMsg">Look at your device to continue…</div>
        <button class="zfid-cancel" id="zfidCancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#zfidCancel').addEventListener('click', () => { if (_onCancel) _onCancel(); });
    _overlayEl = el;
    return el;
  }

  function showScanning(title, msg) {
    const el = ensureOverlay();
    el.querySelector('#zfidFrame').className = 'zfid-frame scanning';
    el.querySelector('#zfidResult').innerHTML = '';
    el.querySelector('#zfidTitle').textContent = title || 'Face ID';
    el.querySelector('#zfidMsg').textContent = msg || 'Look at your device to continue…';
    el.querySelector('#zfidCancel').style.display = '';
    requestAnimationFrame(() => el.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }

  function showResult(ok, title, msg) {
    const el = ensureOverlay();
    const frame = el.querySelector('#zfidFrame');
    frame.className = 'zfid-frame done';
    const color = ok ? '#4ade80' : '#f87171';
    el.querySelector('#zfidResult').innerHTML = ok
      ? `<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke="${color}" stroke-opacity=".3"/><polyline points="8 12.5 11 15.5 16 9"/></svg>`
      : `<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke="${color}" stroke-opacity=".3"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    el.querySelector('#zfidTitle').textContent = title;
    el.querySelector('#zfidMsg').textContent = msg || '';
    el.querySelector('#zfidCancel').style.display = 'none';
  }

  function hideOverlay() {
    if (!_overlayEl) return;
    _overlayEl.classList.remove('open');
    document.body.style.overflow = '';
  }

  function friendlyError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError') return 'Authentication was cancelled or timed out.';
    if (n === 'InvalidStateError') return 'This device is already enrolled.';
    if (n === 'SecurityError') return 'Face ID requires a secure (HTTPS) connection.';
    return (e && e.message) || 'Biometric authentication failed.';
  }

  // ─── Enroll ─────────────────────────────────────────────────────────────────
  async function enroll() {
    const sb = global._supabase;
    if (!sb) throw new Error('Not connected.');
    if (!(await isAvailable())) throw new Error('This device does not support Face ID / biometric sign-in.');

    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Please sign in before enabling Face ID.');
    const user = session.user;

    showScanning('Set Up Face ID', 'Follow your device prompt to enrol…');
    let cancelled = false;
    const ac = new AbortController();
    _onCancel = () => { cancelled = true; ac.abort(); hideOverlay(); };

    try {
      const cred = await navigator.credentials.create({
        signal: ac.signal,
        publicKey: {
          challenge: randChallenge(),
          rp: { name: 'ZenithOne Credit Union', id: location.hostname },
          user: {
            id: new TextEncoder().encode(user.id),
            name: user.email || user.id,
            displayName: user.user_metadata?.full_name || user.email || 'ZenithOne Member',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      });
      if (cancelled) return false;
      if (!cred) throw new Error('Enrolment failed.');

      localStorage.setItem(LS_CRED, JSON.stringify({ id: bufToB64u(cred.rawId), email: user.email, userId: user.id }));
      localStorage.setItem(LS_TOKEN, session.refresh_token);

      showResult(true, 'Face ID Enabled', 'You can now sign in instantly.');
      setTimeout(hideOverlay, 1400);
      return true;
    } catch (e) {
      if (cancelled) return false;
      showResult(false, 'Could Not Enable', friendlyError(e));
      setTimeout(hideOverlay, 1900);
      throw e;
    }
  }

  // ─── Verify (biometric gate only) ───────────────────────────────────────────
  async function verify(reason) {
    const cred = getCred();
    if (!cred) throw new Error('Face ID is not set up on this device.');

    showScanning('Verify with Face ID', reason || 'Confirm your identity to continue…');
    let cancelled = false;
    const ac = new AbortController();
    _onCancel = () => { cancelled = true; ac.abort(); hideOverlay(); };

    try {
      const assertion = await navigator.credentials.get({
        signal: ac.signal,
        publicKey: {
          challenge: randChallenge(),
          rpId: location.hostname,
          allowCredentials: [{ type: 'public-key', id: b64uToBuf(cred.id) }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (cancelled) throw new Error('cancelled');
      if (!assertion) throw new Error('Verification failed.');
      showResult(true, 'Verified', '');
      setTimeout(hideOverlay, 800);
      return true;
    } catch (e) {
      if (cancelled) throw new Error('Authentication was cancelled.');
      showResult(false, 'Verification Failed', friendlyError(e));
      setTimeout(hideOverlay, 1700);
      throw e;
    }
  }

  // ─── Login with Face ID (verify + restore session) ──────────────────────────
  async function loginWithFaceId() {
    const sb = global._supabase;
    if (!sb) throw new Error('Not connected.');
    const cred = getCred();
    if (!cred) throw new Error('Face ID is not set up on this device.');

    showScanning('Sign In with Face ID', 'Look at your device to sign in…');
    let cancelled = false;
    const ac = new AbortController();
    _onCancel = () => { cancelled = true; ac.abort(); hideOverlay(); };

    try {
      const assertion = await navigator.credentials.get({
        signal: ac.signal,
        publicKey: {
          challenge: randChallenge(),
          rpId: location.hostname,
          allowCredentials: [{ type: 'public-key', id: b64uToBuf(cred.id) }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (cancelled) throw new Error('cancelled');
      if (!assertion) throw new Error('Authentication failed.');

      const rt = localStorage.getItem(LS_TOKEN);
      if (!rt) throw new Error('Your secure session expired. Please sign in with your password once.');

      const { data, error } = await sb.auth.refreshSession({ refresh_token: rt });
      if (error || !data?.session) throw new Error('Your secure session expired. Please sign in with your password once.');

      localStorage.setItem(LS_TOKEN, data.session.refresh_token); // keep fresh (rotation)
      showResult(true, 'Welcome Back', 'Signing you in…');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 900);
      return true;
    } catch (e) {
      if (cancelled) { hideOverlay(); throw new Error('Sign-in cancelled.'); }
      showResult(false, 'Sign-In Failed', friendlyError(e));
      setTimeout(hideOverlay, 2000);
      throw e;
    }
  }

  // ─── Keep stored refresh token fresh on authenticated pages ─────────────────
  async function syncToken() {
    if (!isEnrolled() || !global._supabase) return;
    try {
      const { data: { session } } = await global._supabase.auth.getSession();
      if (session?.refresh_token) localStorage.setItem(LS_TOKEN, session.refresh_token);
    } catch { /* ignore */ }
  }

  function disable() {
    localStorage.removeItem(LS_CRED);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_LOGIN);
    localStorage.removeItem(LS_TX);
  }

  // ─── Auto-sync token on logged-in pages ─────────────────────────────────────
  function autoSync() {
    if (global._supabase) setTimeout(syncToken, 1500);
    else document.addEventListener('supabaseReady', () => setTimeout(syncToken, 1500), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoSync);
  else autoSync();

  global.ZenithFaceID = {
    isAvailable, isEnrolled, enroll, verify, loginWithFaceId,
    syncToken, disable,
    loginEnabled, setLoginEnabled, txEnabled, setTxEnabled,
  };
})(window);
