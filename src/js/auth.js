/**
 * ZenithOne Credit Union — Authentication Module
 * Handles login, signup, logout, session guard, and password reset.
 */

const PUBLIC_PAGES  = ['index.html','login.html','signup.html','forgot-password.html','reset-password.html',''];
const PRIVATE_PAGES = ['dashboard.html','accounts.html','transactions.html','transfer.html','cards.html','investments.html','settings.html'];

// ── Auth Guard ────────────────────────────────────────────────
async function checkAuthGuard() {
  const sb = window._supabase;
  if (!sb) return;

  const page      = window.location.pathname.split('/').pop() || 'index.html';
  const isPrivate = PRIVATE_PAGES.some(p => page.includes(p));

  const { data: { session } } = await sb.auth.getSession();

  if (isPrivate && !session) {
    window.location.href = 'login.html';
    return;
  }
  if ((page === 'login.html' || page === 'signup.html') && session) {
    window.location.href = 'dashboard.html';
    return;
  }

  if (session) {
    // Enforce session persistence policy: require active remember-me OR same-tab session flag.
    // Without one of these, the browser was closed without "Remember me" → force re-login.
    if (isPrivate) {
      const rememberUntil = parseInt(localStorage.getItem('zo_remember_until') || '0');
      const hasRemember   = localStorage.getItem('zo_remember') === '1' && Date.now() < rememberUntil;
      const hasTabSession = sessionStorage.getItem('zo_session_only') === '1';
      if (!hasRemember && !hasTabSession) {
        await sb.auth.signOut({ scope: 'local' });
        window.location.href = 'login.html';
        return;
      }
    }
    populateUserUI(session.user);
    subscribeToRealtimeUpdates(session.user.id);
    _updatePublicNav(true);
    if (isPrivate && window._startSessionLock) window._startSessionLock();
  } else {
    _updatePublicNav(false);
  }
}

// ── Public nav: show Dashboard link when logged in ────────────
function _updatePublicNav(loggedIn) {
  if (!loggedIn) return;
  const signIn = document.querySelector('.nav-actions a[href="login.html"]');
  if (signIn) { signIn.href = 'dashboard.html'; signIn.textContent = 'Dashboard'; }
  const open = document.querySelector('.nav-actions a[href="signup.html"].btn-primary');
  if (open) open.style.display = 'none';
  // Mobile drawer
  const mSignIn = document.querySelector('.mnav-actions a[href="login.html"]');
  if (mSignIn) { mSignIn.href = 'dashboard.html'; mSignIn.textContent = 'Go to Dashboard'; }
  const mOpen = document.querySelector('.mnav-actions a[href="signup.html"]');
  if (mOpen) mOpen.style.display = 'none';
}

// ── Populate UI with real user data ──────────────────────────
async function populateUserUI(user) {
  if (!user) return;

  // Start with metadata (available immediately, no extra round-trip)
  let name = user.user_metadata?.full_name
          || user.email?.split('@')[0]
          || 'Member';

  // Fetch richer profile from DB
  if (window._supabase) {
    const { data: profile } = await window._supabase
      .from('profiles')
      .select('full_name, banking_tier')
      .eq('id', user.id)
      .single();
    if (profile?.full_name) name = profile.full_name;
  }

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Sidebar name + avatar
  document.querySelectorAll('.sidebar-user-name, #sidebarName').forEach(el => el.textContent = name);
  document.querySelectorAll('.sidebar-avatar, #topbarAvatar').forEach(el => {
    // Only replace placeholder initials (avoid overwriting icons)
    if (/^[A-Z]{1,2}$/.test(el.textContent.trim())) el.textContent = initials;
  });
  document.querySelectorAll('#welcomeName').forEach(el => el.textContent = name.split(' ')[0]);
  document.querySelectorAll('#cardholderName').forEach(el => el.textContent = name.toUpperCase());

  const lastLoginEl = document.getElementById('lastLogin');
  if (lastLoginEl && user.last_sign_in_at) {
    lastLoginEl.textContent = new Date(user.last_sign_in_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}

// ── Login form ────────────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('loginBtn');
    const spinner  = document.getElementById('loginSpinner');

    // Clear prior errors
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('emailError').classList.add('hidden');

    if (!email || !password) { _showLoginError('Please fill in all fields.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('emailError').classList.remove('hidden');
      return;
    }

    document.getElementById('loginBtnText').textContent = 'Signing in…';
    spinner.classList.remove('hidden');
    btn.disabled = true;

    if (!window._supabase) {
      // Demo mode
      await new Promise(r => setTimeout(r, 1200));
      window.location.href = 'dashboard.html';
      return;
    }

    const rememberMe = document.getElementById('rememberMe')?.checked;
    const { error } = await window._supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const friendly = error.message.toLowerCase().includes('invalid')
        ? 'Incorrect email or password. Please try again.'
        : error.message;
      _showLoginError(friendly);
      document.getElementById('loginBtnText').textContent = 'Sign In Securely';
      spinner.classList.add('hidden');
      btn.disabled = false;
    } else {
      // Set persistence flags after successful login
      localStorage.removeItem('zo_remember');
      localStorage.removeItem('zo_remember_until');
      sessionStorage.removeItem('zo_session_only');
      if (rememberMe) {
        localStorage.setItem('zo_remember', '1');
        localStorage.setItem('zo_remember_until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
      } else {
        sessionStorage.setItem('zo_session_only', '1');
      }
      window.location.href = 'dashboard.html';
    }
  });
}

