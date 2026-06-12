/**
 * ZenithOne Credit Union — Admin Data Edge Function
 * Read-only admin dashboard: stats, users list, recent transactions.
 * Requires is_admin = true in the caller's profile.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!profile?.is_admin) throw new Error('Forbidden: admin access required');

    const body = await req.json() as { action?: string };
    const action = body.action ?? 'stats';

    if (action === 'stats') {
      const [
        { count: userCount },
        { count: txnCount },
        { data: accounts },
        { data: recentTxns },
        { data: recentUsers },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('accounts').select('balance').eq('status', 'active'),
        supabase.from('transactions').select('id,description,amount,transaction_type,category,created_at,user_id').order('created_at', { ascending: false }).limit(20),
        supabase.from('profiles').select('id,full_name,email,created_at').order('created_at', { ascending: false }).limit(5),
      ]);

      const totalDeposits = (accounts || []).reduce((s: number, a: { balance: number }) => s + (a.balance || 0), 0);

      return json({
        user_count:           userCount   ?? 0,
        transaction_count:    txnCount    ?? 0,
        total_deposits:       Math.round(totalDeposits * 100) / 100,
        recent_transactions:  recentTxns  ?? [],
        recent_users:         recentUsers ?? [],
      });
    }

    if (action === 'users') {
      const { data: users, error: usersErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, banking_tier, created_at, is_admin')
        .order('created_at', { ascending: false });

      if (usersErr) throw usersErr;

      const { data: accounts } = await supabase
        .from('accounts')
        .select('user_id, account_type, balance, status, account_number')
        .eq('status', 'active');

      const accMap: Record<string, { type: string; balance: number; number: string }[]> = {};
      for (const a of accounts ?? []) {
        if (!accMap[a.user_id]) accMap[a.user_id] = [];
        accMap[a.user_id].push({ type: a.account_type, balance: a.balance, number: a.account_number });
      }

      return json({
        users: (users ?? []).map((u: Record<string, unknown>) => ({
          ...u,
          accounts:      accMap[u.id as string] ?? [],
          total_balance: (accMap[u.id as string] ?? []).reduce((s, a) => s + (a.balance || 0), 0),
        })),
      });
    }

    if (action === 'add_funds') {
      const { user_id, account_type, amount, note } = body as {
        action: string; user_id: string; account_type: string; amount: number; note?: string;
      };
      if (!user_id || !account_type || !amount || amount <= 0) {
        throw new Error('Missing or invalid: user_id, account_type, amount');
      }

      const { data: account, error: accErr } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', user_id)
        .eq('account_type', account_type)
        .eq('status', 'active')
        .single();
      if (accErr || !account) throw new Error(`No active ${account_type} account found for this user`);

      const { error: txnErr } = await supabase
        .from('transactions')
        .insert({
          user_id,
          account_id:       account.id,
          transaction_type: 'deposit',
          amount,
          description:      note?.trim() || 'Admin credit',
          category:         'other',
          status:           'completed',
        });
      if (txnErr) throw txnErr;

      return json({ success: true, message: `$${amount.toFixed(2)} added to ${account_type}` });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (err) {
    return errJson(err);
  }
});
