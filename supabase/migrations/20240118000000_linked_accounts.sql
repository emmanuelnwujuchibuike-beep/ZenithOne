-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Linked External Accounts & Cards
-- Run ONCE in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.linked_accounts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                 TEXT        NOT NULL CHECK (type IN ('bank', 'card')),
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'declined')),

  -- Bank account fields
  bank_name            TEXT,
  routing_number       TEXT,
  account_number_last4 TEXT,
  account_type         TEXT        CHECK (account_type IN ('checking', 'savings')),
  nickname             TEXT,

  -- Card fields
  card_name            TEXT,
  card_last4           TEXT,
  card_expiry_mo       TEXT,
  card_expiry_yr       TEXT,
  card_network         TEXT        CHECK (card_network IN ('visa','mc','amex','discover','unknown')),
  card_bin             TEXT,       -- first 4 digits for card art lookup

  -- Review metadata
  admin_note           TEXT,
  reviewed_by          UUID        REFERENCES auth.users(id),
  reviewed_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user_id ON public.linked_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_status  ON public.linked_accounts (status);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_created ON public.linked_accounts (created_at DESC);

ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;

-- Users can read their own linked accounts
DROP POLICY IF EXISTS "users_own_linked_accounts" ON public.linked_accounts;
CREATE POLICY "users_own_linked_accounts"
  ON public.linked_accounts FOR SELECT USING (auth.uid() = user_id);

-- Service role (edge functions) manages all via service_role key, bypassing RLS
