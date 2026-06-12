/**
 * ZenithOne Credit Union — Admin Data Edge Function
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

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!callerProfile?.is_admin) throw new Error('Forbidden: admin access required');

    const body = await req.json() as { action?: string };
    const action = body.action ?? 'stats';

    // Helper: build id→email map from auth.users (service role only)
    async function getEmailMap(): Promise<Record<string, string>> {
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const map: Record<string, string> = {};
      for (const u of authUsers ?? []) map[u.id] = u.email ?? '';
      return map;
    }

    if (action === 'stats') {
      const [
        { count: userCount },
        { count: txnCount },
        { data: accounts },
        { data: recentTxns },
        { data: recentProfiles },
        emailMap,
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('accounts').select('balance').eq('status', 'active'),
        supabase.from('transactions')
          .select('id,description,amount,transaction_type,category,created_at,user_id')
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('profiles')
          .select('id,full_name,created_at')
          .order('created_at', { ascending: false }).limit(5),
        getEmailMap(),
      ]);

      const totalDeposits = (accounts || []).reduce((s: number, a: { balance: number }) => s + (a.balance || 0), 0);

      const recentUsers = (recentProfiles ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        email: emailMap[p.id as string] ?? '',
      }));

      return json({
        user_count:          userCount  ?? 0,
        transaction_count:   txnCount   ?? 0,
        total_deposits:      Math.round(totalDeposits * 100) / 100,
        recent_transactions: recentTxns ?? [],
        recent_users:        recentUsers,
      });
    }

    if (action === 'users') {
      const [
        { data: profiles, error: profErr },
        { data: accounts },
        emailMap,
      ] = await Promise.all([
        supabase.from('profiles')
          .select('id, full_name, banking_tier, created_at, is_admin')
          .order('created_at', { ascending: false }),
        supabase.from('accounts')
          .select('user_id, account_type, balance, status, account_number')
          .eq('status', 'active'),
        getEmailMap(),
      ]);

      if (profErr) throw profErr;

      const accMap: Record<string, { type: string; balance: number; number: string }[]> = {};
      for (const a of accounts ?? []) {
        if (!accMap[a.user_id]) accMap[a.user_id] = [];
        accMap[a.user_id].push({ type: a.account_type, balance: a.balance, number: a.account_number });
      }

      return json({
        users: (profiles ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          email:         emailMap[p.id as string] ?? '',
          accounts:      accMap[p.id as string] ?? [],
          total_balance: (accMap[p.id as string] ?? []).reduce((s, a) => s + (a.balance || 0), 0),
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
          transaction_type: 'credit',
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
