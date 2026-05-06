
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_name text not null,
  file_size bigint,
  mime_type text,
  storage_path text not null,
  topic text,
  participants text,
  status text not null default 'pending',
  error text,
  transcript text,
  report jsonb
);

alter table public.analyses enable row level security;

create policy "public read analyses" on public.analyses for select using (true);
create policy "public insert analyses" on public.analyses for insert with check (true);
create policy "public update analyses" on public.analyses for update using (true);

insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do nothing;

create policy "public upload media" on storage.objects for insert with check (bucket_id = 'media');
create policy "public read media" on storage.objects for select using (bucket_id = 'media');
