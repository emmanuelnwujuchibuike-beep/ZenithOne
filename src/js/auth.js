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
    populateUserUI(session.user);
    subscribeToRealtimeUpdates(session.user.id);
    _updatePublicNav(true);
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
  if (window._supabase) await window._supabase.auth.signOut();
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

// ── Secret admin gesture: hold sidebar logo for 3 seconds ────
(function attachAdminGesture() {
  function init() {
    const logo = document.querySelector('.sidebar-logo-mark');
    if (!logo) return;

    let holdTimer = null;
    let progressEl = null;

    function startHold(e) {
      if (window.location.pathname.includes('admin.html')) return;
      e.preventDefault();

      progressEl = document.createElement('div');
      progressEl.style.cssText = [
        'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(201,168,76,.15)', 'border:1px solid rgba(201,168,76,.4)',
        'border-radius:99px', 'padding:8px 20px', 'font-size:.75rem',
        'letter-spacing:.1em', 'color:var(--gold-400)', 'z-index:9999',
        'pointer-events:none', 'transition:opacity .2s',
      ].join(';');
      progressEl.textContent = 'Hold to access admin…';
      document.body.appendChild(progressEl);

      logo.style.transition = 'box-shadow .3s';
      logo.style.boxShadow  = '0 0 0 0 rgba(201,168,76,0)';

      let elapsed = 0;
      holdTimer = setInterval(() => {
        elapsed += 50;
        const pct = elapsed / 3000;
        logo.style.boxShadow = `0 0 ${Math.round(pct * 18)}px rgba(201,168,76,${(pct * .7).toFixed(2)})`;
        if (elapsed >= 3000) {
          clearInterval(holdTimer); holdTimer = null;
          window.location.href = 'admin.html';
        }
      }, 50);
    }

    function cancelHold() {
      if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
      if (progressEl) { progressEl.remove(); progressEl = null; }
      logo.style.boxShadow = '';
    }

    logo.addEventListener('mousedown',  startHold);
    logo.addEventListener('touchstart', startHold, { passive: false });
    logo.addEventListener('mouseup',    cancelHold);
    logo.addEventListener('mouseleave', cancelHold);
    logo.addEventListener('touchend',   cancelHold);
    logo.addEventListener('touchcancel',cancelHold);
    logo.addEventListener('contextmenu', e => e.preventDefault());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

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
