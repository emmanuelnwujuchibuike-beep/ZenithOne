/**
 * ZenithOne Credit Union — Cards Module
 */

async function loadCards() {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  try {
    const result = await callEdgeFunction('card-operations', {
      action: 'list',
      user_id: session.user.id,
    });
    renderCards(result.cards || []);
  } catch (err) {
    console.warn('Card data unavailable:', err.message);
  }
}

async function freezeCard(cardId, freeze) {
  if (!window._supabase) {
    return { success: true };
  }
  const { data: { session } } = await window._supabase.auth.getSession();
  return callEdgeFunction('card-operations', {
    action:  freeze ? 'freeze' : 'unfreeze',
    card_id: cardId,
    user_id: session.user.id,
  });
}

function renderCards(cards) {
  // Populate card data into the UI when connected to Supabase
  console.log('Cards loaded:', cards.length);
}

document.addEventListener('DOMContentLoaded', loadCards);
document.addEventListener('supabaseReady', loadCards);
