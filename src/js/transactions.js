/**
 * ZenithOne Credit Union — Transactions Module
 */

async function loadTransactions(accountId = null, limit = 50) {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  try {
    const data = await callEdgeFunction('transaction-history', {
      user_id:    session.user.id,
      account_id: accountId,
      limit,
    });
    return data.transactions || [];
  } catch (err) {
    console.warn('Using local demo transactions:', err.message);
    return [];
  }
}

// Format currency
function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Category icon mapping
const categoryIcons = {
  'Shopping':     '🛍️',
  'Dining':       '🍽️',
  'Travel':       '✈️',
  'Groceries':    '🛒',
  'Health':       '🏋️',
  'Utilities':    '⚡',
  'Entertainment':'🎬',
  'Transfer':     '↗️',
  'Income':       '💵',
  'Interest':     '💰',
  'Investment':   '📈',
  'default':      '💳',
};

function getIcon(category) {
  return categoryIcons[category] || categoryIcons['default'];
}
