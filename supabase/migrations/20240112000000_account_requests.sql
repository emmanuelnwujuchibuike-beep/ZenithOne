-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Account Request Queue
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Creates account_requests table so users can submit account opening requests
-- that admin must approve before the account is created in accounts table.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. account_requests table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_type     TEXT NOT NULL CHECK (account_type IN ('checking','savings','money_market','cd')),
  account_name     TEXT,
  initial_deposit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_account_request_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_account_request ON public.account_requests;
CREATE TRIGGER trg_touch_account_request
  BEFORE UPDATE ON public.account_requests
  FOR EACH ROW EXECUTE PROCEDURE touch_account_request_updated();

-- ── 3. Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.account_requests ENABLE ROW LEVEL SECURITY;

-- Users can INSERT their own requests
DROP POLICY IF EXISTS "users_insert_own_account_requests" ON public.account_requests;
CREATE POLICY "users_insert_own_account_requests"
  ON public.account_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can SELECT their own requests
DROP POLICY IF EXISTS "users_select_own_account_requests" ON public.account_requests;
CREATE POLICY "users_select_own_account_requests"
  ON public.account_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS automatically (used by admin-data edge function)

-- ── 4. Index for admin list queries ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_account_requests_status     ON public.account_requests (status);
CREATE INDEX IF NOT EXISTS idx_account_requests_user_id    ON public.account_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_account_requests_created_at ON public.account_requests (created_at DESC);
