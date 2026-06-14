-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Account Closure Support
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════

-- Add closed_at timestamp to accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Index for rate-limit query (most recent closure per user)
CREATE INDEX IF NOT EXISTS idx_accounts_closed_at
  ON public.accounts (user_id, closed_at DESC)
  WHERE status = 'closed';
