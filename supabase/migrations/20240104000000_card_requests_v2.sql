-- Add card_id and updated_at to card_requests
ALTER TABLE public.card_requests
  ADD COLUMN IF NOT EXISTS card_id    UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- created_at alias for consistency (requested_at already exists, add created_at view col)
ALTER TABLE public.card_requests
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Back-fill created_at from requested_at where created_at is null
UPDATE public.card_requests SET created_at = requested_at WHERE created_at IS NULL;
