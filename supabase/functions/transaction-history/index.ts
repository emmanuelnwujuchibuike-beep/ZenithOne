/**
 * ZenithOne Credit Union — Transaction History Edge Function
 * Fetches paginated, filtered transactions for a user or specific account.
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error('Missing authorization');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    const body   = await req.json();
    const {
      account_id   = null,
      limit        = 50,
      offset       = 0,
      start_date   = null,
      end_date     = null,
      category     = null,
      type         = null,         // 'credit' | 'debit' | 'transfer'
      search       = null,
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
    if (type === 'credit') query = query.in('transaction_type', ['credit','transfer_in','interest']);
    if (type === 'debit')  query = query.in('transaction_type', ['debit','fee']);
    if (type === 'transfer') query = query.in('transaction_type', ['transfer_in','transfer_out']);
    if (search) query = query.ilike('description', `%${search}%`);

    const { data: transactions, count, error } = await query;
    if (error) throw error;

    // Spending summary for the period
    const allForPeriod = transactions || [];
    const totalDebits  = allForPeriod
      .filter(t => ['debit','fee','transfer_out'].includes(t.transaction_type))
      .reduce((s, t) => s + t.amount, 0);
    const totalCredits = allForPeriod
      .filter(t => ['credit','transfer_in','interest'].includes(t.transaction_type))
      .reduce((s, t) => s + t.amount, 0);

    return new Response(JSON.stringify({
      transactions: transactions || [],
      total:        count || 0,
      offset,
      limit,
      summary: {
        total_debits:  Math.round(totalDebits  * 100) / 100,
        total_credits: Math.round(totalCredits * 100) / 100,
        net:           Math.round((totalCredits - totalDebits) * 100) / 100,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
