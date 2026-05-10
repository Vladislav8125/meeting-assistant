
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

-- Helper RPC: append a log entry atomically
CREATE OR REPLACE FUNCTION public.append_analysis_log(_id uuid, _entry jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.analyses
     SET logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(_entry)
   WHERE id = _id;
$$;

GRANT EXECUTE ON FUNCTION public.append_analysis_log(uuid, jsonb) TO anon, authenticated, service_role;
