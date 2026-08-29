-- VSBIL Security + Participation Ledger v1
-- Run once in Supabase SQL Editor. Service-role backend writes these tables.
create extension if not exists pgcrypto;

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','low','medium','high','critical')),
  email_hash text,
  ip_hash text,
  device_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user_idx on public.account_security_events(user_id,created_at desc);
create index if not exists account_security_events_ip_idx on public.account_security_events(ip_hash,created_at desc);
create index if not exists account_security_events_device_idx on public.account_security_events(device_hash,created_at desc);

create table if not exists public.user_security_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_hash text not null,
  ip_hash text,
  user_agent_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  login_count integer not null default 0,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  status text not null default 'trusted' check (status in ('trusted','review','blocked')),
  unique(user_id,device_hash)
);
create index if not exists user_security_devices_hash_idx on public.user_security_devices(device_hash);

create table if not exists public.campaign_participation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  creator_id uuid references public.users(id) on delete set null,
  platform text not null default 'youtube',
  channel_id text,
  channel_url text,
  action text not null check (action in ('watch','view','like','subscribe')),
  status text not null default 'started' check (status in ('started','verified','rejected','reversed','expired')),
  attempt_id uuid,
  reward_amount bigint not null default 0,
  verified_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  evidence jsonb not null default '{}'::jsonb,
  ip_hash text,
  device_hash text,
  created_at timestamptz not null default now()
);
create index if not exists campaign_participation_user_idx on public.campaign_participation_history(user_id,created_at desc);
create index if not exists campaign_participation_channel_idx on public.campaign_participation_history(user_id,channel_id,action,status);
create index if not exists campaign_participation_activity_idx on public.campaign_participation_history(activity_id,user_id);

-- Prevent duplicate subscription participation for the same user/channel once a
-- subscription campaign is introduced. Views/likes remain independently recordable.
create unique index if not exists one_verified_subscription_per_user_channel
on public.campaign_participation_history(user_id,channel_id)
where action='subscribe' and status in ('started','verified');

alter table public.account_security_events enable row level security;
alter table public.user_security_devices enable row level security;
alter table public.campaign_participation_history enable row level security;

-- No direct browser writes/reads. Backend uses the Supabase service role.