function _showLoginError(msg) {
  document.getElementById('loginErrorMsg').textContent = msg;
  document.getElementById('loginError').classList.remove('hidden');
}
// Expose so login.html inline script can call it too
window.showLoginError = _showLoginError;

// ── Sign Up ───────────────────────────────────────────────────
async function createAccount() {
  const sb = window._supabase;
  if (!sb) return { success: true, demo: true }; // demo mode

  const email    = document.getElementById('signupEmail')?.value.trim();
  const password = document.getElementById('newPassword')?.value;
  const first    = document.getElementById('firstName')?.value.trim() || '';
  const last     = document.getElementById('lastName')?.value.trim()  || '';

  if (!email || !password) return { success: false, error: 'Email and password are required.' };

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name:     `${first} ${last}`.trim(),
        phone:         document.getElementById('phone')?.value?.trim()     || '',
        address:       document.getElementById('address')?.value?.trim()   || '',
        city:          document.getElementById('city')?.value?.trim()      || '',
        state:         document.getElementById('state')?.value?.trim()     || '',
        date_of_birth: document.getElementById('dob')?.value               || null,
        ssn_last_four: document.getElementById('ssnLast4')?.value?.trim()  || '',
        account_type:  window._signupAccountType || 'checking',
      },
    },
  });

  if (error) return { success: false, error: error.message };

  // Supabase returns a user with empty identities if the email already exists
  if (data.user?.identities?.length === 0) {
    return { success: false, error: 'An account with this email already exists. Please sign in.' };
  }

  return { success: true, user: data.user };
}

// ── OTP Verify ───────────────────────────────────────────────
async function verifyOTP(email, token) {
  const sb = window._supabase;
  if (!sb) { showSuccess(); return; }

  const { error } = await sb.auth.verifyOtp({ email, token, type: 'signup' });

  if (error) {
    if (typeof showError === 'function') showError(error.message);
    const t = document.getElementById('verifyBtnText');
    const s = document.getElementById('verifySpinner');
    const b = document.getElementById('verifyBtn');
    if (t) t.textContent = 'Verify & Continue';
    if (s) s.classList.add('hidden');
    if (b) b.disabled = false;
  } else {
    showSuccess();
  }
}

// ── Password Reset ────────────────────────────────────────────
async function sendPasswordReset(email) {
  const sb = window._supabase;
  if (!sb) return { success: true, demo: true };
  if (!email) return { success: false, error: 'Please enter your email address.' };

  const origin   = window.location.origin;
  const base     = window.location.pathname.replace(/forgot-password\.html.*/, '');
  const redirect = `${origin}${base}reset-password.html`;

  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
  return error ? { success: false, error: error.message } : { success: true };
}

async function updatePassword(newPassword) {
  const sb = window._supabase;
  if (!sb) return { success: true, demo: true };
  const { error } = await sb.auth.updateUser({ password: newPassword });
  return error ? { success: false, error: error.message } : { success: true };
}

// ── Logout ────────────────────────────────────────────────────
async function logout() {
  localStorage.removeItem('zo_remember');
  localStorage.removeItem('zo_remember_until');
  sessionStorage.removeItem('zo_session_only');
  if (window._supabase) {
    // If Face ID is enrolled on this device, sign out locally so the refresh
    // token stays valid for biometric re-entry. Otherwise revoke globally.
    const faceIdOn = window.ZenithFaceID && window.ZenithFaceID.isEnrolled();
    try { await window._supabase.auth.signOut({ scope: faceIdOn ? 'local' : 'global' }); }
    catch { await window._supabase.auth.signOut(); }
  }
  window.location.href = 'login.html';
}
document.querySelectorAll('#logoutBtn').forEach(btn => btn?.addEventListener('click', logout));

