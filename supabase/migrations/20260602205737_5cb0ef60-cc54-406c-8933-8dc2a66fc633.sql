
REVOKE EXECUTE ON FUNCTION public.append_analysis_log(uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.append_preparation_log(uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.append_analysis_distribution(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_analysis_log(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_preparation_log(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_analysis_distribution(uuid, jsonb) TO service_role;
