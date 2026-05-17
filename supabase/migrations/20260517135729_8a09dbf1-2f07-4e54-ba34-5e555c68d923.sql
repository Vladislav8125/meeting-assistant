-- Meeting preparations
CREATE TABLE public.meeting_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  topic text NOT NULL,
  goal text,
  agenda text,
  participants text,
  expected_decision text,
  materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  readiness_score int,
  verdict text,
  recommendations jsonb,
  checks jsonb,
  status text NOT NULL DEFAULT 'draft',
  logs jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.meeting_preparations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read preparations"
  ON public.meeting_preparations FOR SELECT USING (true);
CREATE POLICY "public insert preparations"
  ON public.meeting_preparations FOR INSERT WITH CHECK (true);
CREATE POLICY "public update preparations"
  ON public.meeting_preparations FOR UPDATE USING (true);
CREATE POLICY "public delete preparations"
  ON public.meeting_preparations FOR DELETE USING (true);

CREATE TRIGGER set_meeting_preparations_updated_at
  BEFORE UPDATE ON public.meeting_preparations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Distribution fields on analyses
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS participant_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distributions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Helper RPC: append a log entry to a preparation
CREATE OR REPLACE FUNCTION public.append_preparation_log(_id uuid, _entry jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.meeting_preparations
     SET logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(_entry)
   WHERE id = _id;
$$;

-- Helper RPC: append a distribution entry to an analysis
CREATE OR REPLACE FUNCTION public.append_analysis_distribution(_id uuid, _entry jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.analyses
     SET distributions = COALESCE(distributions, '[]'::jsonb) || jsonb_build_array(_entry)
   WHERE id = _id;
$$;