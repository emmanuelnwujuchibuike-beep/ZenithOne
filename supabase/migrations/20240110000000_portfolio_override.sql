-- ════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Portfolio override + investment support
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════

-- ── 1. Profiles: optional manual portfolio value override ─────────────────────
--    When set (non-null), this value is shown as the user's Portfolio Value on
--    the dashboard and takes precedence over the sum of their investment holdings.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS portfolio_value_override NUMERIC(18,2);

-- ── 2. Investments: relax asset_type list (allow 'cash'/'other') ──────────────
--    Admin-managed holdings may include simple cash positions.
DO $$
BEGIN
  ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_asset_type_check;
  ALTER TABLE public.investments
    ADD CONSTRAINT investments_asset_type_check
    CHECK (asset_type IN ('stock','etf','bond','mutual_fund','crypto','reit','option','cash','other'));
EXCEPTION WHEN others THEN NULL;
END$$;

-- ── 3. Investments RLS already allows users to read their own holdings.
--    Admin writes happen through the service-role edge function (admin-data).

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='profiles' AND column_name='portfolio_value_override';
