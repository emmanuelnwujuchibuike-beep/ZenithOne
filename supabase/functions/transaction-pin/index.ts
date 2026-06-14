import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    headers: { ...cors, 'Content-Type': 'application/json' },
    status,
  })

async function hashPin(userId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${userId}:${pin}:zenithone`)
  )
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) throw new Error('Unauthorized')

    const body = await req.json()
    const { action } = body as { action: string }

    const { data: profile } = await supabase
      .from('profiles')
      .select('transaction_pin, pin_created_at, is_admin, total_reward_points')
      .eq('id', user.id)
      .single()

    // ── check_status ──────────────────────────────────────────────────────
    if (action === 'check_status') {
      return json({
        pin_set: !!profile?.transaction_pin,
        pin_created_at: profile?.pin_created_at ?? null,
        total_reward_points: profile?.total_reward_points ?? 0,
      })
    }

    // ── create_pin ────────────────────────────────────────────────────────
    if (action === 'create_pin') {
      const { pin } = body as { pin: string }
      if (!pin || !/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.')
      if (profile?.transaction_pin) throw new Error('PIN already set. Use change_pin to update it.')
      const hashed = await hashPin(user.id, pin)
      await supabase.from('profiles').update({
        transaction_pin: hashed,
        pin_created_at: new Date().toISOString(),
      }).eq('id', user.id)
      return json({ success: true, message: 'PIN created successfully.' })
    }

    // ── verify_pin ────────────────────────────────────────────────────────
    if (action === 'verify_pin') {
      const { pin } = body as { pin: string }
      if (!profile?.transaction_pin) throw new Error('No PIN set. Please create a PIN first.')
      const hashed = await hashPin(user.id, pin)
      const valid = hashed === profile.transaction_pin
      return json({ valid, message: valid ? 'PIN verified.' : 'Incorrect PIN.' })
    }

    // ── change_pin ────────────────────────────────────────────────────────
    if (action === 'change_pin') {
      const { old_pin, new_pin } = body as { old_pin: string; new_pin: string }
      if (!profile?.transaction_pin) throw new Error('No PIN set. Use create_pin first.')
      const oldHash = await hashPin(user.id, old_pin)
      if (oldHash !== profile.transaction_pin) throw new Error('Current PIN is incorrect.')
      if (!new_pin || !/^\d{4}$/.test(new_pin)) throw new Error('New PIN must be exactly 4 digits.')
      if (old_pin === new_pin) throw new Error('New PIN must differ from current PIN.')
      const newHash = await hashPin(user.id, new_pin)
      await supabase.from('profiles').update({
        transaction_pin: newHash,
        pin_created_at: new Date().toISOString(),
      }).eq('id', user.id)
      return json({ success: true, message: 'PIN changed successfully.' })
    }

    // ── admin_reset_pin ───────────────────────────────────────────────────
    if (action === 'admin_reset_pin') {
      if (!profile?.is_admin) throw new Error('Admin access required.')
      const { target_user_id } = body as { target_user_id: string }
      if (!target_user_id) throw new Error('target_user_id required.')
      await supabase.from('profiles').update({
        transaction_pin: null,
        pin_created_at: null,
      }).eq('id', target_user_id)
      return json({ success: true, message: 'PIN reset. User must create a new PIN on next login.' })
    }

    throw new Error(`Unknown action: ${action}`)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 400)
  }
})
