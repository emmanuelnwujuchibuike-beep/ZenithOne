/**
 * ZenithOne Credit Union — Transfer Module
 */

async function processTransfer() {
  const fromEl   = document.getElementById('fromAccount');
  const toEl     = document.getElementById('toAccount');
  const amountEl = document.getElementById('transferAmount');
  const memoEl   = document.getElementById('transferMemo');
  const dateEl   = document.getElementById('transferDate');

  const payload = {
    from_account_type: fromEl?.value,
    to_account_type:   toEl?.value,
    amount:            parseFloat(amountEl?.value || 0),
    memo:              memoEl?.value || '',
    scheduled_date:    dateEl?.value || new Date().toISOString().split('T')[0],
  };

  if (!window._supabase) {
    await new Promise(r => setTimeout(r, 1600));
    closeModal('confirmModal');
    showTransferSuccess(payload.amount);
    return;
  }

  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  try {
    const result = await callEdgeFunction('transfer-funds', {
      ...payload,
      user_id: session.user.id,
    });
    closeModal('confirmModal');
    if (result.success) showTransferSuccess(payload.amount, result.reference);
    else showTransferError(result.message);
  } catch (err) {
    closeModal('confirmModal');
    showTransferError(err.message);
  }
}

function showTransferSuccess(amount, ref = '') {
  const refStr = ref ? ` Reference: #${ref}` : '';
  const banner = document.createElement('div');
  banner.className = 'alert alert-success';
  banner.style.cssText = 'position:fixed;top:80px;right:24px;z-index:3000;min-width:320px;box-shadow:0 8px 30px rgba(0,0,0,.4);';
  banner.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg><span>Transfer of $${parseFloat(amount).toFixed(2)} completed successfully.${refStr}</span>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 5000);
}

function showTransferError(msg) {
  zenithToast('Transfer failed: ' + msg, 'error');
}
