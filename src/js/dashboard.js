/**
 * ZenithOne Credit Union — Dashboard Module
 * Loads account summaries, recent transactions, and real-time balance updates.
 */

async function loadDashboardData() {
  if (!window._supabase) {
    loadDemoData();
    return;
  }
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  try {
    const summary = await callEdgeFunction('account-summary', { user_id: session.user.id });
    renderDashboardStats(summary);
  } catch (err) {
    console.warn('Edge function unavailable, using demo data:', err.message);
    loadDemoData();
  }
}

function renderDashboardStats(data) {
  animateNumber('totalBalance',    data.total_balance    ?? 0, '$', '');
  animateNumber('portfolioValue',  data.portfolio_value  ?? 0, '$', '');
  animateNumber('creditAvailable', data.credit_available ?? 0, '$', '');
  animateNumber('rewardPoints',    data.reward_points    ?? 0, '',  '');
  const fmt = n => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const cb = document.getElementById('checkingBal');
  const sb = document.getElementById('savingsBal');
  if (cb) cb.textContent = fmt(data.checking_balance);
  if (sb) sb.textContent = fmt(data.savings_balance);
}

function loadDemoData() {
  animateNumber('totalBalance',    0, '$', '');
  animateNumber('portfolioValue',  0, '$', '');
  animateNumber('creditAvailable', 0, '$', '');
  animateNumber('rewardPoints',    0, '',  '');
}

function animateNumber(elId, end, prefix, suffix) {
  const el = document.getElementById(elId);
  if (!el) return;
  const isDecimal = end % 1 !== 0;
  const duration  = 1600;
  const start     = performance.now();
  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = end * ease;
    el.textContent = prefix + val.toLocaleString('en-US', {
      minimumFractionDigits: isDecimal ? 2 : 0,
      maximumFractionDigits: isDecimal ? 2 : 0,
    }) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// Realtime balance update handler
function onAccountUpdate(account) {
  if (!account) return;
  if (account.account_type === 'checking') {
    const el = document.getElementById('checkingBal');
    if (el) el.textContent = '$' + account.balance.toLocaleString('en-US',{minimumFractionDigits:2});
  }
  if (account.account_type === 'savings') {
    const el = document.getElementById('savingsBal');
    if (el) el.textContent = '$' + account.balance.toLocaleString('en-US',{minimumFractionDigits:2});
  }
  // Also refresh total
  loadDashboardData();
}

document.addEventListener('DOMContentLoaded', loadDashboardData);
document.addEventListener('supabaseReady', loadDashboardData);
