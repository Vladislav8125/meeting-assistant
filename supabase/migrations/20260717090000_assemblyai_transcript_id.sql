
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS provider_transcript_id text;

CREATE INDEX IF NOT EXISTS idx_analyses_provider_transcript_id
  ON public.analyses (provider_transcript_id);
