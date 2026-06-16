/**
 * ZenithOne Credit Union — Investments Module
 */

async function loadInvestmentData() {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  try {
    const result = await callEdgeFunction('investment-data', {
      user_id: session.user.id,
    });
    renderInvestmentStats(result);
  } catch (err) {
    console.warn('Investment data unavailable:', err.message);
  }
}

function renderInvestmentStats(data) {
  if (!data) return;
  const { total_value, total_gain_loss, gain_loss_pct, dividends_ytd } = data;
  // Update stat cards when connected to live Supabase data
  console.log('Portfolio:', total_value, 'Gain/Loss:', total_gain_loss);
}

document.addEventListener('DOMContentLoaded', loadInvestmentData);
if (window._supabase) loadInvestmentData();
else document.addEventListener('supabaseReady', loadInvestmentData);
