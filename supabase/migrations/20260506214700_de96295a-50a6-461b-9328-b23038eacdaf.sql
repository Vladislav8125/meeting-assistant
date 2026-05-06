alter publication supabase_realtime add table public.analyses;
alter table public.analyses replica identity full;