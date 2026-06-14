/**
 * ZenithOne Credit Union — Card Operations Edge Function
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

interface CardBody {
  action:     'list' | 'get_accounts' | 'freeze' | 'unfreeze' | 'block' | 'close' | 'top_up' | 'withdraw' | 'update_controls' | 'report_lost' | 'mark_found' | 'pricing';
  card_id?:   string;
  account_id?: string;
  amount?:    number;
  updates?:   Record<string, unknown>;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = getAuthToken(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    const body = await req.json() as CardBody;
    const { action, card_id, account_id, amount, updates } = body;

    switch (action) {

      // ── List all owned cards (every status except cancelled) ─────────────
      case 'list': {
        const { data: cards, error } = await supabase
          .from('cards')
          .select('id, card_number_last_four, card_number_token, card_type, card_tier, card_name, expiry_month, expiry_year, cardholder_name, status, credit_limit, available_credit, current_balance, rewards_points, allow_international, allow_online, allow_atm, daily_limit, payment_due_date')
          .eq('user_id', user.id)
          .not('status', 'in', '("cancelled","expired")')
          .order('created_at');
        if (error) throw error;
        return json({ cards: cards || [] });
      }

      // ── User's active accounts (for fund/withdraw account selector) ─────────
      case 'get_accounts': {
        const { data: accounts, error: accErr } = await supabase
          .from('accounts')
          .select('id, account_type, balance, account_number')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('account_type');
        if (accErr) throw accErr;
        return json({ accounts: accounts || [] });
      }

      // ── Current card pricing (admin-editable base fees) ───────────────────
      case 'pricing': {
        const { data: rows } = await supabase.from('card_pricing').select('card_type_key, base_fee');
        const prices: Record<string, number> = {};
        for (const r of rows ?? []) prices[r.card_type_key] = Number(r.base_fee);
        return json({ prices, surcharges: { 'Visa': 0, 'Discover': 30, 'Mastercard': 60, 'American Express': 120 } });
      }

      // ── Freeze ────────────────────────────────────────────────────────────
      case 'freeze': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase.from('cards')
          .update({ status: 'frozen', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Frozen', message: 'Your card has been frozen. All transactions will be declined.', type: 'security', priority: 'high' });
        return json({ success: true, status: 'frozen' });
      }

      // ── Unfreeze ──────────────────────────────────────────────────────────
      case 'unfreeze': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase.from('cards')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Unfrozen', message: 'Your card is now active and ready for use.', type: 'security', priority: 'normal' });
        return json({ success: true, status: 'active' });
      }

      // ── Block (permanent, requires admin to unblock) ───────────────────
      case 'block': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase.from('cards')
          .update({ status: 'blocked', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Blocked', message: 'Your card has been permanently blocked. Contact support to reactivate.', type: 'security', priority: 'urgent' });
        return json({ success: true, status: 'blocked' });
      }

      // ── Close / Disband card ──────────────────────────────────────────────
      case 'close': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase.from('cards')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Closed', message: 'Your card has been permanently closed. Any remaining balance will be returned within 5–7 business days.', type: 'account', priority: 'high' });
        return json({ success: true, status: 'cancelled', message: 'Card has been permanently closed.' });
      }

      // ── Top Up card (transfer from any account to card) ──────────────────
      case 'top_up': {
        if (!card_id || !amount || amount <= 0) throw new Error('card_id and a positive amount are required');

        const { data: card, error: cardErr } = await supabase
          .from('cards').select('*').eq('id', card_id).eq('user_id', user.id).single();
        if (cardErr || !card) throw new Error('Card not found');
        if (card.status !== 'active') throw new Error('Card must be active to top up');

        // Resolve source account: use specified account_id, or fallback checking → any active
        let account: Record<string, unknown> | null = null;
        if (account_id) {
          const { data: acc } = await supabase
            .from('accounts').select('*').eq('id', account_id).eq('user_id', user.id).eq('status', 'active').single();
          if (!acc) throw new Error('The selected account was not found or is not active.');
          account = acc;
        } else {
          const { data: accs } = await supabase
            .from('accounts').select('*').eq('user_id', user.id).eq('status', 'active').order('created_at');
          account = (accs || []).find(a => a.account_type === 'checking') || (accs || [])[0] || null;
          if (!account) throw new Error('No active account found. Please open an account first.');
        }
        if ((Number(account.balance) ?? 0) < amount) throw new Error(`Insufficient funds. Your ${account.account_type} balance is $${(Number(account.balance) ?? 0).toFixed(2)}`);

        // Deduct from checking account via transaction (trigger handles balance update)
        const { error: txErr } = await supabase.from('transactions').insert({
          account_id:       account.id,
          user_id:          user.id,
          amount:           amount,
          transaction_type: 'debit',
          status:           'completed',
          description:      `Card top-up — ending ${card.card_number_last_four ?? '••••'}`,
          reference_number: `TOP${Date.now()}`,
        });
        if (txErr) throw txErr;

        // Add to card's available credit / balance
        const newAvail = (card.available_credit ?? 0) + amount;
        await supabase.from('cards').update({ available_credit: newAvail, updated_at: new Date().toISOString() }).eq('id', card_id);

        const accTypeLabel = String(account.account_type || 'account').replace('_', ' ');
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Funded', message: `$${amount.toFixed(2)} transferred from your ${accTypeLabel} to card ending ${card.card_number_last_four ?? '••••'}.`, type: 'transaction', priority: 'normal' });
        return json({ success: true, message: `$${amount.toFixed(2)} added to card from your ${accTypeLabel}`, new_available: newAvail });
      }

      // ── Withdraw from card (transfer card balance to any account) ────────
      case 'withdraw': {
        if (!card_id || !amount || amount <= 0) throw new Error('card_id and a positive amount are required');

        const { data: card, error: cardErr } = await supabase
          .from('cards').select('*').eq('id', card_id).eq('user_id', user.id).single();
        if (cardErr || !card) throw new Error('Card not found');
        if (card.status !== 'active') throw new Error('Card must be active to withdraw');

        const available = Number(card.available_credit) ?? 0;
        if (available < amount) throw new Error(`Insufficient card balance. Available: $${available.toFixed(2)}`);

        // Resolve destination account: use specified account_id, or fallback checking → any active
        let account: Record<string, unknown> | null = null;
        if (account_id) {
          const { data: acc } = await supabase
            .from('accounts').select('*').eq('id', account_id).eq('user_id', user.id).eq('status', 'active').single();
          if (!acc) throw new Error('The selected account was not found or is not active.');
          account = acc;
        } else {
          const { data: accs } = await supabase
            .from('accounts').select('*').eq('user_id', user.id).eq('status', 'active').order('created_at');
          account = (accs || []).find(a => a.account_type === 'checking') || (accs || [])[0] || null;
          if (!account) throw new Error('No active account found. Please open an account first.');
        }

        // Credit the checking account via transaction
        const { error: txErr } = await supabase.from('transactions').insert({
          account_id:       account.id,
          user_id:          user.id,
          amount:           amount,
          transaction_type: 'credit',
          status:           'completed',
          description:      `Card withdrawal — ending ${card.card_number_last_four ?? '••••'}`,
          reference_number: `WDR${Date.now()}`,
        });
        if (txErr) throw txErr;

        // Reduce card available credit
        const newAvail = available - amount;
        await supabase.from('cards').update({ available_credit: newAvail, updated_at: new Date().toISOString() }).eq('id', card_id);

        const destTypeLabel = String(account.account_type || 'account').replace('_', ' ');
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Withdrawal', message: `$${amount.toFixed(2)} withdrawn from card ending ${card.card_number_last_four ?? '••••'} to your ${destTypeLabel}.`, type: 'transaction', priority: 'normal' });
        return json({ success: true, message: `$${amount.toFixed(2)} withdrawn to your ${destTypeLabel}`, new_available: newAvail });
      }

      // ── Update card controls ──────────────────────────────────────────────
      case 'update_controls': {
        if (!card_id || !updates) throw new Error('card_id and updates required');
        const allowed = ['allow_international', 'allow_online', 'allow_atm', 'daily_limit', 'transaction_limit'];
        const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) { if (key in updates) safe[key] = updates[key]; }
        const { error } = await supabase.from('cards').update(safe).eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        return json({ success: true, updated: safe });
      }

      // ── Report lost / stolen ──────────────────────────────────────────────
      case 'report_lost': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase.from('cards')
          .update({ status: 'stolen', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Reported Lost/Stolen', message: 'Your card has been suspended. If you find it, you can mark it as found in the Cards section.', type: 'security', priority: 'urgent' });
        return json({ success: true, status: 'stolen', replacement_eta: '2–4 business days' });
      }

      // ── Mark found (reactivate a reported-lost card) ──────────────────────
      case 'mark_found': {
        if (!card_id) throw new Error('card_id required');
        const { data: card, error: cardErr } = await supabase
          .from('cards').select('status').eq('id', card_id).eq('user_id', user.id).single();
        if (cardErr || !card) throw new Error('Card not found');
        if (card.status !== 'stolen') throw new Error('Only cards reported as lost can be marked as found.');
        const { error } = await supabase.from('cards')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Reactivated', message: 'Your card has been reactivated and is ready for use. If you did not do this, contact support immediately.', type: 'security', priority: 'high' });
        return json({ success: true, status: 'active' });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (err) {
    return errJson(err);
  }
});
