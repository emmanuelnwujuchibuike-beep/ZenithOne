/**
 * ZenithOne Credit Union — Transfer Funds Edge Function
 * Handles internal transfers with fraud checks and balance validation.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const DAILY_TRANSFER_LIMIT  = 100_000;
const SINGLE_TRANSFER_LIMIT =  50_000;

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
      from_account_type: string;
      to_account_type: string;
      amount: number;
      memo?: string;
      scheduled_date?: string;
    };
    const { from_account_type, to_account_type, amount, memo } = body;

    if (!amount || amount <= 0)                  throw new Error('Invalid transfer amount');
    if (amount > SINGLE_TRANSFER_LIMIT)          throw new Error(`Single transfer limit is $${SINGLE_TRANSFER_LIMIT.toLocaleString()}`);
    if (!from_account_type || !to_account_type)  throw new Error('Source and destination accounts required');
    if (from_account_type === to_account_type)   throw new Error('Source and destination accounts cannot be the same');

    // Fetch source account
    const { data: fromAcc, error: fromErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_type', from_account_type)
      .eq('status', 'active')
      .single();

    if (fromErr || !fromAcc) throw new Error('Source account not found');
    if (fromAcc.available_balance < amount) throw new Error('Insufficient funds');

    // Fetch destination account
    const { data: toAcc, error: toErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_type', to_account_type)
      .eq('status', 'active')
      .single();

    if (toErr || !toAcc) throw new Error('Destination account not found');

    // Daily limit check
    const today = new Date().toISOString().split('T')[0];
    const { data: todayTransfers } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('transaction_type', 'transfer_out')
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
