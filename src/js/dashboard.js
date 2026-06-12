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
  animateNumber('totalBalance',   data.total_balance   || 1047001.17, '$', '');
  animateNumber('portfolioValue', data.portfolio_value || 1842694.00, '$', '');
  animateNumber('creditAvailable',data.credit_available|| 38720.00,   '$', '');
  animateNumber('rewardPoints',   data.reward_points   || 124840,      '',  '');
  if (data.checking_balance !== undefined)
    document.getElementById('checkingBal').textContent = '$' + data.checking_balance.toLocaleString('en-US',{minimumFractionDigits:2});
  if (data.savings_balance !== undefined)
    document.getElementById('savingsBal').textContent  = '$' + data.savings_balance.toLocaleString('en-US',{minimumFractionDigits:2});
}

function loadDemoData() {
  animateNumber('totalBalance',    1047001.17,  '$', '');
  animateNumber('portfolioValue',  1842694.00,  '$', '');
  animateNumber('creditAvailable',   38720.00,  '$', '');
  animateNumber('rewardPoints',       124840,    '',  '');
  setTimeout(() => {
    const cb = document.getElementById('checkingBal');
    const sb = document.getElementById('savingsBal');
    if (cb) cb.textContent = '$124,582.74';
    if (sb) sb.textContent = '$892,418.33';
  }, 800);
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
