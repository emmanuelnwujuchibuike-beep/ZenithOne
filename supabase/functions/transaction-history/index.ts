/**
 * ZenithOne Credit Union — Transaction History Edge Function
 * Fetches paginated, filtered transactions for a user or specific account.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

interface HistoryBody {
  account_id?: string | null;
  limit?:      number;
  offset?:     number;
  start_date?: string | null;
  end_date?:   string | null;
  category?:   string | null;
  type?:       'credit' | 'debit' | 'transfer' | null;
  search?:     string | null;
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

    const body = await req.json() as HistoryBody;
    const {
      account_id = null,
      limit      = 50,
      offset     = 0,
      start_date = null,
      end_date   = null,
      category   = null,
      type       = null,
      search     = null,
    } = body;

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (account_id) query = query.eq('account_id', account_id);
    if (start_date) query = query.gte('created_at', start_date + 'T00:00:00Z');
    if (end_date)   query = query.lte('created_at', end_date   + 'T23:59:59Z');
    if (category)   query = query.eq('category', category);
    if (type === 'credit')   query = query.in('transaction_type', ['credit', 'transfer_in', 'interest']);
    if (type === 'debit')    query = query.in('transaction_type', ['debit', 'fee']);
    if (type === 'transfer') query = query.in('transaction_type', ['transfer_in', 'transfer_out']);
    if (search) query = query.ilike('description', `%${search}%`);

    const { data: transactions, count, error } = await query;
    if (error) throw error;

    const rows = transactions || [];
    const totalDebits  = rows
      .filter((t: { transaction_type: string }) => ['debit', 'fee', 'transfer_out'].includes(t.transaction_type))
      .reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    const totalCredits = rows
      .filter((t: { transaction_type: string }) => ['credit', 'transfer_in', 'interest'].includes(t.transaction_type))
      .reduce((s: number, t: { amount: number }) => s + t.amount, 0);

    return json({
      transactions: rows,
      total:        count || 0,
      offset,
      limit,
      summary: {
        total_debits:  Math.round(totalDebits  * 100) / 100,
        total_credits: Math.round(totalCredits * 100) / 100,
        net:           Math.round((totalCredits - totalDebits) * 100) / 100,
      },
    });

  } catch (err) {
    return errJson(err);
  }
});
