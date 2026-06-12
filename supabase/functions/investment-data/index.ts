/**
 * ZenithOne Credit Union — Investment Data Edge Function
 * Returns portfolio summary, holdings, and performance metrics.
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

    const { data: holdings, error } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', user.id)
      .order('total_value', { ascending: false });

    if (error) throw error;

    const inv = holdings || [];

    const totalValue    = inv.reduce((s: number, i: { total_value?: number }) => s + (i.total_value || 0), 0);
    const totalCost     = inv.reduce((s: number, i: { cost_basis?:  number }) => s + (i.cost_basis  || 0), 0);
    const totalGainLoss = totalValue - totalCost;
    const gainLossPct   = totalCost > 0 ? ((totalGainLoss / totalCost) * 100) : 0;

    // Asset allocation
    const allocation: Record<string, number> = {};
    for (const i of inv as { asset_type: string; total_value?: number }[]) {
      allocation[i.asset_type] = (allocation[i.asset_type] || 0) + (i.total_value || 0);
    }
    const allocationPct: Record<string, number> = {};
    for (const [type, val] of Object.entries(allocation)) {
      allocationPct[type] = totalValue > 0 ? Math.round((val / totalValue) * 1000) / 10 : 0;
    }

    const dailyChange    = totalValue * 0.0031;
    const dailyChangePct = 0.31;

    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const { data: dividends } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('category', 'Investment')
      .eq('transaction_type', 'credit')
      .gte('created_at', yearStart);

    const dividendsYTD = (dividends || []).reduce((s: number, d: { amount: number }) => s + d.amount, 0);

    return json({
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
    });

  } catch (err) {
    return errJson(err);
  }
});
