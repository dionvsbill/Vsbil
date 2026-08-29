-- VSBIL Production Phase 3: campaign funding, activity attempts, wallet safety,
-- idempotency and operational controls. Apply after production_phase2.sql.
create extension if not exists pgcrypto;

-- Compatibility columns required by the production authentication and YouTube routes.
alter table public.users add column if not exists email_verified_at timestamptz;
alter table public.users add column if not exists google_verified_at timestamptz;
alter table public.users add column if not exists phone_verified_at timestamptz;
alter table public.users add column if not exists last_login_at timestamptz;
alter table public.users add column if not exists last_active_at timestamptz;
alter table public.users add column if not exists suspended_at timestamptz;
alter table public.users add column if not exists suspension_reason text;

alter table public.youtube_connections add column if not exists id uuid default gen_random_uuid();
alter table public.youtube_connections add column if not exists google_subject text;
alter table public.youtube_connections add column if not exists google_email text;
alter table public.youtube_connections add column if not exists channel_thumbnail_url text;
alter table public.youtube_connections add column if not exists access_token_encrypted text;
alter table public.youtube_connections add column if not exists last_sync_at timestamptz;

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.youtube_connections'::regclass and contype='c' and pg_get_constraintdef(oid) like '%status%' loop execute format('alter table public.youtube_connections drop constraint %I',c.conname); end loop;
  alter table public.youtube_connections add constraint youtube_connections_status_check check (status in ('connected','revoked','error','disconnected'));
exception when duplicate_object then null; end $$;
create unique index if not exists youtube_connections_user_channel_uq on public.youtube_connections(user_id,channel_id);
update public.youtube_connections set id=gen_random_uuid() where id is null;

alter table public.email_verification_codes add column if not exists purpose text not null default 'email_verification';
alter table public.email_verification_codes add column if not exists max_attempts integer not null default 5 check (max_attempts > 0 and max_attempts <= 20);
alter table public.security_events add column if not exists ip_address text;
alter table public.security_events add column if not exists user_agent text;

