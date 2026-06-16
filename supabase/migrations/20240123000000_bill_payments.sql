-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Bill payments (admin-approved)                                            ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  A member's bill payment is created as `pending` and shown as "Processing" ║
-- ║  until an admin approves (debits the account) or declines it. The funds    ║
-- ║  are only moved on approval, mirroring the transfer-request flow.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.bill_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  account_id      UUID        REFERENCES public.accounts(id)        ON DELETE SET NULL,
  transaction_id  UUID        REFERENCES public.transactions(id)    ON DELETE SET NULL,
  payee_name      TEXT        NOT NULL,
  biller_category TEXT        NOT NULL DEFAULT 'Bills',
  account_ref     TEXT,
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  memo            TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','declined')),
  admin_note      TEXT,
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_user_id ON public.bill_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_status  ON public.bill_payments(status);

-- ── Row level security ────────────────────────────────────────────────────────
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view own bill payments" ON public.bill_payments;
CREATE POLICY "Members can view own bill payments"
  ON public.bill_payments FOR SELECT
  USING (auth.uid() = user_id);

-- All writes go through the transfer-funds edge function (service-role key,
-- which bypasses RLS). No member INSERT/UPDATE policy is required.
