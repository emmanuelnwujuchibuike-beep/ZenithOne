-- ════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Complete Setup Migration
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════

-- ── 1. Profiles: PIN + reward points columns ─────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS transaction_pin     TEXT,
  ADD COLUMN IF NOT EXISTS pin_created_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_reward_points INTEGER NOT NULL DEFAULT 0;

-- ── 2. Cards: ensure all needed columns exist ────────────────────────────────
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS card_number_token TEXT,
  ADD COLUMN IF NOT EXISTS current_balance   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_credit  NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_international BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_online        BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_atm           BOOLEAN DEFAULT TRUE;

-- Fix cards.status to allow all needed values
DO $$
BEGIN
  ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_status_check;
  ALTER TABLE public.cards
    ADD CONSTRAINT cards_status_check
    CHECK (status IN ('active','frozen','blocked','cancelled','stolen','expired','lost'));
EXCEPTION WHEN others THEN NULL;
END$$;

-- ── 3. Transactions: allow 'fee' and 'refund' transaction types ───────────────
-- Drop the old check constraint (name may vary — we try both common names)
DO $$
BEGIN
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS chk_transaction_type;
EXCEPTION WHEN others THEN NULL;
END$$;

-- Re-add with complete list including fee + refund
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_transaction_type_check
  CHECK (transaction_type IN ('credit','debit','transfer_in','transfer_out','fee','refund'));

-- ── 4. Balance trigger — handles credit, debit, transfer, fee, refund ─────────
-- This trigger fires AFTER INSERT on transactions and adjusts account.balance.
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.transaction_type IN ('credit', 'transfer_in', 'refund') THEN
      UPDATE public.accounts
        SET balance    = balance + NEW.amount,
            updated_at = now()
        WHERE id = NEW.account_id;
    ELSIF NEW.transaction_type IN ('debit', 'transfer_out', 'fee') THEN
      UPDATE public.accounts
        SET balance    = balance - NEW.amount,
            updated_at = now()
        WHERE id = NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_balance ON public.transactions;
CREATE TRIGGER trg_update_balance
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE update_account_balance();

-- ── 5. Reward points trigger — 20 points per completed user transaction ────────
CREATE OR REPLACE FUNCTION add_transaction_reward_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Award 20 points for every completed credit/debit/transfer (not fees)
  IF NEW.status = 'completed'
     AND NEW.transaction_type IN ('credit', 'debit', 'transfer_in', 'transfer_out') THEN
    UPDATE public.profiles
      SET total_reward_points = total_reward_points + 20
      WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reward_points ON public.transactions;
CREATE TRIGGER trg_reward_points
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE add_transaction_reward_points();

-- ── 6. Card pricing table (admin-editable base fees) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.card_pricing (
  card_type_key TEXT        PRIMARY KEY,
  base_fee      NUMERIC(10,2) NOT NULL,
  updated_at    TIMESTAMPTZ   DEFAULT now()
);

-- Seed default prices (won't overwrite existing)
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

-- RLS: anyone authenticated can read pricing; only service_role can write
ALTER TABLE public.card_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read card_pricing" ON public.card_pricing;
CREATE POLICY "Public read card_pricing"
  ON public.card_pricing FOR SELECT USING (true);

-- ── 7. Notifications table (if not already present) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  type       TEXT        NOT NULL DEFAULT 'system',
  priority   TEXT        NOT NULL DEFAULT 'normal',
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- ── 8. Cards RLS — users can read/update their own cards ─────────────────────
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own cards" ON public.cards;
CREATE POLICY "Users read own cards"
  ON public.cards FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own cards" ON public.cards;
CREATE POLICY "Users update own cards"
  ON public.cards FOR UPDATE USING (auth.uid() = user_id);

-- ── 9. Card requests RLS ────────────────────────────────────────────────────
ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own card_requests" ON public.card_requests;
CREATE POLICY "Users read own card_requests"
  ON public.card_requests FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own card_requests" ON public.card_requests;
CREATE POLICY "Users insert own card_requests"
  ON public.card_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Verify setup:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name IN ('transaction_pin','total_reward_points');
-- SELECT * FROM public.card_pricing;
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'transactions';
