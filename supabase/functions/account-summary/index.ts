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

    // Cards (all active — needed to sum credit across every card)
    const { data: cards } = await supabase
      .from('cards')
      .select('available_credit, card_type, card_tier, card_number_last_four, rewards_points, expiry_month, expiry_year, cardholder_name')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .neq('status', 'stolen')
      .order('created_at');

    const allCards = cards || [];
    const cardsCreditAvailable = allCards.reduce((s: number, c: { card_type: string; available_credit?: number }) => c.card_type === 'credit' ? s + (c.available_credit || 0) : s, 0);
    const rewardPoints    = allCards.reduce((s: number, c: { rewards_points?: number }) => s + (c.rewards_points || 0), 0);
    const primaryCard     = allCards[0] || null;

    // Investment portfolio (sum of holdings value + gain/loss)
    const { data: investments } = await supabase
      .from('investments')
      .select('total_value, gain_loss')
      .eq('user_id', userId);

    const holdingsValue = (investments || []).reduce((s, i) => s + (i.total_value || 0), 0);
    const holdingsGain  = (investments || []).reduce((s, i) => s + (i.gain_loss   || 0), 0);

    // Unread notifications
    const { count: unreadNotifications } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    // Profile: PIN status + total reward points + name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, transaction_pin, pin_created_at, total_reward_points')
      .eq('id', userId)
      .single();

    // Admin overrides (read defensively — works whether or not the migrations
    // that add these columns have been applied yet; on error PostgREST returns
    // null rather than throwing, so the values simply fall back).
    let override: number | null = null;
    let creditOverride: number | null = null;
    let gainOverride: number | null = null;
    const { data: ov } = await supabase
      .from('profiles')
      .select('portfolio_value_override, available_credit_override, portfolio_gain_override')
      .eq('id', userId).single();
    if (ov) {
      if (ov.portfolio_value_override  != null) override       = Number(ov.portfolio_value_override);
      if (ov.available_credit_override != null) creditOverride = Number(ov.available_credit_override);
      if (ov.portfolio_gain_override   != null) gainOverride   = Number(ov.portfolio_gain_override);
    }

    const portfolioValue  = (override       !== null) ? override       : holdingsValue;
    const portfolioGain   = (gainOverride   !== null) ? gainOverride   : holdingsGain;
    const creditAvailable = (creditOverride !== null) ? creditOverride : cardsCreditAvailable;

    // Full account list for the dashboard header + account switcher.
    const accountList = (accounts || [])
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .map((a) => ({
        id:                a.id,
        account_type:      a.account_type,
        account_name:      a.account_name,
        account_number:    a.account_number,
        balance:           Math.round((a.balance || 0) * 100) / 100,
        available_balance: Math.round((a.available_balance || 0) * 100) / 100,
        interest_rate:     a.interest_rate || 0,
        routing_number:    a.routing_number || '021000021',
        status:            a.status,
      }));

    return json({
      full_name:            profile?.full_name || '',
      total_balance:        Math.round(totalBalance    * 100) / 100,
      checking_balance:     Math.round(checkingBalance * 100) / 100,
      savings_balance:      Math.round(savingsBalance  * 100) / 100,
      money_market_balance: Math.round(mmBalance        * 100) / 100,
      portfolio_value:      Math.round(portfolioValue  * 100) / 100,
      portfolio_gain:       Math.round(portfolioGain   * 100) / 100,
      portfolio_is_override:(override !== null),
      credit_available:     Math.round(creditAvailable * 100) / 100,
      reward_points:        profile?.total_reward_points ?? rewardPoints,
      pin_set:              !!profile?.transaction_pin,
      unread_notifications: unreadNotifications || 0,
      account_count:        (accounts || []).length,
      accounts:             accountList,
      last_sign_in_at:      user.last_sign_in_at ?? null,
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
