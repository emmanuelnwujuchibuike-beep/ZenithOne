-- Transfer requests: pending admin approval
create table if not exists public.transfer_requests (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users on delete cascade,
  transfer_type     text        not null,
  status            text        not null default 'pending'
                    check (status in ('pending','approved','declined','cancelled','expired')),
  amount            numeric(12,2) not null check (amount > 0),
  from_account_id   uuid        references public.accounts,
  to_account_id     uuid        references public.accounts,
  to_account_number text,
  recipient_name    text,
  recipient_contact text,
  routing_number    text,
  bank_name         text,
  wire_type         text,
  memo              text,
  is_external       boolean     not null default false,
  admin_note        text,
  reviewed_by       uuid        references auth.users,
  reviewed_at       timestamptz,
  expires_at        timestamptz not null default (now() + interval '5 minutes'),
  created_at        timestamptz not null default now()
);

create index if not exists transfer_requests_user_idx    on public.transfer_requests(user_id);
create index if not exists transfer_requests_status_idx  on public.transfer_requests(status);
create index if not exists transfer_requests_created_idx on public.transfer_requests(created_at desc);

alter table public.transfer_requests enable row level security;

-- Users see & insert their own requests
create policy "tr_user_select" on public.transfer_requests for select using (user_id = auth.uid());
create policy "tr_user_insert" on public.transfer_requests for insert with check (user_id = auth.uid());
create policy "tr_user_update" on public.transfer_requests for update using (user_id = auth.uid() and status = 'pending');

-- Admins manage all requests
create policy "tr_admin_all" on public.transfer_requests for all using (
  exists(select 1 from public.profiles where id = auth.uid() and is_admin = true)
);
