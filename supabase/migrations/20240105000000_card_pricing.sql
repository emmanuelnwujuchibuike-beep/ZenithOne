-- ── Card Pricing ─────────────────────────────────────────────
-- Admin-editable base annual fee per card type. The final price a
-- member pays = base_fee + network surcharge (surcharge lives in code).
CREATE TABLE IF NOT EXISTS public.card_pricing (
  card_type_key TEXT PRIMARY KEY,
  base_fee      NUMERIC(10,2) NOT NULL DEFAULT 249,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.card_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read card pricing"       ON public.card_pricing;
DROP POLICY IF EXISTS "Service role manages card pricing"  ON public.card_pricing;
CREATE POLICY "Anyone can read card pricing"      ON public.card_pricing FOR SELECT USING (true);
CREATE POLICY "Service role manages card pricing"  ON public.card_pricing USING (auth.role() = 'service_role');

-- Seed current defaults (no-op if already present).
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
