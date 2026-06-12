/**
 * ZenithOne Credit Union — Card Operations Edge Function
 * Handles card freeze/unfreeze, limit updates, and card listing.
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
    const { action, card_id, updates } = body;

    switch (action) {

      case 'list': {
        const { data: cards, error } = await supabase
          .from('cards')
          .select('id, card_number_last_four, card_type, card_tier, card_name, expiry_month, expiry_year, cardholder_name, status, credit_limit, available_credit, current_balance, rewards_points, allow_international, allow_online, allow_atm, daily_limit')
          .eq('user_id', user.id)
          .neq('status', 'cancelled')
          .order('created_at');

        if (error) throw error;
        return new Response(JSON.stringify({ cards: cards || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
      }

      case 'freeze': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase
          .from('cards')
          .update({ status: 'frozen', updated_at: new Date().toISOString() })
          .eq('id', card_id)
          .eq('user_id', user.id);
        if (error) throw error;

        await supabase.from('audit_log').insert({ user_id: user.id, action: 'card_freeze', resource: 'cards', resource_id: card_id });
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Frozen', message: 'Your card has been frozen. All transactions will be declined.', type: 'security', priority: 'high' });
        return new Response(JSON.stringify({ success: true, status: 'frozen' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }

      case 'unfreeze': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase
          .from('cards')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', card_id)
          .eq('user_id', user.id);
        if (error) throw error;

        await supabase.from('audit_log').insert({ user_id: user.id, action: 'card_unfreeze', resource: 'cards', resource_id: card_id });
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Unfrozen', message: 'Your card is now active and ready for use.', type: 'security', priority: 'normal' });
        return new Response(JSON.stringify({ success: true, status: 'active' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }

      case 'update_controls': {
        if (!card_id || !updates) throw new Error('card_id and updates required');
        const allowed = ['allow_international','allow_online','allow_atm','daily_limit','transaction_limit'];
        const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (key in updates) safe[key] = updates[key];
        }
        const { error } = await supabase.from('cards').update(safe).eq('id', card_id).eq('user_id', user.id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, updated: safe }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }

      case 'report_lost': {
        if (!card_id) throw new Error('card_id required');
        const { error } = await supabase
          .from('cards')
          .update({ status: 'stolen', updated_at: new Date().toISOString() })
          .eq('id', card_id)
          .eq('user_id', user.id);
        if (error) throw error;
        await supabase.from('audit_log').insert({ user_id: user.id, action: 'card_reported_lost', resource: 'cards', resource_id: card_id });
        await supabase.from('notifications').insert({ user_id: user.id, title: 'Card Reported Lost/Stolen', message: 'Your card has been cancelled. A replacement will arrive in 2–4 business days.', type: 'security', priority: 'urgent' });
        return new Response(JSON.stringify({ success: true, status: 'stolen', replacement_eta: '2-4 business days' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
