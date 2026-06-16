-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Loan repayments                                                           ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  Lets members pay down a loan at any time before the next due date.        ║
-- ║  Each payment debits a deposit account (the trg_update_balance trigger     ║
-- ║  lowers the account balance) and reduces the loan's current_balance.       ║
-- ║  This table is the per-loan payment history shown in the UI.               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.loan_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         UUID        NOT NULL REFERENCES public.loans(id)     ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  account_id      UUID        REFERENCES public.accounts(id)            ON DELETE SET NULL,
  transaction_id  UUID        REFERENCES public.transactions(id)        ON DELETE SET NULL,
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  principal       NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest        NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_type    TEXT          NOT NULL DEFAULT 'manual'
                                CHECK (payment_type IN ('manual','payoff','scheduled','extra')),
  status          TEXT          NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('pending','completed','failed','reversed')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON public.loan_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_user_id ON public.loan_payments(user_id);

-- ── Row level security ────────────────────────────────────────────────────────
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view own loan payments" ON public.loan_payments;
CREATE POLICY "Members can view own loan payments"
  ON public.loan_payments FOR SELECT
  USING (auth.uid() = user_id);

-- Writes happen exclusively through the admin-data edge function using the
-- service-role key, which bypasses RLS. No member INSERT/UPDATE policy needed.
