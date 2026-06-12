/**
 * ZenithOne Credit Union — Authentication Module
 * Handles login, signup, logout, session management, and auth guards.
 */

const PUBLIC_PAGES  = ['index.html', 'login.html', 'signup.html', 'forgot-password.html', ''];
const PRIVATE_PAGES = ['dashboard.html','accounts.html','transactions.html','transfer.html','cards.html','investments.html','settings.html'];

// ── Session Guard ──
async function checkAuthGuard() {
  if (!window._supabase) return;
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const isPrivate = PRIVATE_PAGES.some(p => page.includes(p));
  const isPublic  = PUBLIC_PAGES.some(p => page.includes(p));

  const { data: { session } } = await window._supabase.auth.getSession();

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
  }
}

// ── Populate UI with user data ──
async function populateUserUI(user) {
  if (!user) return;
  const { data: profile } = await window._supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const name = profile?.full_name || user.email?.split('@')[0] || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);

  document.querySelectorAll('#sidebarName').forEach(el => el.textContent = name);
  document.querySelectorAll('#sidebarAvatar, #topbarAvatar').forEach(el => el.textContent = initials);
  document.querySelectorAll('#welcomeName').forEach(el => el.textContent = name.split(' ')[0]);
  document.querySelectorAll('#cardholderName').forEach(el => el.textContent = name.toUpperCase());

  // Last login
  const lastLogin = document.getElementById('lastLogin');
  if (lastLogin && user.last_sign_in_at) {
    lastLogin.textContent = new Date(user.last_sign_in_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
}

// ── Login ──
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('loginBtn');
    const spinner  = document.getElementById('loginSpinner');
    const errEl    = document.getElementById('loginError');

    if (!email || !password) {
      showLoginError('Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('emailError').classList.remove('hidden');
      return;
    }

    document.getElementById('loginBtnText').textContent = 'Signing in...';
    spinner.classList.remove('hidden');
    btn.disabled = true;
    errEl.classList.add('hidden');

    if (!window._supabase) {
      // Demo mode: simulate login
      await new Promise(r => setTimeout(r, 1400));
      window.location.href = 'dashboard.html';
      return;
    }

    const { error } = await window._supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showLoginError(error.message);
      document.getElementById('loginBtnText').textContent = 'Sign In Securely';
      spinner.classList.add('hidden');
      btn.disabled = false;
    } else {
      window.location.href = 'dashboard.html';
    }
  });
}

function showLoginError(msg) {
  document.getElementById('loginErrorMsg').textContent = msg;
  document.getElementById('loginError').classList.remove('hidden');
}

// ── Sign Up ──
async function createAccount() {
  const email    = document.getElementById('signupEmail')?.value.trim();
  const password = document.getElementById('newPassword')?.value;
  const firstName = document.getElementById('firstName')?.value.trim();
  const lastName  = document.getElementById('lastName')?.value.trim();

  if (!window._supabase || !email || !password) return;

  const { data, error } = await window._supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: `${firstName} ${lastName}`,
        phone: document.getElementById('phone')?.value,
      },
      emailRedirectTo: window.location.origin + '/dashboard.html',
    },
  });

  if (error) {
    showError(error.message);
    return;
  }

  if (data.user) {
    await window._supabase.from('profiles').upsert({
      id:          data.user.id,
      full_name:   `${firstName} ${lastName}`,
      phone:       document.getElementById('phone')?.value,
      address:     document.getElementById('address')?.value,
      city:        document.getElementById('city')?.value,
      state:       document.getElementById('state')?.value,
    });
  }
}

// ── OTP Verify ──
async function verifyOTP(email, token) {
  if (!window._supabase) {
    showSuccess();
    return;
  }
  const { error } = await window._supabase.auth.verifyOtp({ email, token, type: 'signup' });
  if (error) {
    showError(error.message);
    document.getElementById('verifyBtnText').textContent = 'Verify & Continue';
    document.getElementById('verifySpinner').classList.add('hidden');
    document.getElementById('verifyBtn').disabled = false;
  } else {
    showSuccess();
  }
}

// ── Logout ──
async function logout() {
  if (window._supabase) await window._supabase.auth.signOut();
  window.location.href = 'login.html';
}
document.querySelectorAll('#logoutBtn').forEach(btn => btn?.addEventListener('click', logout));

// ── Realtime account balance subscription ──
function subscribeToRealtimeUpdates(userId) {
  if (!window._supabase || !userId) return;
  window._supabase
    .channel('accounts-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'accounts',
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      if (typeof onAccountUpdate === 'function') onAccountUpdate(payload.new);
    })
    .subscribe();
}

// Run auth guard on page load
document.addEventListener('DOMContentLoaded', () => {
  if (window._supabase) {
    checkAuthGuard();
  } else {
    document.addEventListener('supabaseReady', checkAuthGuard);
    // Fallback if Supabase not configured: allow demo mode
    setTimeout(() => {
      if (!window._supabase) {
        const page = window.location.pathname.split('/').pop();
        if (PRIVATE_PAGES.some(p => page.includes(p))) {
          const isDemo = true;
          if (isDemo) {
            populateUserUI({ email: 'demo@zenithonecreditunion.com', last_sign_in_at: new Date().toISOString() });
          }
        }
      }
    }, 800);
  }
});
