-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Disburse outstanding approved loans into members' accounts                ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  Loans approved BEFORE the auto-disbursement fix created a `loans` record  ║
-- ║  but never deposited the principal into the member's account. This         ║
-- ║  migration adds a `disbursed` flag and performs a ONE-TIME, idempotent     ║
-- ║  backfill that credits each outstanding ZenithOne-funded loan.             ║
-- ║                                                                            ║
-- ║  The existing trg_update_balance trigger updates balance +                 ║
-- ║  available_balance automatically when a 'credit' transaction is inserted.  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 1. Track disbursement state on each loan ──────────────────────────────────
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS disbursed BOOLEAN NOT NULL DEFAULT false;

-- ── 2. One-time, idempotent backfill ──────────────────────────────────────────
DO $$
DECLARE
  l           RECORD;
  target_acct UUID;
  existing    BIGINT;
BEGIN
  FOR l IN
    SELECT *
    FROM public.loans
    WHERE status = 'active'
      AND disbursed = false
      -- Only loans actually funded by ZenithOne (i.e. from an approved
      -- application). Externally-tracked debts recorded via admin_add_loan
      -- (other lenders / NULL lender) must NOT be credited to the balance.
      AND lender = 'ZenithOne Credit Union'
      AND original_amount > 0
  LOOP
    -- Pick the member's primary checking account, else their first active one.
    SELECT id INTO target_acct
    FROM public.accounts
    WHERE user_id = l.user_id AND status = 'active'
    ORDER BY (account_type = 'checking') DESC, created_at ASC
    LIMIT 1;

    -- No account to deposit into — leave disbursed = false so a later run
    -- (after the member opens an account) can still disburse it.
    IF target_acct IS NULL THEN
      CONTINUE;
    END IF;

    -- Skip crediting if a matching disbursement transaction already exists
    -- (e.g. created by the forward-path fix). Still mark disbursed below.
    SELECT count(*) INTO existing
    FROM public.transactions
    WHERE user_id = l.user_id
      AND transaction_type = 'credit'
      AND description = l.loan_name || ' disbursement'
      AND amount = l.original_amount;

    IF existing = 0 THEN
      INSERT INTO public.transactions
        (user_id, account_id, transaction_type, amount, description, category, status)
      VALUES
        (l.user_id, target_acct, 'credit', l.original_amount,
         l.loan_name || ' disbursement', 'other', 'completed');
    END IF;

    UPDATE public.loans SET disbursed = true WHERE id = l.id;
  END LOOP;
END $$;
