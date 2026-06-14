-- ════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Balance integrity + admin financial control
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Fixes inconsistent balances by:
--   1. Making ONE trigger maintain BOTH balance and available_balance.
--   2. Removing the duplicate trigger that caused double-counting.
--   3. Re-syncing available_balance = balance for all accounts.
--   4. Adding admin override columns for available credit and portfolio P&L.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Single canonical balance function (keeps balance & available in sync) ──
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.transaction_type IN ('credit','transfer_in','interest','refund') THEN
      UPDATE public.accounts
        SET balance           = balance           + NEW.amount,
            available_balance = available_balance + NEW.amount,
            updated_at        = now()
        WHERE id = NEW.account_id;
    ELSIF NEW.transaction_type IN ('debit','transfer_out','fee') THEN
      UPDATE public.accounts
        SET balance           = balance           - NEW.amount,
            available_balance = available_balance - NEW.amount,
            updated_at        = now()
        WHERE id = NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Exactly ONE trigger fires the function (drops the duplicate) ───────────
DROP TRIGGER IF EXISTS transaction_balance_update ON public.transactions;
DROP TRIGGER IF EXISTS trg_update_balance          ON public.transactions;
CREATE TRIGGER trg_update_balance
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE update_account_balance();

-- ── 3. One-time re-sync so available_balance matches balance ──────────────────
UPDATE public.accounts
  SET available_balance = balance
  WHERE available_balance IS DISTINCT FROM balance;

-- ── 4. Admin override columns ─────────────────────────────────────────────────
--    available_credit_override : shown as Available Credit when set (else cards sum)
--    portfolio_gain_override   : shown as portfolio profit/loss when set
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS available_credit_override NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS portfolio_gain_override   NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS portfolio_value_override  NUMERIC(18,2);  -- safe if 20240110 already ran

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.transactions'::regclass AND NOT tgisinternal;
-- SELECT id, balance, available_balance FROM public.accounts LIMIT 10;