create table if not exists public.user_trust_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  risk_score integer not null default 0 check (risk_score >= 0 and risk_score <= 100),
  status text not null default 'normal' check (status in ('normal','watch','restricted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  reference text not null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.wallets add column if not exists reserved_campaign bigint not null default 0 check (reserved_campaign >= 0);
alter table public.activities add column if not exists budget_amount bigint not null default 0 check (budget_amount >= 0);
alter table public.activities add column if not exists reserved_amount bigint not null default 0 check (reserved_amount >= 0);
alter table public.activities add column if not exists spent_amount bigint not null default 0 check (spent_amount >= 0);
alter table public.activities add column if not exists max_participants integer not null default 1 check (max_participants > 0 and max_participants <= 1000000);
alter table public.activities add column if not exists completed_count integer not null default 0 check (completed_count >= 0);
alter table public.activities add column if not exists starts_at timestamptz;
alter table public.activities add column if not exists ends_at timestamptz;
alter table public.activities add column if not exists approved_by uuid references public.users(id) on delete set null;
alter table public.activities add column if not exists approved_at timestamptz;
alter table public.activities add column if not exists review_note text;
alter table public.activities add column if not exists requires_youtube_connection boolean not null default false;
alter table public.activities add column if not exists minimum_seconds integer not null default 30 check (minimum_seconds >= 5 and minimum_seconds <= 3600);

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.activities'::regclass and contype='c' and pg_get_constraintdef(oid) like '%status%' loop execute format('alter table public.activities drop constraint %I',c.conname); end loop;
  alter table public.activities add constraint activities_status_check check (status in ('pending','active','paused','archived','rejected'));
exception when duplicate_object then null; end $$;

alter table public.activity_submissions add column if not exists attempt_id uuid;
alter table public.activity_submissions add column if not exists started_at timestamptz;
alter table public.activity_submissions add column if not exists completed_at timestamptz;
alter table public.activity_submissions add column if not exists evidence jsonb not null default '{}'::jsonb;
alter table public.activity_submissions add column if not exists ip_hash text;
alter table public.activity_submissions add column if not exists user_agent_hash text;

create table if not exists public.activity_attempts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  consumed_at timestamptz,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);
create index if not exists activity_attempts_user_created_idx on public.activity_attempts(user_id, created_at desc);
create index if not exists activity_attempts_activity_created_idx on public.activity_attempts(activity_id, created_at desc);

create table if not exists public.idempotency_keys (
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null,
  route text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(user_id,key,route)
);

create table if not exists public.payout_events (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid references public.withdrawals(id) on delete set null,
  provider text not null,
  provider_reference text,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists payout_events_provider_reference_uq on public.payout_events(provider, provider_reference) where provider_reference is not null;

create index if not exists activities_owner_created_idx on public.activities(created_by, created_at desc);
create index if not exists activities_status_created_idx on public.activities(status, created_at desc);
create index if not exists submissions_user_activity_idx on public.activity_submissions(user_id, activity_id);

-- Reserve the creator's funds atomically. All money values are integer pesewas.
create or replace function public.create_funded_activity(
  p_user_id uuid,
  p_title text,
  p_platform text,
  p_url text,
  p_action text,
  p_reward_amount bigint,
  p_budget_amount bigint,
  p_max_participants integer,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_requires_youtube_connection boolean default false,
  p_minimum_seconds integer default 30
) returns public.activities
language plpgsql security definer set search_path = public
as $$
declare
  w public.wallets;
  a public.activities;
  now_ts timestamptz := now();
begin
  if p_reward_amount <= 0 or p_budget_amount <= 0 or p_max_participants <= 0 or p_minimum_seconds < 5 or p_minimum_seconds > 3600 then raise exception 'INVALID_CAMPAIGN'; end if;
  if p_budget_amount < p_reward_amount * p_max_participants then raise exception 'BUDGET_BELOW_PARTICIPANTS'; end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then raise exception 'INVALID_SCHEDULE'; end if;
  select * into w from public.wallets where user_id=p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if coalesce(w.available,0) < p_budget_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update public.wallets set available=available-p_budget_amount, reserved_campaign=coalesce(reserved_campaign,0)+p_budget_amount, updated_at=now_ts where user_id=p_user_id;
  insert into public.activities(title,platform,url,action,reward_amount,status,created_by,budget_amount,reserved_amount,spent_amount,max_participants,completed_count,starts_at,ends_at,requires_youtube_connection,minimum_seconds)
  values(p_title,p_platform,p_url,p_action,p_reward_amount,'pending',p_user_id,p_budget_amount,p_budget_amount,0,p_max_participants,0,p_starts_at,p_ends_at,p_requires_youtube_connection,p_minimum_seconds)
  returning * into a;
  insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description)
  values(p_user_id,'campaign_reservation',-p_budget_amount,(select available from public.wallets where user_id=p_user_id),a.id,'Campaign budget reserved');
  return a;
end;
$$;

create or replace function public.start_activity_attempt(p_user_id uuid,p_activity_id uuid,p_ip_hash text,p_user_agent_hash text)
returns public.activity_attempts
language plpgsql security definer set search_path=public
as $$
declare a public.activities; x public.activity_attempts; existing public.activity_submissions;
begin
  select * into a from public.activities where id=p_activity_id and status='active' for share;
  if not found then raise exception 'CAMPAIGN_UNAVAILABLE'; end if;
  if a.created_by=p_user_id then raise exception 'OWNER_CANNOT_PARTICIPATE'; end if;
  if a.starts_at is not null and now()<a.starts_at then raise exception 'CAMPAIGN_NOT_STARTED'; end if;
  if a.ends_at is not null and now()>a.ends_at then raise exception 'CAMPAIGN_ENDED'; end if;
  if a.completed_count >= a.max_participants then raise exception 'CAMPAIGN_FULL'; end if;
  select * into existing from public.activity_submissions where user_id=p_user_id and activity_id=p_activity_id limit 1;
  if found then raise exception 'ALREADY_SUBMITTED'; end if;
  insert into public.activity_attempts(activity_id,user_id,expires_at,ip_hash,user_agent_hash) values(p_activity_id,p_user_id,now()+interval '30 minutes',p_ip_hash,p_user_agent_hash) returning * into x;
  return x;
end;
$$;

create or replace function public.complete_activity_attempt(p_attempt_id uuid,p_user_id uuid,p_evidence jsonb,p_ip_hash text,p_user_agent_hash text)
returns public.activity_submissions
language plpgsql security definer set search_path=public
as $$
declare x public.activity_attempts; a public.activities; s public.activity_submissions; min_seconds integer;
begin
  select * into x from public.activity_attempts where id=p_attempt_id and user_id=p_user_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if x.consumed_at is not null then raise exception 'ATTEMPT_CONSUMED'; end if;
  if now()>x.expires_at then raise exception 'ATTEMPT_EXPIRED'; end if;
  select * into a from public.activities where id=x.activity_id for update;
  if not found or a.status<>'active' then raise exception 'CAMPAIGN_UNAVAILABLE'; end if;
  if a.completed_count >= a.max_participants then raise exception 'CAMPAIGN_FULL'; end if;
  if a.action='watch' then
    min_seconds := greatest(5, least(3600, coalesce(a.minimum_seconds,30)));
    if extract(epoch from (now()-x.started_at)) < min_seconds then raise exception 'MINIMUM_TIME_NOT_MET'; end if;
  end if;
  insert into public.activity_submissions(user_id,activity_id,attempt_id,proof_url,status,reward_amount,started_at,completed_at,evidence,ip_hash,user_agent_hash)
  values(p_user_id,a.id,x.id,null,'pending',a.reward_amount,x.started_at,now(),coalesce(p_evidence,'{}'::jsonb),p_ip_hash,p_user_agent_hash)
  returning * into s;
  update public.activity_attempts set consumed_at=now(),completed_at=now() where id=x.id;
  return s;
exception when unique_violation then raise exception 'ALREADY_SUBMITTED';
end;
$$;

-- Admin approval pays exactly once and consumes campaign reserve atomically.
create or replace function public.approve_activity_submission(p_submission_id uuid,p_admin_id uuid,p_note text default null)
returns public.activity_submissions
language plpgsql security definer set search_path=public
as $$
declare s public.activity_submissions; a public.activities; w public.wallets; out public.activity_submissions; amount bigint;
begin
  select * into s from public.activity_submissions where id=p_submission_id for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if s.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;
  select * into a from public.activities where id=s.activity_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  amount:=coalesce(s.reward_amount,a.reward_amount,0);
  if amount<=0 then raise exception 'INVALID_REWARD'; end if;
  if coalesce(a.reserved_amount,0)<amount then raise exception 'CAMPAIGN_FUNDS_EXHAUSTED'; end if;
  select * into w from public.wallets where user_id=s.user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  update public.wallets set reserved_campaign=greatest(0,coalesce(reserved_campaign,0)-amount),updated_at=now() where user_id=a.created_by;
  update public.wallets set available=available+amount,total_earned=coalesce(total_earned,0)+amount,updated_at=now() where user_id=s.user_id;
  update public.activities set reserved_amount=reserved_amount-amount,spent_amount=spent_amount+amount,completed_count=completed_count+1 where id=a.id;
  update public.activity_submissions set status='approved',reward_amount=amount,admin_note=p_note,reviewed_at=now() where id=s.id returning * into out;
  insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(s.user_id,'earning',amount,(select available from public.wallets where user_id=s.user_id),s.id,'Verified campaign reward');
  return out;
end;
$$;

-- Release unused campaign reserve when an admin closes a campaign.
create or replace function public.release_activity_reserve(p_activity_id uuid,p_admin_id uuid,p_note text default null)
returns public.activities
language plpgsql security definer set search_path=public
as $$
declare a public.activities; w public.wallets; amount bigint; out_a public.activities;
begin
  select * into a from public.activities where id=p_activity_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  amount:=coalesce(a.reserved_amount,0);
  if amount>0 then
    select * into w from public.wallets where user_id=a.created_by for update;
    if found then
      update public.wallets set available=available+amount,reserved_campaign=greatest(0,coalesce(reserved_campaign,0)-amount),updated_at=now() where user_id=a.created_by;
      insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(a.created_by,'campaign_release',amount,(select available from public.wallets where user_id=a.created_by),a.id,coalesce(p_note,'Unused campaign budget released'));
    end if;
  end if;
  update public.activities set reserved_amount=0,status='archived',review_note=p_note,approved_by=p_admin_id,approved_at=coalesce(approved_at,now()) where id=a.id returning * into out_a;
  return out_a;
end;
$$;

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.wallet_ledger'::regclass and contype='c' and pg_get_constraintdef(oid) like '%entry_type%' loop execute format('alter table public.wallet_ledger drop constraint %I',c.conname); end loop;
end $$;

alter table public.activity_attempts enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.payout_events enable row level security;

insert into public.system_settings(key,value) values
('campaign_min_budget_ghs','5'::jsonb),
('campaign_max_budget_ghs','100000'::jsonb),
('campaign_min_reward_ghs','0.10'::jsonb),
('campaign_max_reward_ghs','100'::jsonb),
('campaign_default_hold_minutes','0'::jsonb),
('watch_rewarding_enabled','true'::jsonb),
('incentivized_like_subscribe_enabled','false'::jsonb)
on conflict(key) do nothing;

create or replace function public.review_activity(p_activity_id uuid,p_admin_id uuid,p_status text,p_note text default null)
returns public.activities
language plpgsql security definer set search_path=public
as $$
declare a public.activities; out_a public.activities;
begin
  if p_status not in ('active','paused','archived','rejected') then raise exception 'INVALID_STATUS'; end if;
  select * into a from public.activities where id=p_activity_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if p_status='active' then
    if coalesce(a.reserved_amount,0)<=0 then raise exception 'CAMPAIGN_UNFUNDED'; end if;
    update public.activities set status='active',approved_by=p_admin_id,approved_at=now(),review_note=p_note where id=a.id returning * into out_a;
  elsif p_status='rejected' or p_status='archived' then
    if coalesce(a.reserved_amount,0)>0 then
      update public.wallets set available=available+a.reserved_amount,reserved_campaign=greatest(0,coalesce(reserved_campaign,0)-a.reserved_amount),updated_at=now() where user_id=a.created_by;
      insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(a.created_by,'campaign_release',a.reserved_amount,(select available from public.wallets where user_id=a.created_by),a.id,coalesce(p_note,'Unused campaign budget released'));
    end if;
    update public.activities set reserved_amount=0,status=p_status,review_note=p_note,approved_by=p_admin_id,approved_at=coalesce(approved_at,now()) where id=a.id returning * into out_a;
  else
    update public.activities set status=p_status,review_note=p_note,approved_by=p_admin_id,approved_at=coalesce(approved_at,now()) where id=a.id returning * into out_a;
  end if;
  return out_a;
end;
$$;
