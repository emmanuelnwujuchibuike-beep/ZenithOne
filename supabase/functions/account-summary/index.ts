/**
 * ZenithOne Credit Union — Account Summary Edge Function
 * Returns aggregated balance, credit, rewards, and portfolio summary for a user.
 */

import { serve }       from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Unauthorized');

    const userId = user.id;

    // Fetch all active accounts
    const { data: accounts, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (accErr) throw accErr;

    // Aggregate balances
    let totalBalance   = 0;
    let checkingBalance = 0;
    let savingsBalance  = 0;
    let mmBalance       = 0;

    for (const acc of accounts || []) {
      totalBalance += acc.balance || 0;
      if (acc.account_type === 'checking')     checkingBalance += acc.balance || 0;
      if (acc.account_type === 'savings')      savingsBalance  += acc.balance || 0;
      if (acc.account_type === 'money_market') mmBalance       += acc.balance || 0;
    }

    // Credit cards
    const { data: cards } = await supabase
      .from('cards')
      .select('available_credit, card_type, rewards_points')
      .eq('user_id', userId)
      .eq('status', 'active')
      .eq('card_type', 'credit');

    const creditAvailable = (cards || []).reduce((s, c) => s + (c.available_credit || 0), 0);
    const rewardPoints    = (cards || []).reduce((s, c) => s + (c.rewards_points   || 0), 0);

    // Investment portfolio total
    const { data: investments } = await supabase
      .from('investments')
      .select('total_value')
      .eq('user_id', userId);

    const portfolioValue = (investments || []).reduce((s, i) => s + (i.total_value || 0), 0);

    // Unread notifications
    const { count: unreadNotifications } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    const summary = {
      total_balance:         Math.round(totalBalance * 100) / 100,
      checking_balance:      Math.round(checkingBalance * 100) / 100,
      savings_balance:       Math.round(savingsBalance * 100) / 100,
      money_market_balance:  Math.round(mmBalance * 100) / 100,
      portfolio_value:       Math.round(portfolioValue * 100) / 100,
      credit_available:      Math.round(creditAvailable * 100) / 100,
      reward_points:         rewardPoints,
      unread_notifications:  unreadNotifications || 0,
      account_count:         (accounts || []).length,
      last_updated:          new Date().toISOString(),
    };

    return new Response(JSON.stringify(summary), {
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
