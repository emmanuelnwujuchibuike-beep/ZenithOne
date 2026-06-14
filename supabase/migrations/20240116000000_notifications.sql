-- ════════════════════════════════════════════════════════════════════════════
-- ZenithOne Credit Union — Notifications
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  message    TEXT,
  type       TEXT        NOT NULL DEFAULT 'info'
                         CHECK (type IN ('transaction','announcement','security','success','warning','info','error')),
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_id   ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read      ON public.notifications (user_id, read) WHERE NOT read;
CREATE INDEX IF NOT EXISTS idx_notifications_created   ON public.notifications (created_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read and update (mark read) their own notifications
DROP POLICY IF EXISTS "users_own_notifications" ON public.notifications;
CREATE POLICY "users_own_notifications"
  ON public.notifications FOR ALL USING (auth.uid() = user_id);

-- Service role (edge functions) can insert for any user — handled via service_role key

-- ── Real-time publication ─────────────────────────────────────────────────────
-- Enable real-time for this table (run in Supabase Dashboard → Database → Replication
-- OR via this helper — idempotent):
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
