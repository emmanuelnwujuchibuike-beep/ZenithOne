-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Account Applications
-- Run ONCE in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_applications (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Account type
  account_type        TEXT        NOT NULL,
  account_type_label  TEXT        NOT NULL,

  -- Status workflow
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','declined','under_review')),

  -- Personal information
  first_name          TEXT        NOT NULL,
  last_name           TEXT        NOT NULL,
  date_of_birth       TEXT        NOT NULL,
  ssn_last4           TEXT        NOT NULL,
  phone               TEXT,

  -- Address
  address_line1       TEXT        NOT NULL,
  address_line2       TEXT,
  city                TEXT        NOT NULL,
  state               TEXT        NOT NULL,
  zip_code            TEXT        NOT NULL,

  -- Employment
  employment_status   TEXT        CHECK (employment_status IN ('employed','self_employed','retired','student','unemployed','other')),
  employer_name       TEXT,
  annual_income       TEXT,

  -- Account purpose & funding
  account_purpose     TEXT,
  initial_deposit     NUMERIC(12,2),
  funding_source      TEXT,

  -- CD-specific fields
  cd_term_months      INTEGER,
  cd_amount           NUMERIC(12,2),

  -- IRA-specific
  ira_type            TEXT        CHECK (ira_type IN ('traditional','roth','sep',NULL)),

  -- Business-specific
  business_name       TEXT,
  business_type       TEXT,
  ein                 TEXT,

  -- Review
  admin_note          TEXT,
  reviewed_by         UUID        REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acct_app_user_id  ON public.account_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_acct_app_status   ON public.account_applications (status);
CREATE INDEX IF NOT EXISTS idx_acct_app_created  ON public.account_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acct_app_type     ON public.account_applications (account_type);

ALTER TABLE public.account_applications ENABLE ROW LEVEL SECURITY;

-- Users can view their own applications
DROP POLICY IF EXISTS "users_own_applications" ON public.account_applications;
CREATE POLICY "users_own_applications"
  ON public.account_applications FOR SELECT USING (auth.uid() = user_id);

-- Service role (edge functions) manages all
