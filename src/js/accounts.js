/**
 * ZenithOne Credit Union — Accounts Module
 */

async function loadAccounts() {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  const { data: accounts, error } = await window._supabase
    .from('accounts')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load accounts:', error.message); return; }
  renderAccounts(accounts || []);
}

function renderAccounts(accounts) {
  const container = document.getElementById('accountsContainer');
  if (!container || !accounts.length) return;

  const totalNet = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const netWorthEl = document.getElementById('netWorth');
  if (netWorthEl) netWorthEl.textContent = '$' + totalNet.toLocaleString('en-US',{minimumFractionDigits:2});
}

async function openNewAccount(type, initialDeposit, nickname) {
  if (!window._supabase) return;
  try {
    const result = await callEdgeFunction('create-account', { type, initial_deposit: initialDeposit, nickname });
    if (result.success) {
      alert(`Account opened! Account number: ${result.account_number}`);
      loadAccounts();
    }
  } catch (err) {
    alert('Failed to open account: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', loadAccounts);
document.addEventListener('supabaseReady', loadAccounts);
