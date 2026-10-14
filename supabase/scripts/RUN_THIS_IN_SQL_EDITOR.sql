-- ZenithOne: paste ALL of this into Supabase Dashboard → SQL Editor → New query → Run

-- ── Part 1: transfers never expire ──
-- Transfer requests no longer expire: they stay pending until an admin approves or declines.
alter table public.transfer_requests alter column expires_at drop default;
alter table public.transfer_requests alter column expires_at drop not null;

update public.transfer_requests set expires_at = null where status = 'pending';

-- ── Part 2: correct latest transfer to $50,000 and approve it ──
-- ════════════════════════════════════════════════════════════════
-- One-off fix: the most recent transfer request was submitted for $50,000
-- but recorded as $50 (amount-input parsing bug) and then auto-expired.
-- Corrects it to $50,000 and approves it, mirroring the admin_approve action
-- of the transfer-funds edge function.
--
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor).
-- Safe to re-run: it only acts while the latest request is still $50 and
-- pending/expired, and aborts (changing nothing) if funds are insufficient.
-- ════════════════════════════════════════════════════════════════
do $$
declare
  r        public.transfer_requests%rowtype;
  from_acc public.accounts%rowtype;
  to_acc   public.accounts%rowtype;
  ref      text := 'TRF' || (extract(epoch from clock_timestamp()) * 1000)::bigint || floor(random() * 1000)::int;
  pending_ref text;
  new_amt  numeric(12,2) := 50000;
  type_lbl text;
  r_name   text;
begin
  select * into r from public.transfer_requests order by created_at desc limit 1 for update;
  if not found then raise exception 'No transfer requests found.'; end if;

  raise notice 'Latest request % (%): $% status=% created=%', r.id, r.transfer_type, r.amount, r.status, r.created_at;
  if r.status not in ('pending', 'expired') then
    raise notice 'Request is %, nothing to do.', r.status; return;
  end if;
  if r.amount <> 50 then
    raise exception 'Latest request amount is $%, expected $50 — aborting so the wrong transfer is not changed.', r.amount;
  end if;

  pending_ref := 'REQ_' || r.id;

  select * into from_acc from public.accounts where id = r.from_account_id for update;
  if not found then raise exception 'Source account % not found.', r.from_account_id; end if;
  if from_acc.balance < new_amt then
    raise exception 'Insufficient funds: source balance $% < $%.', from_acc.balance, new_amt;
  end if;

  -- Correct the amount on the request
  update public.transfer_requests set amount = new_amt where id = r.id;

  -- Debit the sender (the pending transfer_out row is UPDATED to completed, which
  -- does not fire trg_update_balance, so the balance is adjusted here)
  update public.accounts
     set balance           = balance - new_amt,
         available_balance = greatest(0, coalesce(available_balance, balance) - new_amt),
         updated_at        = now()
   where id = from_acc.id;

  if r.transfer_type = 'internal' and r.to_account_id is not null then
    update public.transactions
       set amount = new_amt, status = 'completed',
           description = coalesce(r.memo, 'Internal Transfer'),
           reference_number = ref || '_OUT', related_account_id = r.to_account_id
     where reference_number = pending_ref;
    select * into to_acc from public.accounts where id = r.to_account_id;
    if found then
      -- completed insert → trg_update_balance credits the destination
      insert into public.transactions (account_id, user_id, transaction_type, category, description, amount, status, reference_number, related_account_id)
      values (to_acc.id, to_acc.user_id, 'transfer_in', 'Transfer', coalesce(r.memo, 'Internal Transfer'), new_amt, 'completed', ref || '_IN', from_acc.id);
    end if;

  elsif r.transfer_type = 'send' and r.to_account_number is not null and not r.is_external then
    r_name := coalesce(r.recipient_name, 'ZenithOne Member');
    update public.transactions
       set amount = new_amt, status = 'completed',
           description = case when r.memo is not null then 'Sent to ' || r_name || ' — ' || r.memo else 'Sent to ' || r_name end,
           reference_number = ref || '_OUT'
     where reference_number = pending_ref;
    select * into to_acc from public.accounts where account_number = r.to_account_number and status = 'active';
    if found then
      insert into public.transactions (account_id, user_id, transaction_type, category, description, amount, status, reference_number)
      values (to_acc.id, to_acc.user_id, 'transfer_in', 'Transfer',
              case when r.memo is not null then 'Received — ' || r.memo else 'Transfer Received' end,
              new_amt, 'completed', ref || '_IN');
    end if;

  else
    type_lbl := initcap(replace(coalesce(r.transfer_type, 'transfer'), '_', ' '));
    r_name   := coalesce(r.recipient_name, r.bank_name, 'External');
    update public.transactions
       set amount = new_amt, status = 'completed',
           description = case when r.memo is not null then type_lbl || ' to ' || r_name || ' — ' || r.memo else type_lbl || ' to ' || r_name end,
           reference_number = ref || '_OUT'
     where reference_number = pending_ref;
  end if;

  update public.transfer_requests
     set status = 'approved', reviewed_at = now(), expires_at = null,
         admin_note = coalesce(admin_note, 'Amount corrected to $50,000 and approved')
   where id = r.id;

  insert into public.notifications (user_id, title, message, type, priority)
  values (r.user_id, 'Transfer Approved ✓',
          'Your $50,000.00 transfer has been authorized and processed successfully.',
          'transaction', 'high');

  raise notice 'Approved request % for $50,000.00 (ref %).', r.id, ref;
end $$;
