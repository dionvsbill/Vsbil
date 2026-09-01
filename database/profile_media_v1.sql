-- VSBIL profile/media upgrade. Apply in Supabase SQL editor once.
create extension if not exists pgcrypto;
alter table public.users add column if not exists bio text not null default '';
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists cover_url text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('user-media','user-media',true,8388608,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public=true,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "user media public read" on storage.objects;
create policy "user media public read" on storage.objects for select using (bucket_id='user-media');
drop policy if exists "user media owner insert" on storage.objects;
create policy "user media owner insert" on storage.objects for insert to authenticated with check (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "user media owner update" on storage.objects;
create policy "user media owner update" on storage.objects for update to authenticated using (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "user media owner delete" on storage.objects;
create policy "user media owner delete" on storage.objects for delete to authenticated using (bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Google/Supabase OAuth users must have a VSBIL profile automatically.
create or replace function public.sync_google_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_value text;
  base_username text;
  candidate text;
  suffix integer := 0;
  google_name text;
  google_avatar text;
  referral text;
begin
  email_value := lower(coalesce(new.email, ''));
  google_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
  google_avatar := coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'photo_url', '');

  base_username := lower(coalesce(nullif(new.raw_user_meta_data->>'preferred_username',''), nullif(new.raw_user_meta_data->>'user_name',''), nullif(new.raw_user_meta_data->>'username',''), nullif(split_part(email_value,'@',1),''), 'user'));
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if length(base_username) < 3 then base_username := 'user' || substr(replace(new.id::text,'-',''),1,6); end if;
  base_username := left(base_username, 24);
  candidate := base_username;

  while exists(select 1 from public.users where username=candidate and id<>new.id) loop
    suffix := suffix + 1;
    candidate := left(base_username, greatest(3, 30 - length(suffix::text) - 1)) || '_' || suffix::text;
  end loop;

  referral := 'VSBIL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));

  insert into public.users(id,email,username,role,status,referral_code,email_verified_at,avatar_url,bio)
  values(new.id,email_value,candidate,'user','active',referral,coalesce(new.email_confirmed_at,now()),nullif(google_avatar,''),google_name)
  on conflict (id) do update set
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
    bio = case when coalesce(public.users.bio,'')='' then excluded.bio else public.users.bio end,
    email_verified_at = coalesce(public.users.email_verified_at, excluded.email_verified_at),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_google_profile on auth.users;
create trigger on_auth_user_google_profile
after insert on auth.users
for each row execute function public.sync_google_user_profile();

-- Backfill OAuth users that already exist in auth.users but have no VSBIL profile.
do $$
declare u record; base_username text; candidate text; suffix integer; avatar text; display_name text; referral text;
begin
  for u in select a.* from auth.users a left join public.users p on p.id=a.id where p.id is null and a.email is not null loop
    base_username := lower(coalesce(nullif(u.raw_user_meta_data->>'preferred_username',''), nullif(u.raw_user_meta_data->>'user_name',''), nullif(u.raw_user_meta_data->>'username',''), split_part(lower(u.email),'@',1), 'user'));
    base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
    if length(base_username)<3 then base_username := 'user' || substr(replace(u.id::text,'-',''),1,6); end if;
    base_username := left(base_username,24); candidate:=base_username; suffix:=0;
    while exists(select 1 from public.users where username=candidate) loop
      suffix:=suffix+1;
      candidate:=left(base_username,greatest(3,30-length(suffix::text)-1)) || '_' || suffix::text;
    end loop;
    avatar:=coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture',u.raw_user_meta_data->>'photo_url');
    display_name:=coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','');
    referral:='VSBIL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.users(id,email,username,role,status,referral_code,email_verified_at,avatar_url,bio)
    values(u.id,lower(u.email),candidate,'user','active',referral,coalesce(u.email_confirmed_at,now()),nullif(avatar,''),display_name)
    on conflict (id) do nothing;
  end loop;
end $$;
