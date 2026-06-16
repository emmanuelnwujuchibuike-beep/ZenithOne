/**
 * ZenithOne — Transfer Funds Edge Function
 *
 * Actions:
 *   lookup         → search ZenithOne account by account number → name
 *   request        → create pending transfer request for admin approval
 *   check_status   → poll a pending request status
 *   cancel         → cancel a pending request
 *   admin_list     → list pending requests (admin only)
 *   admin_approve  → approve a request, execute transfer if internal/send (admin only)
 *   admin_decline  → decline a request (admin only)
 *   send           → legacy PIN-authenticated transfer (kept for compatibility)
 *   (none)         → legacy own-account transfer by account_type
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const DAILY_LIMIT  = 100_000;
const SINGLE_LIMIT =  50_000;

function maskName(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ZenithOne Member';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

async function hashPin(userId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${userId}:${pin}:zenithone`),
  );
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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

    const body = await req.json() as Record<string, unknown>;
    const action = body.action as string | undefined;

    // ─────────────────────────────────────────────────────────────────────────
    // LOOKUP — resolve a ZenithOne account number to a name
    // ─────────────────────────────────────────────────────────────────────────
    // ZELLE_LOOKUP — find a ZenithOne member by email or phone for Zelle send
    // Returns { found: true, recipient_name } or { found: false }
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'zelle_lookup') {
      const contact = ((body.contact as string) || '').trim().toLowerCase();
      const mode    = (body.mode as string) === 'phone' ? 'phone' : 'email';
      if (!contact) throw new Error('No contact provided.');

      let query = supabase.from('profiles').select('id, full_name');
      if (mode === 'email') {
        // match against auth.users email via profiles join
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        const matched = (authUsers?.users || []).find(
          (u: { email?: string; id: string }) => (u.email || '').toLowerCase() === contact
        );
        if (!matched) return json({ found: false });
        const { data: prof } = await supabase
          .from('profiles').select('id, full_name').eq('id', matched.id).maybeSingle();
        if (!prof || prof.id === user.id) return json({ found: false });
        return json({ found: true, recipient_name: maskName(prof.full_name || 'ZenithOne Member') });
      } else {
        // phone: normalize digits only, search profiles.phone
        const digits = contact.replace(/\D/g, '');
        const { data: prof } = await supabase
          .from('profiles').select('id, full_name, phone')
          .filter('phone', 'ilike', '%' + digits.slice(-10) + '%')
          .neq('id', user.id)
          .maybeSingle();
        if (!prof) return json({ found: false });
        return json({ found: true, recipient_name: maskName(prof.full_name || 'ZenithOne Member') });
      }
    }

    // Returns { found: true, recipient_name, is_self, account_type }
    // or      { found: false }   ← never throws for "not found"
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'lookup') {
      const acctNo = ((body.account_number as string) || '').trim();
      if (!/^\d{10}$/.test(acctNo)) throw new Error('Enter a valid 10-digit account number.');

      const { data: acct } = await supabase
        .from('accounts')
        .select('id, user_id, account_type, account_number')
        .eq('account_number', acctNo)
        .eq('status', 'active')
        .maybeSingle();

      if (!acct) return json({ found: false });

      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', acct.user_id).single();

      return json({
        found:          true,
        is_self:        acct.user_id === user.id,
        recipient_name: maskName(prof?.full_name || ''),
        account_type:   acct.account_type,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REQUEST — submit a transfer for admin approval (5-minute window)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'request') {
      const {
        transfer_type, from_account_id, to_account_id, to_account_number,
        recipient_name, recipient_contact, routing_number, bank_name,
        wire_type, amount, memo, is_external, pin,
      } = body as Record<string, unknown>;

      if (!amount || Number(amount) <= 0)    throw new Error('Invalid amount.');
      if (Number(amount) > SINGLE_LIMIT)     throw new Error(`Single transfer limit is $${SINGLE_LIMIT.toLocaleString()}.`);
      if (!from_account_id)                  throw new Error('Source account required.');

      // If a PIN was supplied (non-biometric device path) — verify it server-side
      if (pin) {
        const { data: meProf } = await supabase
          .from('profiles').select('transaction_pin').eq('id', user.id).single();
        if (!meProf?.transaction_pin) throw new Error('No transaction PIN set. Go to Settings to create one before transferring.');
        const supplied = await hashPin(user.id, String(pin));
        if (supplied !== meProf.transaction_pin) throw new Error('Incorrect PIN. Transfer blocked.');
      }

      // Verify source account belongs to caller
      const { data: fromAcc } = await supabase
        .from('accounts').select('id, account_number, balance, available_balance')
        .eq('id', from_account_id as string)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!fromAcc) throw new Error('Source account not found or inactive.');

      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', user.id).single();

      const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const { data: row, error: insErr } = await supabase
        .from('transfer_requests')
        .insert({
          user_id:            user.id,
          transfer_type:      transfer_type || 'send',
          status:             'pending',
          amount:             Number(amount),
          from_account_id:    from_account_id || null,
          to_account_id:      to_account_id   || null,
          to_account_number:  to_account_number  || null,
          recipient_name:     recipient_name     || null,
          recipient_contact:  recipient_contact  || null,
          routing_number:     routing_number     || null,
          bank_name:          bank_name          || null,
          wire_type:          wire_type          || null,
          memo:               memo               || null,
          is_external:        Boolean(is_external),
          expires_at,
        })
        .select('id')
        .single();

      if (insErr) throw insErr;

      // Create pending transaction so it appears immediately in history
      const typeLabel = String(transfer_type || 'send').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      const rLabel    = String(recipient_name || to_account_number || 'Recipient');
      await supabase.from('transactions').insert({
        account_id:       fromAcc.id,
        user_id:          user.id,
        transaction_type: 'transfer_out',
        category:         'Transfer',
        description:      `${typeLabel} Pending — to ${rLabel}`,
        amount:           Number(amount),
        status:           'pending',
        reference_number: 'REQ_' + row.id,
      });

      // Notify all admins
      const { data: admins } = await supabase
        .from('profiles').select('id').eq('is_admin', true);

      if (admins?.length) {
        const senderName = prof?.full_name || 'A member';
        await supabase.from('notifications').insert(
          admins.map((a: { id: string }) => ({
            user_id:  a.id,
            title:    `Transfer Request — ${typeLabel}`,
            message:  `${senderName} submitted a $${Number(amount).toFixed(2)} ${typeLabel.toLowerCase()} transfer${recipient_name ? ' to ' + String(recipient_name) : ''}. Pending approval · expires in 5 min.`,
            type:     'admin',
            priority: Number(amount) >= 10_000 ? 'high' : 'normal',
          })),
        );
      }

      return json({ success: true, request_id: row.id });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK STATUS — poll a transfer request
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'check_status') {
      const requestId = body.request_id as string;
      if (!requestId) throw new Error('request_id required');

      const { data: row } = await supabase
        .from('transfer_requests').select('*').eq('id', requestId).maybeSingle();
      if (!row) throw new Error('Request not found.');

      // Auth: must be owner or admin
      if (row.user_id !== user.id) {
        const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
        if (!p?.is_admin) throw new Error('Unauthorized');
      }

      // Auto-expire if past window and still pending
      if (row.status === 'pending' && new Date(row.expires_at) < new Date()) {
        await supabase.from('transfer_requests').update({ status: 'expired' }).eq('id', requestId);
        await supabase.from('transactions')
          .update({ status: 'failed', description: 'Transfer Expired — not authorized in time' })
          .eq('reference_number', 'REQ_' + requestId)
          .eq('status', 'pending');
        return json({ status: 'expired', amount: row.amount });
      }

      return json({ status: row.status, admin_note: row.admin_note || null, amount: row.amount });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CANCEL — user cancels their own pending request
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const requestId = body.request_id as string;
      if (!requestId) throw new Error('request_id required');

      const { data: row } = await supabase
        .from('transfer_requests').select('user_id, status').eq('id', requestId).maybeSingle();
      if (!row || row.user_id !== user.id) throw new Error('Request not found.');
      if (row.status !== 'pending') throw new Error('Only pending requests can be cancelled.');

      await supabase.from('transfer_requests').update({ status: 'cancelled' }).eq('id', requestId);
      return json({ success: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN LIST — get all transfer requests (admin only)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'admin_list') {
      const { data: myProf } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!myProf?.is_admin) throw new Error('Admin access required.');

      const filter = (body.filter as string) || 'pending';

      // Fetch requests (filter server-side when possible)
      let baseQuery = supabase
        .from('transfer_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (filter !== 'all') baseQuery = baseQuery.eq('status', filter);

      const { data: requests, error: listErr } = await baseQuery;
      if (listErr) throw listErr;

      // Enrich with profile data via separate lookup (avoids auth.users FK join issue)
      const userIds = [...new Set((requests || []).map((r: Record<string, unknown>) => r.user_id as string))];
      let profileMap: Record<string, { full_name: string; email: string }> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name, email').in('id', userIds);
        (profiles || []).forEach((p: { id: string; full_name: string; email: string }) => {
          profileMap[p.id] = p;
        });
      }

      const enriched = (requests || []).map((r: Record<string, unknown>) => ({
        ...r,
        profiles: profileMap[r.user_id as string] || null,
      }));

      return json({ requests: enriched });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN APPROVE — approve & (for internal/send) execute the transfer
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'admin_approve') {
      const { data: myProf } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!myProf?.is_admin) throw new Error('Admin access required.');

      const requestId  = body.request_id as string;
      const adminNote  = (body.admin_note as string) || null;

      const { data: row } = await supabase
        .from('transfer_requests').select('*').eq('id', requestId).maybeSingle();
      if (!row) throw new Error('Request not found.');
      if (row.status !== 'pending') throw new Error('Request is no longer pending.');

      // Check expiry
      if (new Date(row.expires_at) < new Date()) {
        await supabase.from('transfer_requests').update({ status: 'expired' }).eq('id', requestId);
        throw new Error('Request has expired (past 5-minute window).');
      }

      const reference = 'TRF' + Date.now() + Math.floor(Math.random() * 1000);
      const pendingRef = 'REQ_' + requestId;

      // Fetch sender's account and verify sufficient funds at approval time
      const { data: fromAcc } = await supabase
        .from('accounts').select('*').eq('id', row.from_account_id).single();
      if (!fromAcc) throw new Error('Source account not found.');
      if (Number(fromAcc.balance) < Number(row.amount)) {
        throw new Error('Insufficient funds in source account at time of approval.');
      }

      const newFromBalance = Number(fromAcc.balance) - Number(row.amount);
      const newFromAvail   = Math.max(0, Number(fromAcc.available_balance ?? fromAcc.balance) - Number(row.amount));

      // Execute actual DB transfer for internal / member-to-member
      if (row.transfer_type === 'internal' && row.to_account_id) {
        // Update the pending debit transaction to completed
        await supabase.from('transactions')
          .update({ status: 'completed', description: row.memo || 'Internal Transfer', reference_number: reference + '_OUT', related_account_id: row.to_account_id })
          .eq('reference_number', pendingRef);
        // Deduct from sender
        await supabase.from('accounts')
          .update({ balance: newFromBalance, available_balance: newFromAvail })
          .eq('id', fromAcc.id);
        // Fetch destination and credit it
        const { data: toAcc } = await supabase.from('accounts').select('*').eq('id', row.to_account_id).single();
        if (toAcc) {
          await supabase.from('accounts').update({
            balance:           Number(toAcc.balance) + Number(row.amount),
            available_balance: Number(toAcc.available_balance ?? toAcc.balance) + Number(row.amount),
          }).eq('id', toAcc.id);
          // Insert credit for destination account
          await supabase.from('transactions').insert({
            account_id:       toAcc.id,           user_id:           toAcc.user_id,
            transaction_type: 'transfer_in',       category:          'Transfer',
            description:      row.memo || 'Internal Transfer',
            amount:           row.amount,          status:            'completed',
            reference_number: reference + '_IN',   related_account_id: fromAcc.id,
          });
        }
      } else if (row.transfer_type === 'send' && row.to_account_number && !row.is_external) {
        const { data: toAcc } = await supabase.from('accounts').select('*').eq('account_number', row.to_account_number).eq('status', 'active').maybeSingle();
        const rName = row.recipient_name || 'ZenithOne Member';
        // Update pending debit transaction
        await supabase.from('transactions')
          .update({ status: 'completed', description: row.memo ? `Sent to ${rName} — ${row.memo}` : `Sent to ${rName}`, reference_number: reference + '_OUT' })
          .eq('reference_number', pendingRef);
        // Deduct from sender
        await supabase.from('accounts')
          .update({ balance: newFromBalance, available_balance: newFromAvail })
          .eq('id', fromAcc.id);
        // Credit recipient
        if (toAcc) {
          await supabase.from('accounts').update({
            balance:           Number(toAcc.balance) + Number(row.amount),
            available_balance: Number(toAcc.available_balance ?? toAcc.balance) + Number(row.amount),
          }).eq('id', toAcc.id);
          await supabase.from('transactions').insert({
            account_id:       toAcc.id,   user_id:          toAcc.user_id,
            transaction_type: 'transfer_in', category:      'Transfer',
            description:      row.memo ? `Received — ${row.memo}` : 'Transfer Received',
            amount:           row.amount, status:           'completed',
            reference_number: reference + '_IN',
          });
        }
      } else {
        // Wire, Zelle, external, or other types — update pending debit to completed and deduct balance
        const typeLabel = String(row.transfer_type || 'Transfer').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const rName = row.recipient_name || row.bank_name || 'External';
        await supabase.from('transactions')
          .update({ status: 'completed', description: row.memo ? `${typeLabel} to ${rName} — ${row.memo}` : `${typeLabel} to ${rName}`, reference_number: reference + '_OUT' })
          .eq('reference_number', pendingRef);
        // Deduct from sender
        await supabase.from('accounts')
          .update({ balance: newFromBalance, available_balance: newFromAvail })
          .eq('id', fromAcc.id);
      }

      // Update request status
      await supabase.from('transfer_requests').update({
        status:      'approved',
        admin_note:  adminNote,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId);

      // Notify member
      await supabase.from('notifications').insert({
        user_id:  row.user_id,
        title:    'Transfer Approved ✓',
        message:  `Your $${Number(row.amount).toFixed(2)} transfer has been authorized and processed successfully.${adminNote ? ' Note: ' + adminNote : ''}`,
        type:     'transaction',
        priority: 'normal',
      });

      return json({ success: true, reference });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN DECLINE — decline a pending request
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'admin_decline') {
      const { data: myProf } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!myProf?.is_admin) throw new Error('Admin access required.');

      const requestId = body.request_id as string;
      const adminNote = (body.admin_note as string) || null;

      const { data: row } = await supabase
        .from('transfer_requests').select('user_id, amount, status').eq('id', requestId).maybeSingle();
      if (!row) throw new Error('Request not found.');
      if (row.status !== 'pending') throw new Error('Request is no longer pending.');

      await supabase.from('transfer_requests').update({
        status:      'declined',
        admin_note:  adminNote,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId);

      // Mark the pending transaction as failed/cancelled
      await supabase.from('transactions')
        .update({ status: 'failed', description: `Transfer Declined${adminNote ? ' — ' + adminNote : ''}` })
        .eq('reference_number', 'REQ_' + requestId)
        .eq('status', 'pending');

      await supabase.from('notifications').insert({
        user_id:  row.user_id,
        title:    'Transfer Not Approved',
        message:  `Your $${Number(row.amount).toFixed(2)} transfer request was declined. No funds were deducted.${adminNote ? ' Reason: ' + adminNote : ''}`,
        type:     'transaction',
        priority: 'normal',
      });

      return json({ success: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY SEND — user-to-user with PIN (kept for backward compatibility)
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // PAY_BILL — pay a biller/payee from a deposit account
    // Debits the chosen account (trigger lowers balance), categorised as Bills.
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'pay_bill') {
      const fromId   = body.from_account_id as string;
      const payee    = ((body.payee_name as string) || '').trim();
      const category = ((body.biller_category as string) || 'Bills').trim();
      const acctRef  = ((body.account_number as string) || '').trim();
      const amount   = Number(body.amount);
      const memo     = ((body.memo as string) || '').trim();

      if (!fromId)                throw new Error('Select an account to pay from.');
      if (!payee)                 throw new Error('Enter who you are paying.');
      if (!amount || amount <= 0) throw new Error('Enter a valid payment amount.');
      if (amount > SINGLE_LIMIT)  throw new Error(`Single bill payment limit is $${SINGLE_LIMIT.toLocaleString()}.`);

      const { data: fromAcc } = await supabase.from('accounts').select('*')
        .eq('id', fromId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!fromAcc) throw new Error('Source account not found or inactive.');

      const avail = Number(fromAcc.available_balance ?? fromAcc.balance ?? 0);
      if (avail < amount) {
        throw new Error(`Insufficient funds. Available: $${avail.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
      }

      // Daily out-flow limit shared with transfers
      const today = new Date().toISOString().split('T')[0];
      const { data: todayTxns } = await supabase.from('transactions').select('amount')
        .eq('user_id', user.id).in('transaction_type', ['transfer_out', 'debit'])
        .gte('created_at', today + 'T00:00:00Z');
      const todayTotal = (todayTxns || []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
      if (todayTotal + amount > DAILY_LIMIT) throw new Error(`Daily payment limit of $${DAILY_LIMIT.toLocaleString()} exceeded.`);

      const reference = 'BILL' + Date.now() + Math.floor(Math.random() * 1000);
      const acctTail  = acctRef ? ` (acct ••${acctRef.slice(-4)})` : '';
      const desc      = `Bill payment to ${payee}${acctTail}${memo ? ' — ' + memo : ''}`;

      const { error: debitErr } = await supabase.from('transactions').insert({
        account_id:       fromAcc.id,
        user_id:          user.id,
        transaction_type: 'debit',
        category:         category || 'Bills',
        description:      desc,
        amount,
        status:           'completed',
        reference_number: reference,
      });
      if (debitErr) throw debitErr;

      const newBalance = Math.round((avail - amount) * 100) / 100;

      await supabase.from('notifications').insert({
        user_id:  user.id,
        title:    'Bill Payment Sent',
        message:  `$${amount.toFixed(2)} paid to ${payee}. New balance $${newBalance.toFixed(2)}. Ref: ${reference}`,
        type:     'transaction',
        priority: amount >= 10000 ? 'high' : 'normal',
      });

      return json({
        success:     true,
        reference,
        amount,
        payee,
        new_balance: newBalance,
        processed:   new Date().toISOString(),
      });
    }

    if (action === 'send') {
      const fromId  = body.from_account_id as string;
      const acctNo  = ((body.to_account_number as string) || '').trim();
      const amount  = Number(body.amount);
      const memo    = ((body.memo as string) || '').trim();
      const pin     = (body.pin as string) || '';

      if (!fromId)                         throw new Error('Select a source account.');
      if (!/^\d{10}$/.test(acctNo))        throw new Error('Enter a valid 10-digit recipient account number.');
      if (!amount || amount <= 0)          throw new Error('Enter a valid amount.');
      if (amount > SINGLE_LIMIT)           throw new Error(`Single transfer limit is $${SINGLE_LIMIT.toLocaleString()}.`);
      if (!/^\d{4}$/.test(pin))            throw new Error('Enter your 4-digit PIN.');

      const { data: meProfile } = await supabase
        .from('profiles').select('transaction_pin, full_name').eq('id', user.id).single();
      if (!meProfile?.transaction_pin) throw new Error('No transaction PIN set. Create one before sending money.');
      const pinHash = await hashPin(user.id, pin);
      if (pinHash !== meProfile.transaction_pin) throw new Error('Incorrect PIN.');

      const { data: fromAcc } = await supabase.from('accounts').select('*')
        .eq('id', fromId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!fromAcc) throw new Error('Source account not found.');

      const { data: toAcc } = await supabase.from('accounts').select('*')
        .eq('account_number', acctNo).eq('status', 'active').maybeSingle();
      if (!toAcc) throw new Error('No active account found with that number.');
      if (toAcc.id === fromAcc.id) throw new Error('Source and destination cannot be the same account.');

      const availFunds = Number(fromAcc.balance ?? 0);
      if (availFunds < amount) throw new Error('Insufficient funds in the selected account.');

      const today = new Date().toISOString().split('T')[0];
      const { data: todayTxns } = await supabase.from('transactions').select('amount')
        .eq('user_id', user.id).eq('transaction_type', 'transfer_out')
        .gte('created_at', today + 'T00:00:00Z');
      const todayTotal = (todayTxns || []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
      if (todayTotal + amount > DAILY_LIMIT) throw new Error(`Daily transfer limit of $${DAILY_LIMIT.toLocaleString()} exceeded.`);

      const { data: toProfile } = await supabase.from('profiles').select('full_name').eq('id', toAcc.user_id).single();
      const senderName    = meProfile.full_name || 'a ZenithOne member';
      const recipientName = toProfile?.full_name || 'ZenithOne member';
      const reference     = 'TRF' + Date.now() + Math.floor(Math.random() * 1000);

      const { error: debitErr } = await supabase.from('transactions').insert({
        account_id: fromAcc.id, user_id: user.id,
        transaction_type: 'transfer_out', category: 'Transfer',
        description: memo ? `Sent to ${maskName(recipientName)} — ${memo}` : `Sent to ${maskName(recipientName)}`,
        amount, status: 'completed', reference_number: reference + '_OUT', related_account_id: toAcc.id,
      });
      if (debitErr) throw debitErr;

      const { error: creditErr } = await supabase.from('transactions').insert({
        account_id: toAcc.id, user_id: toAcc.user_id,
        transaction_type: 'transfer_in', category: 'Transfer',
        description: memo ? `Received from ${maskName(senderName)} — ${memo}` : `Received from ${maskName(senderName)}`,
        amount, status: 'completed', reference_number: reference + '_IN', related_account_id: fromAcc.id,
      });
      if (creditErr) throw creditErr;

      await supabase.from('notifications').insert([
        { user_id: user.id,       title: 'Money Sent',     message: `$${amount.toFixed(2)} sent to ${maskName(recipientName)} (••••${acctNo.slice(-4)}). Ref: ${reference}`, type: 'transaction', priority: amount >= 10000 ? 'high' : 'normal' },
        { user_id: toAcc.user_id, title: 'Money Received', message: `You received $${amount.toFixed(2)} from ${maskName(senderName)}. Ref: ${reference}`,                  type: 'transaction', priority: amount >= 10000 ? 'high' : 'normal' },
      ]);

      return json({ success: true, reference, amount, recipient_name: maskName(recipientName), new_balance: Math.round((availFunds - amount) * 100) / 100, processed: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY OWN-ACCOUNT TRANSFER (by account_type, no action field)
    // ─────────────────────────────────────────────────────────────────────────
    const { from_account_type, to_account_type, amount: legAmt, memo: legMemo } = body as Record<string, unknown>;

    if (!legAmt || Number(legAmt) <= 0)                    throw new Error('Invalid transfer amount');
    if (Number(legAmt) > SINGLE_LIMIT)                     throw new Error(`Single transfer limit is $${SINGLE_LIMIT.toLocaleString()}`);
    if (!from_account_type || !to_account_type)            throw new Error('Source and destination accounts required');
    if (from_account_type === to_account_type)             throw new Error('Source and destination accounts cannot be the same');

    const { data: fromAcc } = await supabase.from('accounts').select('*')
      .eq('user_id', user.id).eq('account_type', from_account_type).eq('status', 'active').single();
    if (!fromAcc) throw new Error('Source account not found');
    if (fromAcc.available_balance < Number(legAmt)) throw new Error('Insufficient funds');

    const { data: toAcc } = await supabase.from('accounts').select('*')
      .eq('user_id', user.id).eq('account_type', to_account_type).eq('status', 'active').single();
    if (!toAcc) throw new Error('Destination account not found');

    const today2 = new Date().toISOString().split('T')[0];
    const { data: todayTxns2 } = await supabase.from('transactions').select('amount')
      .eq('user_id', user.id).eq('transaction_type', 'transfer_out')
      .gte('created_at', today2 + 'T00:00:00Z');
    const todayTotal2 = (todayTxns2 || []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    if (todayTotal2 + Number(legAmt) > DAILY_LIMIT) throw new Error(`Daily transfer limit of $${DAILY_LIMIT.toLocaleString()} exceeded`);

    const reference2 = 'TRF' + Date.now() + Math.floor(Math.random() * 1000);

    const { error: debitErr2 } = await supabase.from('transactions').insert({
      account_id: fromAcc.id, user_id: user.id,
      transaction_type: 'transfer_out', category: 'Transfer',
      description: (legMemo as string) || `Transfer to ${to_account_type}`,
      amount: Number(legAmt), status: 'completed', reference_number: reference2 + '_OUT', related_account_id: toAcc.id,
    });
    if (debitErr2) throw debitErr2;

    const { error: creditErr2 } = await supabase.from('transactions').insert({
      account_id: toAcc.id, user_id: user.id,
      transaction_type: 'transfer_in', category: 'Transfer',
      description: (legMemo as string) || `Transfer from ${from_account_type}`,
      amount: Number(legAmt), status: 'completed', reference_number: reference2 + '_IN', related_account_id: fromAcc.id,
    });
    if (creditErr2) throw creditErr2;

    await supabase.from('notifications').insert({
      user_id: user.id, title: 'Transfer Completed',
      message: `$${Number(legAmt).toFixed(2)} transferred from ${from_account_type} to ${to_account_type}. Ref: ${reference2}`,
      type: 'transaction', priority: Number(legAmt) >= 10000 ? 'high' : 'normal',
    });

    return json({ success: true, reference: reference2, amount: Number(legAmt), from: fromAcc.account_number, to: toAcc.account_number, processed: new Date().toISOString() });

  } catch (err) {
    return errJson(err);
  }
});
