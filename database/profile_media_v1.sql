-- VSBIL profile/media upgrade. Apply in Supabase SQL editor once.
create extension if not exists pgcrypto;
alter table public.users add column if not exists bio text not null default '';
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists cover_url text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('user-media','user-media',true,8388608,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public=true,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

-- Server-side service-role uploads are used by the API. These policies also allow
-- authenticated clients to read their own objects if direct storage access is used later.
drop policy if exists "user media public read" on storage.objects;
create policy "user media public read" on storage.objects for select using (bucket_id='user-media');

drop policy if exists "user media owner insert" on storage.objects;
create policy "user media owner insert" on storage.objects for insert to authenticated with check (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "user media owner update" on storage.objects;
create policy "user media owner update" on storage.objects for update to authenticated using (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "user media owner delete" on storage.objects;
create policy "user media owner delete" on storage.objects for delete to authenticated using (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
