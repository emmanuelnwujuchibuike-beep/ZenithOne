-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Add source_account_id to account_requests
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run even if account_requests already exists from migration 20240112.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.account_requests
  ADD COLUMN IF NOT EXISTS source_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
