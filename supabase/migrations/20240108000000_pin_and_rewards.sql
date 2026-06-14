-- ============================================================
-- ZENITHONE — Transaction PIN & Reward Points
-- Safe to re-run.
-- ============================================================

-- 1. Add PIN + reward points columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS transaction_pin    TEXT,
  ADD COLUMN IF NOT EXISTS pin_created_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_reward_points INTEGER NOT NULL DEFAULT 0;

-- 2. Reward-points trigger: +20 pts per completed transaction
CREATE OR REPLACE FUNCTION add_transaction_reward_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.transaction_type IN ('credit','debit','transfer_in','transfer_out') THEN
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

-- 3. RLS: allow service role to write PIN fields on profiles
DROP POLICY IF EXISTS "Service role full access profiles" ON public.profiles;
CREATE POLICY "Service role full access profiles"
  ON public.profiles USING (auth.role() = 'service_role');

-- 4. Allow users to update their own PIN fields
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

SELECT 'PIN and reward-points migration applied.' AS status;
