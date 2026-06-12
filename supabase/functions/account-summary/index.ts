/**
 * ZenithOne Credit Union — Account Summary Edge Function
 * Returns aggregated balance, credit, rewards, and portfolio summary for a user.
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
    let totalBalance    = 0;
    let checkingBalance = 0;
    let savingsBalance  = 0;
    let mmBalance       = 0;

    for (const acc of accounts || []) {
      totalBalance += acc.balance || 0;
      if (acc.account_type === 'checking')     checkingBalance += acc.balance || 0;
      if (acc.account_type === 'savings')      savingsBalance  += acc.balance || 0;
      if (acc.account_type === 'money_market') mmBalance       += acc.balance || 0;
    }

    // Cards (all active)
    const { data: cards } = await supabase
      .from('cards')
      .select('available_credit, card_type, card_tier, card_number_last_four, rewards_points, expiry_month, expiry_year, cardholder_name')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .neq('status', 'stolen')
      .order('created_at')
      .limit(1);

    const allCards = cards || [];
    const creditAvailable = allCards.reduce((s: number, c: { card_type: string; available_credit?: number }) => c.card_type === 'credit' ? s + (c.available_credit || 0) : s, 0);
    const rewardPoints    = allCards.reduce((s: number, c: { rewards_points?: number }) => s + (c.rewards_points || 0), 0);
    const primaryCard     = allCards[0] || null;

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

    return json({
      total_balance:        Math.round(totalBalance    * 100) / 100,
      checking_balance:     Math.round(checkingBalance * 100) / 100,
      savings_balance:      Math.round(savingsBalance  * 100) / 100,
      money_market_balance: Math.round(mmBalance        * 100) / 100,
      portfolio_value:      Math.round(portfolioValue  * 100) / 100,
      credit_available:     Math.round(creditAvailable * 100) / 100,
      reward_points:        rewardPoints,
      unread_notifications: unreadNotifications || 0,
      account_count:        (accounts || []).length,
      has_card:             allCards.length > 0,
      primary_card:         primaryCard ? {
        last_four:      (primaryCard as { card_number_last_four?: string }).card_number_last_four || '••••',
        tier:           (primaryCard as { card_tier?: string }).card_tier || 'standard',
        card_type:      (primaryCard as { card_type?: string }).card_type || 'debit',
        expiry_month:   (primaryCard as { expiry_month?: number }).expiry_month,
        expiry_year:    (primaryCard as { expiry_year?: number }).expiry_year,
        cardholder_name:(primaryCard as { cardholder_name?: string }).cardholder_name || '',
      } : null,
      last_updated:         new Date().toISOString(),
    });

  } catch (err) {
    return errJson(err);
  }
});
