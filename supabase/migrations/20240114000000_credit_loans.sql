-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Credit Profiles & Loans
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Credit Profiles (one per user, admin-controlled) ──────────────────────
CREATE TABLE IF NOT EXISTS public.credit_profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_score        INTEGER     CHECK (credit_score BETWEEN 300 AND 850),
  score_provider      TEXT        NOT NULL DEFAULT 'FICO'
                                  CHECK (score_provider IN ('FICO','VantageScore','Equifax','Experian','TransUnion')),
  score_updated_at    TIMESTAMPTZ DEFAULT now(),
  -- Credit factor inputs (percentages / counts shown in UI)
  payment_history_pct NUMERIC(5,2) NOT NULL DEFAULT 100     CHECK (payment_history_pct  BETWEEN 0 AND 100),
  credit_utilization  NUMERIC(5,2) NOT NULL DEFAULT 0       CHECK (credit_utilization   BETWEEN 0 AND 100),
  credit_age_months   INTEGER      NOT NULL DEFAULT 0,
  hard_inquiries      INTEGER      NOT NULL DEFAULT 0,
  derogatory_marks    INTEGER      NOT NULL DEFAULT 0,
  total_credit_limit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit_used   NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_mix_score    NUMERIC(5,2) NOT NULL DEFAULT 100     CHECK (credit_mix_score     BETWEEN 0 AND 100),
  admin_note          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Loans ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loans (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loan_type         TEXT        NOT NULL
                                CHECK (loan_type IN ('personal','auto','mortgage','student','business','heloc','credit_line')),
  loan_name         TEXT        NOT NULL,
  lender            TEXT,
  account_number    TEXT,
  original_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_rate     NUMERIC(7,4)  NOT NULL DEFAULT 0,
  monthly_payment   NUMERIC(12,2) NOT NULL DEFAULT 0,
  next_payment_date DATE,
  term_months       INTEGER,
  paid_months       INTEGER       NOT NULL DEFAULT 0,
  opened_date       DATE          DEFAULT CURRENT_DATE,
  status            TEXT          NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','paid_off','delinquent','deferred','in_default')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Updated-at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_credit_profile_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_credit_profile ON public.credit_profiles;
CREATE TRIGGER trg_touch_credit_profile
  BEFORE UPDATE ON public.credit_profiles
  FOR EACH ROW EXECUTE PROCEDURE touch_credit_profile_updated();

CREATE OR REPLACE FUNCTION touch_loan_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_loan ON public.loans;
CREATE TRIGGER trg_touch_loan
  BEFORE UPDATE ON public.loans
  FOR EACH ROW EXECUTE PROCEDURE touch_loan_updated();

-- ── 4. Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.credit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans           ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own records; service role bypasses (used by admin-data)
DROP POLICY IF EXISTS "users_select_own_credit_profile" ON public.credit_profiles;
CREATE POLICY "users_select_own_credit_profile"
  ON public.credit_profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_select_own_loans" ON public.loans;
CREATE POLICY "users_select_own_loans"
  ON public.loans FOR SELECT USING (auth.uid() = user_id);

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credit_profiles_user_id ON public.credit_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_loans_user_id           ON public.loans (user_id);
CREATE INDEX IF NOT EXISTS idx_loans_status            ON public.loans (status);
