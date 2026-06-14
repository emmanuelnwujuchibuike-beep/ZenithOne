-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Loan Applications
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.loan_applications (
  id                           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loan_type                    TEXT         NOT NULL
                                            CHECK (loan_type IN ('personal','auto','mortgage','student','business','heloc','credit_line')),
  loan_name                    TEXT         NOT NULL,
  requested_amount             NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0),
  term_months                  INTEGER,
  purpose                      TEXT,
  status                       TEXT         NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('pending','approved','declined')),
  admin_note                   TEXT,
  monthly_payment_approved     NUMERIC(12,2),
  interest_rate_approved       NUMERIC(7,4),
  -- Snapshot values at application time
  credit_score_at_application  INTEGER,
  credit_limit_at_application  NUMERIC(18,2),
  created_at                   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;

-- Users can INSERT and SELECT their own applications
DROP POLICY IF EXISTS "users_own_loan_applications" ON public.loan_applications;
CREATE POLICY "users_own_loan_applications"
  ON public.loan_applications FOR ALL USING (auth.uid() = user_id);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_loan_application_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_loan_application ON public.loan_applications;
CREATE TRIGGER trg_touch_loan_application
  BEFORE UPDATE ON public.loan_applications
  FOR EACH ROW EXECUTE PROCEDURE touch_loan_application_updated();

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_loan_applications_user_id ON public.loan_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_status  ON public.loan_applications (status);
