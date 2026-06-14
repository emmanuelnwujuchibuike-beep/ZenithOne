/**
 * ZenithOne Credit Union — Transfer Funds Edge Function
 *
 * Actions:
 *   (no action)  → internal transfer between the caller's OWN accounts (legacy)
 *   'lookup'     → resolve an account number to its owner's name (for confirmation)
 *   'send'       → user-to-user transfer by account number (requires 4-digit PIN)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const DAILY_TRANSFER_LIMIT  = 100_000;
const SINGLE_TRANSFER_LIMIT =  50_000;

async function hashPin(userId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${userId}:${pin}:zenithone`),
  );
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// "James Okafor" → "James O." (enough to confirm, protects full surname)
function maskName(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ZenithOne Member';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
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

    const body = await req.json() as {
      action?: string;
      // lookup / send
      account_number?: string;
      from_account_id?: string;
      to_account_number?: string;
      pin?: string;
      // legacy own-account transfer
      from_account_type?: string;
      to_account_type?: string;
      amount?: number;
      memo?: string;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // LOOKUP — resolve an account number to a confirmable recipient name
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === 'lookup') {
      const acctNo = (body.account_number || '').trim();
      if (!/^\d{10}$/.test(acctNo)) throw new Error('Enter a valid 10-digit account number.');

      const { data: acct } = await supabase
        .from('accounts')
        .select('id, user_id, account_type, status')
        .eq('account_number', acctNo)
        .eq('status', 'active')
        .maybeSingle();

      if (!acct) throw new Error('No active account found with that number.');

      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', acct.user_id).single();

      return json({
        found:          true,
        is_self:        acct.user_id === user.id,
        recipient_name: maskName(prof?.full_name || ''),
        account_type:   acct.account_type,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND — user-to-user transfer by account number (PIN required)
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === 'send') {
      const fromId  = body.from_account_id;
      const acctNo  = (body.to_account_number || '').trim();
      const amount  = Number(body.amount);
      const memo    = (body.memo || '').trim();
      const pin     = body.pin || '';

      if (!fromId)                          throw new Error('Select a source account.');
      if (!/^\d{10}$/.test(acctNo))         throw new Error('Enter a valid 10-digit recipient account number.');
      if (!amount || amount <= 0)           throw new Error('Enter a valid amount.');
      if (amount > SINGLE_TRANSFER_LIMIT)   throw new Error(`Single transfer limit is $${SINGLE_TRANSFER_LIMIT.toLocaleString()}.`);

      // Verify the caller's transaction PIN
      const { data: meProfile } = await supabase
        .from('profiles').select('transaction_pin, full_name').eq('id', user.id).single();
      if (!meProfile?.transaction_pin) throw new Error('No transaction PIN set. Create one before sending money.');
      if (!/^\d{4}$/.test(pin))        throw new Error('Enter your 4-digit PIN.');
      const pinHash = await hashPin(user.id, pin);
      if (pinHash !== meProfile.transaction_pin) throw new Error('Incorrect PIN.');

      // Source account must belong to the caller and be active
      const { data: fromAcc } = await supabase
        .from('accounts').select('*')
        .eq('id', fromId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!fromAcc) throw new Error('Source account not found.');

      // Destination account by number (may belong to another user, or the caller)
      const { data: toAcc } = await supabase
        .from('accounts').select('*')
        .eq('account_number', acctNo).eq('status', 'active').maybeSingle();
      if (!toAcc) throw new Error('No active account found with that number.');
      if (toAcc.id === fromAcc.id) throw new Error('Source and destination cannot be the same account.');

      // `balance` is the authoritative, trigger-maintained column.
      const availFunds = Number(fromAcc.balance ?? 0);
      if (availFunds < amount) throw new Error('Insufficient funds in the selected account.');

      // Daily outbound limit
      const today = new Date().toISOString().split('T')[0];
      const { data: todayTransfers } = await supabase
        .from('transactions').select('amount')
        .eq('user_id', user.id).eq('transaction_type', 'transfer_out')
        .gte('created_at', today + 'T00:00:00Z');
      const todayTotal = (todayTransfers || []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
      if (todayTotal + amount > DAILY_TRANSFER_LIMIT) {
        throw new Error(`Daily transfer limit of $${DAILY_TRANSFER_LIMIT.toLocaleString()} exceeded.`);
      }

      // Recipient name for descriptions / notifications
      const { data: toProfile } = await supabase
        .from('profiles').select('full_name').eq('id', toAcc.user_id).single();
      const senderName    = meProfile.full_name || 'a ZenithOne member';
      const recipientName = toProfile?.full_name || 'ZenithOne member';
      const reference     = 'TRF' + Date.now() + Math.floor(Math.random() * 1000);

      // Debit sender (caller's user_id)
      const { error: debitErr } = await supabase.from('transactions').insert({
        account_id:         fromAcc.id,
        user_id:            user.id,
        transaction_type:   'transfer_out',
        category:           'Transfer',
        description:        memo ? `Sent to ${maskName(recipientName)} — ${memo}` : `Sent to ${maskName(recipientName)}`,
        amount,
        status:             'completed',
        reference_number:   reference + '_OUT',
        related_account_id: toAcc.id,
      });
      if (debitErr) throw debitErr;

      // Credit recipient (recipient's user_id so it lands in THEIR history + triggers)
      const { error: creditErr } = await supabase.from('transactions').insert({
        account_id:         toAcc.id,
        user_id:            toAcc.user_id,
        transaction_type:   'transfer_in',
        category:           'Transfer',
        description:        memo ? `Received from ${maskName(senderName)} — ${memo}` : `Received from ${maskName(senderName)}`,
        amount,
        status:             'completed',
        reference_number:   reference + '_IN',
        related_account_id: fromAcc.id,
      });
      if (creditErr) throw creditErr;

      // Notifications to both parties
      await supabase.from('notifications').insert([
        {
          user_id:  user.id,
          title:    'Money Sent',
          message:  `$${amount.toFixed(2)} sent to ${maskName(recipientName)} (••••${acctNo.slice(-4)}). Ref: ${reference}`,
          type:     'transaction',
          priority: amount >= 10000 ? 'high' : 'normal',
        },
        {
          user_id:  toAcc.user_id,
          title:    'Money Received',
          message:  `You received $${amount.toFixed(2)} from ${maskName(senderName)}. Ref: ${reference}`,
          type:     'transaction',
          priority: amount >= 10000 ? 'high' : 'normal',
        },
      ]);

      await supabase.from('audit_log').insert({
        user_id:     user.id,
        action:      'transfer_send',
        resource:    'accounts',
        resource_id: fromAcc.id,
        new_values:  { amount, to_account: acctNo, reference },
        ip_address:  req.headers.get('x-real-ip') || 'unknown',
      });

      return json({
        success:        true,
        reference,
        amount,
        recipient_name: maskName(recipientName),
        new_balance:    Math.round((availFunds - amount) * 100) / 100,
        processed:      new Date().toISOString(),
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY — internal transfer between the caller's own accounts (by type)
    // ─────────────────────────────────────────────────────────────────────────
    const { from_account_type, to_account_type, amount, memo } = body;

    if (!amount || amount <= 0)                  throw new Error('Invalid transfer amount');
    if (amount > SINGLE_TRANSFER_LIMIT)          throw new Error(`Single transfer limit is $${SINGLE_TRANSFER_LIMIT.toLocaleString()}`);
    if (!from_account_type || !to_account_type)  throw new Error('Source and destination accounts required');
    if (from_account_type === to_account_type)   throw new Error('Source and destination accounts cannot be the same');

    const { data: fromAcc, error: fromErr } = await supabase
      .from('accounts').select('*')
      .eq('user_id', user.id).eq('account_type', from_account_type).eq('status', 'active').single();
    if (fromErr || !fromAcc) throw new Error('Source account not found');
    if (fromAcc.available_balance < amount) throw new Error('Insufficient funds');

    const { data: toAcc, error: toErr } = await supabase
      .from('accounts').select('*')
      .eq('user_id', user.id).eq('account_type', to_account_type).eq('status', 'active').single();
    if (toErr || !toAcc) throw new Error('Destination account not found');

    const today = new Date().toISOString().split('T')[0];
    const { data: todayTransfers } = await supabase
      .from('transactions').select('amount')
      .eq('user_id', user.id).eq('transaction_type', 'transfer_out')
      .gte('created_at', today + 'T00:00:00Z');
    const todayTotal = (todayTransfers || []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    if (todayTotal + amount > DAILY_TRANSFER_LIMIT) {
      throw new Error(`Daily transfer limit of $${DAILY_TRANSFER_LIMIT.toLocaleString()} exceeded`);
    }

    const reference = 'TRF' + Date.now() + Math.floor(Math.random() * 1000);

    const { error: debitErr } = await supabase.from('transactions').insert({
      account_id:         fromAcc.id,
      user_id:            user.id,
      transaction_type:   'transfer_out',
      category:           'Transfer',
      description:        memo || `Transfer to ${to_account_type}`,
      amount,
      status:             'completed',
      reference_number:   reference + '_OUT',
      related_account_id: toAcc.id,
    });
    if (debitErr) throw debitErr;

    const { error: creditErr } = await supabase.from('transactions').insert({
      account_id:         toAcc.id,
      user_id:            user.id,
      transaction_type:   'transfer_in',
      category:           'Transfer',
      description:        memo || `Transfer from ${from_account_type}`,
      amount,
      status:             'completed',
      reference_number:   reference + '_IN',
      related_account_id: fromAcc.id,
    });
    if (creditErr) throw creditErr;

    await supabase.from('audit_log').insert({
      user_id:     user.id,
      action:      'transfer',
      resource:    'accounts',
      resource_id: fromAcc.id,
      new_values:  { amount, from: from_account_type, to: to_account_type, reference },
      ip_address:  req.headers.get('x-real-ip') || 'unknown',
    });

    await supabase.from('notifications').insert({
      user_id:  user.id,
      title:    'Transfer Completed',
      message:  `$${amount.toFixed(2)} transferred from ${from_account_type} to ${to_account_type}. Ref: ${reference}`,
      type:     'transaction',
      priority: amount >= 10000 ? 'high' : 'normal',
    });

    return json({
      success:   true,
      reference,
      amount,
      from:      fromAcc.account_number,
      to:        toAcc.account_number,
      processed: new Date().toISOString(),
    });

  } catch (err) {
    return errJson(err);
  }
});
