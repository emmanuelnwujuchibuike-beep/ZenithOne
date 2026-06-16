(function (global) {
  'use strict';

  const LS_CRED   = 'zo_faceid_cred';   // { id, email, userId }
  const LS_TOKEN  = 'zo_faceid_rt';     // Supabase refresh token (biometric-gated)
  const LS_ATOKEN = 'zo_faceid_at';     // Supabase access token (lets us restore via setSession)
  const LS_LOGIN  = 'zo_faceid_login';  // '0' to disable Face ID sign-in (default on once enrolled)
  const LS_TX     = 'zo_faceid_tx';     // '0' to disable Face ID for transactions (default on once enrolled)

  // Persist the freshest tokens for biometric re-entry. Storing the access token
  // too means re-entry can use setSession() (instant when the access token is
  // still valid) and only fall back to the rotating refresh token when needed.
  function _storeSession(session) {
    if (!session) return;
    if (session.refresh_token) localStorage.setItem(LS_TOKEN, session.refresh_token);
    if (session.access_token)  localStorage.setItem(LS_ATOKEN, session.access_token);
  }

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

  // ─── Platform-appropriate biometric label ───────────────────────────────────
  function getBiometricLabel() {
    var ua = navigator.userAgent || '';
    var pl = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    if (/android/i.test(ua))           return 'Fingerprint';
    if (/iphone|ipad|ipod/i.test(ua))  return 'Face ID / Touch ID';
    if (/win/.test(pl))                return 'Windows Hello';
    if (/mac/.test(pl))                return 'Touch ID';
    return 'Face ID / Fingerprint';
  }

  async function isAvailable() {
    if (!global.PublicKeyCredential) return false;
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

  function getBioIconSVG(label) {
    const isFingerprint = /fingerprint|touch id/i.test(label || '');
    if (isFingerprint) {
      return `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
        <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/>
        <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
        <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
        <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
        <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
        <path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/>
        <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/></svg>`;
    }
    // Face ID / Windows Hello / generic
    return `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>
      <path d="M9 10h.01M15 10h.01"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/><path d="M12 10v3"/></svg>`;
  }

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
          <span class="zfid-face" id="zfidFaceIcon">${getBioIconSVG(getBiometricLabel())}</span>
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
    const label = getBiometricLabel();
    el.querySelector('#zfidFrame').className = 'zfid-frame scanning';
    el.querySelector('#zfidResult').innerHTML = '';
    el.querySelector('#zfidFaceIcon').innerHTML = getBioIconSVG(label);
    el.querySelector('#zfidTitle').textContent = title || label;
    el.querySelector('#zfidMsg').textContent = msg || 'Follow the prompt on your device…';
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
    if (n === 'NotAllowedError') return 'Verification was cancelled or timed out. Please try again.';
    if (n === 'InvalidStateError') return 'A credential for this device already exists. Remove the existing enrollment below and try again.';
    if (n === 'NotSupportedError') return 'Your device or browser does not support this. Make sure Windows Hello, a PIN, fingerprint, or Face ID is fully set up in your device settings, then try again.';
    if (n === 'SecurityError') return 'Biometric authentication requires a secure (HTTPS) connection.';
    if (n === 'AbortError') return 'Authentication was aborted. Please try again.';
    if (n === 'UnknownError') return 'Device authentication failed. Ensure your PIN, fingerprint, or Face ID is set up in your device settings.';
    return (e && e.message) || 'Biometric authentication failed.';
  }

  // ─── Enroll ─────────────────────────────────────────────────────────────────
  async function enroll() {
    const sb = global._supabase;
    if (!sb) throw new Error('Not connected.');
    if (!(await isAvailable())) throw new Error('This device does not support Face ID / biometric sign-in.');

    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Please sign in before enabling ' + getBiometricLabel() + '.');
    const user = session.user;

    showScanning('Set Up ' + getBiometricLabel(), 'Follow your device prompt to enrol…');
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
      _storeSession(session);

      showResult(true, getBiometricLabel() + ' Enabled', 'You can now sign in instantly.');
      setTimeout(hideOverlay, 1400);
      return true;
    } catch (e) {
      if (cancelled) return false;
      const msg = friendlyError(e);
      showResult(false, 'Could Not Enable', msg);
      setTimeout(hideOverlay, 2400);
      throw new Error(msg);
    }
  }

  // ─── Verify (biometric gate only) ───────────────────────────────────────────
  async function verify(reason) {
    const cred = getCred();
    if (!cred) throw new Error(getBiometricLabel() + ' is not set up on this device.');

    showScanning('Verify with ' + getBiometricLabel(), reason || 'Confirm your identity to continue…');
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
      const msg = friendlyError(e);
      showResult(false, 'Verification Failed', msg);
      setTimeout(hideOverlay, 1700);
      throw new Error(msg);
    }
  }

  // ─── Login with Face ID (verify + restore session) ──────────────────────────
  async function loginWithFaceId() {
    const sb = global._supabase;
    if (!sb) throw new Error('Not connected.');
    const cred = getCred();
    if (!cred) throw new Error(getBiometricLabel() + ' is not set up on this device.');

    showScanning('Sign In with ' + getBiometricLabel(), 'Verify your identity to sign in…');
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
      const at = localStorage.getItem(LS_ATOKEN);
      if (!rt && !at) {
        showResult(false, 'Session Expired', 'Sign in with your password once to re-link ' + getBiometricLabel() + '.');
        setTimeout(() => { hideOverlay(); window.location.href = 'login.html'; }, 2400);
        throw new Error('session_expired');
      }

      // 1) Restore via setSession — instant when the access token is still valid,
      //    and it transparently refreshes using the refresh token when needed.
      //    This is far more reliable than refreshSession alone (which consumes a
      //    single-use rotating token and fails if it was already rotated).
      let data = null, error = null;
      if (at && rt) {
        ({ data, error } = await sb.auth.setSession({ access_token: at, refresh_token: rt }));
      }
      // 2) Fall back to a straight refresh if setSession could not restore.
      if ((error || !data?.session) && rt) {
        ({ data, error } = await sb.auth.refreshSession({ refresh_token: rt }));
      }
      if (error || !data?.session) {
        localStorage.removeItem(LS_TOKEN);   // clear stale tokens; credential stays enrolled
        localStorage.removeItem(LS_ATOKEN);
        showResult(false, 'Session Expired', 'Sign in with your password once to re-link ' + getBiometricLabel() + '.');
        setTimeout(() => { hideOverlay(); window.location.href = 'login.html'; }, 2400);
        throw new Error('session_expired');
      }

      _storeSession(data.session); // keep both tokens fresh (rotation)
      // Face ID is device-bound — treat as remember-me for 30 days
      localStorage.setItem('zo_remember', '1');
      localStorage.setItem('zo_remember_until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
      sessionStorage.removeItem('zo_session_only');
      showResult(true, 'Welcome Back', 'Signing you in…');
      setTimeout(() => {
        const _t = localStorage.getItem('zo_reauth_target') || '';
        localStorage.removeItem('zo_reauth_target');
        const _safe = _t && !_t.startsWith('http') && !_t.startsWith('//') && !_t.includes('://');
        window.location.href = _safe ? _t : 'dashboard.html';
      }, 900);
      return true;
    } catch (e) {
      if (cancelled) { hideOverlay(); throw new Error('Sign-in cancelled.'); }
      if (e && e.message === 'session_expired') throw e; // already handled above
      const msg = friendlyError(e);
      showResult(false, 'Sign-In Failed', msg);
      setTimeout(hideOverlay, 2000);
      throw new Error(msg);
    }
  }

  // ─── Keep stored refresh token fresh on authenticated pages ─────────────────
  async function syncToken() {
    if (!isEnrolled() || !global._supabase) return;
    try {
      const { data: { session } } = await global._supabase.auth.getSession();
      _storeSession(session);
    } catch { /* ignore */ }
  }

  // Supabase rotates the refresh token on every refresh. Capture EVERY new token
  // (initial sign-in + each silent refresh) so the biometric token can never go
  // stale — this is what lets a 30-day device sign back in with Face ID after a
  // manual sign-out without ever hitting "Session Expired".
  let _tokenBound = false;
  function bindTokenSync() {
    if (_tokenBound || !global._supabase) return;
    _tokenBound = true;
    try {
      global._supabase.auth.onAuthStateChange(function (_event, session) {
        if (session && isEnrolled()) _storeSession(session);
      });
    } catch { /* ignore */ }
  }

  function disable() {
    localStorage.removeItem(LS_CRED);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ATOKEN);
    localStorage.removeItem(LS_LOGIN);
    localStorage.removeItem(LS_TX);
  }

  // ─── Auto-sync token on logged-in pages ─────────────────────────────────────
  function autoSync() {
    if (global._supabase) { bindTokenSync(); setTimeout(syncToken, 1500); }
    else document.addEventListener('supabaseReady', () => { bindTokenSync(); setTimeout(syncToken, 1500); }, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoSync);
  else autoSync();

  // Grab the freshest refresh token right now (called at manual sign-out so the
  // biometric path keeps a valid token even after a local sign-out).
  async function captureToken() {
    if (!isEnrolled() || !global._supabase) return;
    try {
      const { data: { session } } = await global._supabase.auth.getSession();
      _storeSession(session);
    } catch { /* ignore */ }
  }

  // ─── Shared transaction authorization: Face ID → else PIN ───────────────────
  const PIN_CSS = `
    .zpin-overlay{position:fixed;inset:0;z-index:2100;background:rgba(2,5,14,.86);backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;padding:20px;}
    .zpin-overlay.open{display:flex;}
    .zpin-card{width:336px;max-width:100%;text-align:center;background:linear-gradient(165deg,#0b1829,#060e1c);border:1px solid rgba(201,168,76,.2);border-radius:24px;padding:30px 26px 24px;box-shadow:0 40px 120px rgba(0,0,0,.7);position:relative;}
    .zpin-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.7) 50%,transparent);}
    .zpin-ic{width:50px;height:50px;border-radius:14px;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.22);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#c9a84c;}
    .zpin-title{font-family:'Cormorant Garamond','Georgia',serif;font-size:1.4rem;color:#fff;margin-bottom:5px;}
    .zpin-sub{font-size:.77rem;color:rgba(255,255,255,.45);margin-bottom:20px;line-height:1.5;}
    .zpin-dots{display:flex;justify-content:center;gap:15px;margin-bottom:16px;}
    .zpin-dot{width:14px;height:14px;border-radius:50%;border:2px solid rgba(201,168,76,.4);transition:all .15s;}
    .zpin-dot.on{background:#e8d07a;border-color:#e8d07a;}
    .zpin-err{font-size:.75rem;color:#f87171;min-height:17px;margin-bottom:8px;}
    .zpin-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px;}
    .zpin-key{height:50px;border-radius:13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#fff;font-size:1.15rem;cursor:pointer;transition:background .12s;display:flex;align-items:center;justify-content:center;}
    .zpin-key:hover{background:rgba(201,168,76,.14);border-color:rgba(201,168,76,.3);}
    .zpin-key.fn{font-size:.82rem;color:rgba(255,255,255,.5);}
    .zpin-key.empty{background:transparent;border:none;cursor:default;}
    .zpin-cancel{margin-top:4px;background:none;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.45);font-size:.78rem;padding:9px 0;border-radius:10px;cursor:pointer;width:100%;}
  `;
  let _pinEl = null, _pinResolve = null, _pinReject = null;
  let _pinBuf = '', _pinFirst = '', _pinMode = 'verify'; // verify | create | confirm

  function _pinBuild() {
    if (_pinEl) return _pinEl;
    if (!document.getElementById('zpinCSS')) {
      const s = document.createElement('style'); s.id = 'zpinCSS'; s.textContent = PIN_CSS;
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.className = 'zpin-overlay';
    el.innerHTML = `
      <div class="zpin-card">
        <div class="zpin-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <div class="zpin-title" id="zpinTitle">Enter PIN</div>
        <div class="zpin-sub" id="zpinSub">Confirm your 4-digit PIN to authorize</div>
        <div class="zpin-dots">
          <span class="zpin-dot" data-i="0"></span><span class="zpin-dot" data-i="1"></span>
          <span class="zpin-dot" data-i="2"></span><span class="zpin-dot" data-i="3"></span>
        </div>
        <div class="zpin-err" id="zpinErr"></div>
        <div class="zpin-pad" id="zpinPad">
          ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="zpin-key" data-k="${n}">${n}</button>`).join('')}
          <button class="zpin-key empty"></button>
          <button class="zpin-key" data-k="0">0</button>
          <button class="zpin-key fn" data-k="del">⌫</button>
        </div>
        <button class="zpin-cancel" id="zpinCancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#zpinPad').addEventListener('click', function (e) {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.getAttribute('data-k');
      if (k === 'del') { _pinBuf = _pinBuf.slice(0, -1); _pinDots(); return; }
      if (_pinBuf.length >= 4) return;
      _pinBuf += k; _pinDots();
      if (_pinBuf.length === 4) setTimeout(_pinAdvance, 120);
    });
    el.querySelector('#zpinCancel').addEventListener('click', () => _pinDone(false, 'cancelled'));
    _pinEl = el;
    return el;
  }
  function _pinDots() {
    if (!_pinEl) return;
    _pinEl.querySelectorAll('.zpin-dot').forEach(d => {
      d.classList.toggle('on', Number(d.getAttribute('data-i')) < _pinBuf.length);
    });
  }
  function _pinErr(m) { const e = _pinEl && _pinEl.querySelector('#zpinErr'); if (e) e.textContent = m || ''; }
  function _pinSet(title, sub) {
    if (!_pinEl) return;
    _pinEl.querySelector('#zpinTitle').textContent = title;
    _pinEl.querySelector('#zpinSub').textContent = sub;
  }
  async function _pinAdvance() {
    const pin = _pinBuf;
    if (_pinMode === 'create') {
      _pinFirst = pin; _pinBuf = ''; _pinDots(); _pinErr('');
      _pinMode = 'confirm'; _pinSet('Confirm PIN', 'Re-enter your new 4-digit PIN');
      return;
    }
    if (_pinMode === 'confirm') {
      if (pin !== _pinFirst) { _pinBuf = ''; _pinFirst = ''; _pinDots(); _pinMode = 'create'; _pinErr('PINs did not match — try again.'); _pinSet('Create a PIN', 'Choose a 4-digit transaction PIN'); return; }
      try {
        await callEdgeFunction('transaction-pin', { action: 'create_pin', pin });
        _pinDone(true, null, pin);
      } catch (e) { _pinBuf=''; _pinDots(); _pinErr((e && e.message) ? _msg(e) : 'Could not set PIN.'); }
      return;
    }
    // verify
    try {
      const res = await callEdgeFunction('transaction-pin', { action: 'verify_pin', pin });
      if (res && res.valid) _pinDone(true, null, pin);
      else { _pinBuf=''; _pinDots(); _pinErr('Incorrect PIN. Try again.'); }
    } catch (e) { _pinBuf=''; _pinDots(); _pinErr(_msg(e) || 'Verification failed.'); }
  }
  function _msg(e){ try { return JSON.parse(e.message).error || e.message; } catch { return e && e.message; } }
  function _pinDone(ok, reason, pinVal) {
    if (_pinEl) { _pinEl.classList.remove('open'); document.body.style.overflow=''; }
    const res = _pinResolve, rej = _pinReject;
    _pinResolve = _pinReject = null; _pinBuf=''; _pinFirst='';
    if (ok) { res && res(pinVal || true); }
    else { rej && rej(new Error(reason === 'cancelled' ? 'Authorization cancelled.' : 'Authorization failed.')); }
  }
  function _pinAuthorize(reason) {
    return new Promise(async (resolve, reject) => {
      _pinResolve = resolve; _pinReject = reject;
      _pinBuild();
      _pinBuf = ''; _pinFirst = ''; _pinDots(); _pinErr('');
      // Does the user already have a PIN?
      let pinSet = false;
      try { const st = await callEdgeFunction('transaction-pin', { action: 'check_status' }); pinSet = !!(st && st.pin_set); }
      catch { /* assume not set */ }
      if (pinSet) { _pinMode = 'verify'; _pinSet('Enter PIN', reason || 'Confirm your 4-digit PIN to authorize'); }
      else        { _pinMode = 'create'; _pinSet('Create a PIN', 'Set a 4-digit PIN to authorize payments'); }
      _pinEl.classList.add('open'); document.body.style.overflow = 'hidden';
    });
  }

  // Public: gate a transaction with Face ID (if enabled) else PIN. Resolves on
  // success, rejects (with a friendly message) on cancel/failure.
  async function authorizeTxn(reason) {
    if (txEnabled()) { await verify(reason || 'Authorize this transaction'); return true; }
    return await _pinAuthorize(reason);
  }

  // Public: for SERVER-ENFORCED money movements. Always collects the 4-digit PIN
  // (creating one if the member has none) and resolves the verified PIN string so
  // the caller can pass it to the edge function for server-side verification.
  // A PIN is the factor the server can cryptographically check; Face ID unlocks
  // the device but cannot be verified server-side here.
  async function authorizePin(reason) {
    return await _pinAuthorize(reason);
  }

  global.ZenithFaceID = {
    isAvailable, isEnrolled, enroll, verify, loginWithFaceId,
    syncToken, captureToken, disable, authorizeTxn, authorizePin,
    loginEnabled, setLoginEnabled, txEnabled, setTxEnabled,
    getBiometricLabel,
  };
  // Convenience globals used by transaction flows on every page.
  global.zoAuthorizeTxn = authorizeTxn;
  global.zoAuthorizePin = authorizePin;
})(window);