// ── Realtime account balance subscription ────────────────────
function subscribeToRealtimeUpdates(userId) {
  if (!window._supabase || !userId) return;
  window._supabase
    .channel('accounts-realtime')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'accounts',
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      if (typeof onAccountUpdate === 'function') onAccountUpdate(payload.new);
    })
    .subscribe();
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (window._supabase) {
    checkAuthGuard();
  } else {
    document.addEventListener('supabaseReady', checkAuthGuard);

    // Demo mode: if Supabase isn't configured after 1 s, populate with demo data
    setTimeout(() => {
      if (!window._supabase) {
        const page = window.location.pathname.split('/').pop() || '';
        if (PRIVATE_PAGES.some(p => page.includes(p))) {
          populateUserUI({
            email: 'demo@zenithone.com',
            user_metadata: { full_name: 'Alexandra Reynolds' },
            last_sign_in_at: new Date().toISOString(),
          });
        }
      }
    }, 1000);
  }
});

// ── Session inactivity lock ───────────────────────────────────
// Runs only on private pages (started by checkAuthGuard above).
// Locks after 2 min idle; requires Face ID or password to unlock.
(function () {
  const TIMEOUT_MS = 120000;
  let _timer = null, _locked = false, _el = null;

  const FID_SVG = '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10h.01M15 10h.01"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/></svg>';

  function _build() {
    if (_el) return;
    _el = document.createElement('div');
    _el.id = 'z-session-lock';
    _el.style.cssText = 'display:none;position:fixed;inset:0;z-index:1800;background:rgba(3,7,18,.93);backdrop-filter:blur(20px);align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    _el.innerHTML = `
      <div style="width:360px;max-width:100%;text-align:center;background:linear-gradient(165deg,#0b1829,#060e1c);border:1px solid rgba(201,168,76,.2);border-radius:24px;padding:42px 36px 36px;box-shadow:0 40px 120px rgba(0,0,0,.8);position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.65) 50%,transparent);border-radius:24px 24px 0 0;"></div>
        <div style="width:58px;height:58px;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.22);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;">
          <svg width="24" height="24" fill="none" stroke="#c9a84c" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style="font-family:'Cormorant Garamond','Georgia',serif;font-size:1.85rem;font-weight:300;color:#fff;margin-bottom:10px;line-height:1.1;">Session Locked</div>
        <div style="font-size:.83rem;color:rgba(255,255,255,.42);line-height:1.65;margin-bottom:32px;">Locked after 2 minutes of inactivity.<br>Verify your identity to continue.</div>
        <button id="z-lock-fid" style="width:100%;padding:13px 16px;border-radius:11px;border:1px solid rgba(201,168,76,.32);background:rgba(201,168,76,.1);color:#e8d07a;font-size:.88rem;font-weight:500;cursor:pointer;margin-bottom:10px;display:none;align-items:center;justify-content:center;gap:10px;transition:all .18s;"></button>
        <button id="z-lock-pwd" style="width:100%;padding:13px 16px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.65);font-size:.88rem;cursor:pointer;transition:all .18s;">Sign in with Password</button>
      </div>`;
    document.body.appendChild(_el);

    _el.querySelector('#z-lock-fid').addEventListener('click', async function () {
      this.disabled = true; this.style.opacity = '.5';
      try {
        await window.ZenithFaceID.verify('Unlock your ZenithOne session');
        _hide();
      } catch { this.disabled = false; this.style.opacity = ''; }
    });
    _el.querySelector('#z-lock-pwd').addEventListener('click', () => logout());
  }

  function _show() {
    if (_locked) return;
    _locked = true;
    _build();
    const fid = _el.querySelector('#z-lock-fid');
    const hasFid = window.ZenithFaceID && window.ZenithFaceID.isEnrolled() && window.ZenithFaceID.loginEnabled();
    fid.innerHTML = FID_SVG + ' Unlock with Face ID';
    fid.disabled = false; fid.style.opacity = '';
    fid.style.display = hasFid ? 'flex' : 'none';
    _el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function _hide() {
    _locked = false;
    if (_el) _el.style.display = 'none';
    document.body.style.overflow = '';
    _arm();
  }

  function _arm() { clearTimeout(_timer); _timer = setTimeout(_show, TIMEOUT_MS); }
  function _ping() { if (!_locked) _arm(); }

  const EVS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  window._startSessionLock = function () {
    EVS.forEach(e => window.addEventListener(e, _ping, { passive: true, capture: true }));
    _arm();
  };
})();
