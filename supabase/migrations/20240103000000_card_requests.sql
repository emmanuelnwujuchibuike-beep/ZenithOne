-- Card Requests table
CREATE TABLE IF NOT EXISTS public.card_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_type_key TEXT NOT NULL,
  card_name     TEXT NOT NULL,
  card_tier     TEXT NOT NULL,
  card_category TEXT NOT NULL DEFAULT 'credit',
  annual_fee    NUMERIC(10,2) DEFAULT 0.00,
  status        TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','issued')),
  requested_at  TIMESTAMPTZ DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  admin_notes   TEXT
);

ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own card requests"   ON public.card_requests;
DROP POLICY IF EXISTS "Users can insert own card requests" ON public.card_requests;
DROP POLICY IF EXISTS "Service role full access"           ON public.card_requests;
CREATE POLICY "Users can view own card requests"   ON public.card_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own card requests" ON public.card_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access"           ON public.card_requests USING (auth.role() = 'service_role');
