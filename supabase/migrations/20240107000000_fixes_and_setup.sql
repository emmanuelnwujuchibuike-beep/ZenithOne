-- ============================================================
-- ZENITHONE CREDIT UNION — Fixes & Comprehensive Setup
-- Run this in the Supabase SQL editor (safe to re-run).
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. FIX: Add 'blocked' to cards.status constraint ─────────
-- PostgreSQL requires DROP + ADD to change a CHECK constraint.
ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_status_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_status_check
  CHECK (status IN ('active','frozen','blocked','expired','cancelled','lost','stolen'));

-- ── 2. FIX: Ensure card_requests has all required columns ────
ALTER TABLE public.card_requests
  ADD COLUMN IF NOT EXISTS card_id    UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Back-fill created_at from requested_at
UPDATE public.card_requests
  SET created_at = requested_at
  WHERE created_at IS NULL AND requested_at IS NOT NULL;

-- ── 3. ENSURE: is_admin on profiles ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. ENSURE: card_pricing table exists and is seeded ───────
CREATE TABLE IF NOT EXISTS public.card_pricing (
  card_type_key TEXT PRIMARY KEY,
  base_fee      NUMERIC(10,2) NOT NULL DEFAULT 249,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.card_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read card pricing"      ON public.card_pricing;
DROP POLICY IF EXISTS "Service role manages card pricing" ON public.card_pricing;
CREATE POLICY "Anyone can read card pricing"      ON public.card_pricing FOR SELECT USING (true);
CREATE POLICY "Service role manages card pricing" ON public.card_pricing USING (auth.role() = 'service_role');

INSERT INTO public.card_pricing (card_type_key, base_fee) VALUES
  ('virtual',       249),
  ('classic_debit', 299),
  ('gold',          399),
  ('platinum',      549),
  ('titanium',      749),
  ('black',         999),
  ('black_gold',    1299),
  ('business',      699)
ON CONFLICT (card_type_key) DO NOTHING;

-- ── 5. ENSURE: cards.card_number_token column exists ─────────
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS card_number_token TEXT;

-- Add UNIQUE constraint only if the column doesn't already have one
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cards'::regclass
      AND contype = 'u'
      AND conname = 'cards_card_number_token_key'
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_card_number_token_key UNIQUE (card_number_token);
  END IF;
END $$;

-- ── 6. ENSURE: balance trigger function exists ────────────────
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.transaction_type IN ('credit', 'transfer_in', 'interest') THEN
      UPDATE public.accounts SET
        balance           = balance           + NEW.amount,
        available_balance = available_balance + NEW.amount,
        updated_at        = now()
      WHERE id = NEW.account_id;
    ELSIF NEW.transaction_type IN ('debit', 'transfer_out', 'fee') THEN
      UPDATE public.accounts SET
        balance           = balance           - NEW.amount,
        available_balance = available_balance - NEW.amount,
        updated_at        = now()
      WHERE id = NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-attach the trigger (DROP + CREATE is idempotent)
DROP TRIGGER IF EXISTS transaction_balance_update ON public.transactions;
CREATE TRIGGER transaction_balance_update
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE update_account_balance();

-- ── 7. ENSURE: updated_at trigger on cards ───────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS cards_updated_at ON public.cards;
CREATE TRIGGER cards_updated_at
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

-- ── 8. ENSURE: RLS policies are correct on all tables ────────

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role full access"     ON public.profiles;
CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role full access"     ON public.profiles USING (auth.role() = 'service_role');

-- accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own accounts"   ON public.accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Service role full access"      ON public.accounts;
CREATE POLICY "Users can view own accounts"   ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own accounts" ON public.accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"      ON public.accounts USING (auth.role() = 'service_role');

-- transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Service role full access"        ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"        ON public.transactions USING (auth.role() = 'service_role');

-- cards
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own cards"   ON public.cards;
DROP POLICY IF EXISTS "Users can update own cards" ON public.cards;
DROP POLICY IF EXISTS "Service role full access"   ON public.cards;
CREATE POLICY "Users can view own cards"   ON public.cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own cards" ON public.cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"   ON public.cards USING (auth.role() = 'service_role');

-- card_requests
ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own card requests"   ON public.card_requests;
DROP POLICY IF EXISTS "Users can insert own card requests" ON public.card_requests;
DROP POLICY IF EXISTS "Service role full access"           ON public.card_requests;
CREATE POLICY "Users can view own card requests"   ON public.card_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own card requests" ON public.card_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access"           ON public.card_requests USING (auth.role() = 'service_role');

-- notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role full access"           ON public.notifications;
CREATE POLICY "Users can view own notifications"   ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"           ON public.notifications USING (auth.role() = 'service_role');

-- ── 9. Helper: make a user an admin ──────────────────────────
-- Uncomment and replace the email below to grant admin access:
-- UPDATE public.profiles
--   SET is_admin = TRUE
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'your-admin@email.com');

-- ── Done ─────────────────────────────────────────────────────
SELECT 'ZenithOne schema fixes applied successfully' AS status;
