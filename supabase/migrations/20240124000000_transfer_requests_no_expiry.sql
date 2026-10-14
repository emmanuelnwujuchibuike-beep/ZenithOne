-- Transfer requests no longer expire: they stay pending until an admin approves or declines.
alter table public.transfer_requests alter column expires_at drop default;
alter table public.transfer_requests alter column expires_at drop not null;

update public.transfer_requests set expires_at = null where status = 'pending';
