
-- 1) user_id on existing tables (nullable; existing public rows become unowned/invisible)
ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.meeting_preparations ADD COLUMN IF NOT EXISTS user_id uuid;

-- Matrix-stage fields on preparations
ALTER TABLE public.meeting_preparations
  ADD COLUMN IF NOT EXISTS moderator text,
  ADD COLUMN IF NOT EXISTS meeting_date date,
  ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS readiness_percent integer,
  ADD COLUMN IF NOT EXISTS blocking_count integer,
  ADD COLUMN IF NOT EXISTS verdict_label text;

-- 2) New table: meeting_checklists (16 rules / 25 fact-checks)
CREATE TABLE IF NOT EXISTS public.meeting_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic text NOT NULL,
  meeting_date date,
  moderator text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_checklists TO authenticated;
GRANT ALL ON public.meeting_checklists TO service_role;

ALTER TABLE public.meeting_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklists owner select" ON public.meeting_checklists
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "checklists owner insert" ON public.meeting_checklists
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "checklists owner update" ON public.meeting_checklists
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "checklists owner delete" ON public.meeting_checklists
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at_meeting_checklists
  BEFORE UPDATE ON public.meeting_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_meeting_checklists_user_created
  ON public.meeting_checklists (user_id, created_at DESC);

-- 3) Replace public RLS on analyses with owner-only
DROP POLICY IF EXISTS "public insert analyses" ON public.analyses;
DROP POLICY IF EXISTS "public read analyses" ON public.analyses;
DROP POLICY IF EXISTS "public update analyses" ON public.analyses;

REVOKE ALL ON public.analyses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;

CREATE POLICY "analyses owner select" ON public.analyses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "analyses owner insert" ON public.analyses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "analyses owner update" ON public.analyses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_analyses_user_created
  ON public.analyses (user_id, created_at DESC);

-- 4) Replace public RLS on meeting_preparations
DROP POLICY IF EXISTS "public delete preparations" ON public.meeting_preparations;
DROP POLICY IF EXISTS "public insert preparations" ON public.meeting_preparations;
DROP POLICY IF EXISTS "public read preparations" ON public.meeting_preparations;
DROP POLICY IF EXISTS "public update preparations" ON public.meeting_preparations;

REVOKE ALL ON public.meeting_preparations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_preparations TO authenticated;
GRANT ALL ON public.meeting_preparations TO service_role;

CREATE POLICY "preparations owner select" ON public.meeting_preparations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "preparations owner insert" ON public.meeting_preparations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "preparations owner update" ON public.meeting_preparations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "preparations owner delete" ON public.meeting_preparations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_preparations_user_created
  ON public.meeting_preparations (user_id, created_at DESC);
