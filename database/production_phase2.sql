-- VSBIL production identity, YouTube verification and security layer.
-- Run after the core wallet/payment migration already applied to the project.

create table if not exists public.youtube_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  channel_id text not null,
  channel_title text not null,
  channel_url text not null,
  thumbnail_url text,
  refresh_token_encrypted text,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','revoked','error')),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists youtube_connections_channel_id_uq on public.youtube_connections(channel_id);

create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_codes_user_created_idx on public.email_verification_codes(user_id, created_at desc);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_events_user_created_idx on public.security_events(user_id, created_at desc);
create index if not exists security_events_type_created_idx on public.security_events(event_type, created_at desc);

-- Advertising remains disabled until the verified-user threshold is reached.
insert into public.system_settings(key, value)
values
  ('advertising_enabled', 'false'::jsonb),
  ('advertising_user_threshold', '10000'::jsonb),
  ('withdrawal_min_ghs', '20'::jsonb),
  ('withdrawal_weekly_max_ghs', '5000'::jsonb),
  ('withdrawal_review_business_days', '3'::jsonb)
on conflict (key) do nothing;

-- RLS: these tables are accessed by the trusted server only. Do not expose
-- service-role credentials to the browser. Policies intentionally deny direct
-- client access; the application server performs authorization.
alter table public.youtube_connections enable row level security;
alter table public.email_verification_codes enable row level security;
alter table public.security_events enable row level security;
