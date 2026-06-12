/**
 * ZenithOne Credit Union — Investment Data Edge Function
 * Returns portfolio summary, holdings, and performance metrics.
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

    // Fetch all holdings
    const { data: holdings, error } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', user.id)
      .order('total_value', { ascending: false });

    if (error) throw error;

    const inv = holdings || [];

    // Aggregate portfolio metrics
    const totalValue    = inv.reduce((s, i) => s + (i.total_value || 0), 0);
    const totalCost     = inv.reduce((s, i) => s + (i.cost_basis  || 0), 0);
    const totalGainLoss = totalValue - totalCost;
    const gainLossPct   = totalCost > 0 ? ((totalGainLoss / totalCost) * 100) : 0;

    // Asset allocation
    const allocation: Record<string, number> = {};
    for (const i of inv) {
      const type = i.asset_type;
      allocation[type] = (allocation[type] || 0) + (i.total_value || 0);
    }
    const allocationPct: Record<string, number> = {};
    for (const [type, val] of Object.entries(allocation)) {
      allocationPct[type] = totalValue > 0 ? Math.round((val / totalValue) * 1000) / 10 : 0;
    }

    // Daily change (mock — in production, fetch from market data API)
    const dailyChange    = totalValue * 0.0031;
    const dailyChangePct = 0.31;

    // YTD dividends (from dividend transactions)
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const { data: dividends } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('category', 'Investment')
      .eq('transaction_type', 'credit')
      .gte('created_at', yearStart);

    const dividendsYTD = (dividends || []).reduce((s, d) => s + d.amount, 0);

    return new Response(JSON.stringify({
      total_value:      Math.round(totalValue    * 100) / 100,
      total_cost:       Math.round(totalCost     * 100) / 100,
      total_gain_loss:  Math.round(totalGainLoss * 100) / 100,
      gain_loss_pct:    Math.round(gainLossPct   * 100) / 100,
      daily_change:     Math.round(dailyChange   * 100) / 100,
      daily_change_pct: dailyChangePct,
      dividends_ytd:    Math.round(dividendsYTD  * 100) / 100,
      holdings:         inv,
      allocation:       allocationPct,
      holding_count:    inv.length,
      last_updated:     new Date().toISOString(),
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
