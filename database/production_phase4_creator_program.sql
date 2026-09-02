-- VSBIL Production Phase 4: creator-program eligibility and atomic enrollment.
-- Apply after production_phase3.sql. Browser never receives direct table access.

create extension if not exists pgcrypto;

create table if not exists public.creator_program_enrollments (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','left','suspended')),
  accepted_terms_at timestamptz,
  originality_required boolean not null default true,
  quality_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creator_program_enrollments add column if not exists accepted_terms_at timestamptz;
alter table public.creator_program_enrollments add column if not exists originality_required boolean not null default true;
alter table public.creator_program_enrollments add column if not exists quality_required boolean not null default true;
alter table public.creator_program_enrollments add column if not exists created_at timestamptz not null default now();
alter table public.creator_program_enrollments add column if not exists updated_at timestamptz not null default now();
alter table public.creator_program_enrollments enable row level security;

create index if not exists creator_program_status_idx
  on public.creator_program_enrollments(status, updated_at desc);

create or replace function public.join_creator_program(p_user_id uuid)
returns public.creator_program_enrollments
language plpgsql security definer set search_path = public
as $$
declare e public.creator_program_enrollments;
begin
  if not exists (select 1 from public.users where id=p_user_id and status='active') then
    raise exception 'ACTIVATION_REQUIRED';
  end if;

  insert into public.creator_program_enrollments(
    user_id,status,accepted_terms_at,originality_required,quality_required,updated_at
  ) values (
    p_user_id,'active',now(),true,true,now()
  )
  on conflict (user_id) do update set
    status='active',
    accepted_terms_at=coalesce(public.creator_program_enrollments.accepted_terms_at,excluded.accepted_terms_at),
    updated_at=now()
  returning * into e;

  update public.users
  set content_participant=true
  where id=p_user_id and status='active';

  return e;
end;
$$;

create or replace function public.leave_creator_program(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.creator_program_enrollments
  set status='left',updated_at=now()
  where user_id=p_user_id;
  update public.users set content_participant=false where id=p_user_id;
  return true;
end;
$$;

-- Creator campaign funding is allowed only for an active creator-program member.
-- This check is inside the same transaction as the wallet reservation, so a
-- client cannot bypass the UI and call the campaign endpoint directly.
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
  if not exists (
    select 1 from public.creator_program_enrollments
    where user_id=p_user_id and status='active'
  ) then
    raise exception 'PROGRAM_REQUIRED';
  end if;

  if p_reward_amount <= 0 or p_budget_amount <= 0 or p_max_participants <= 0
     or p_minimum_seconds < 5 or p_minimum_seconds > 3600 then
    raise exception 'INVALID_CAMPAIGN';
  end if;
  if p_budget_amount < p_reward_amount * p_max_participants then
    raise exception 'BUDGET_BELOW_PARTICIPANTS';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    raise exception 'INVALID_SCHEDULE';
  end if;

  select * into w from public.wallets where user_id=p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if coalesce(w.available,0) < p_budget_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  update public.wallets
  set available=available-p_budget_amount,
      reserved_campaign=coalesce(reserved_campaign,0)+p_budget_amount,
      updated_at=now_ts
  where user_id=p_user_id;

  insert into public.activities(
    title,platform,url,action,reward_amount,status,created_by,budget_amount,
    reserved_amount,spent_amount,max_participants,completed_count,starts_at,ends_at,
    requires_youtube_connection,minimum_seconds
  ) values (
    p_title,p_platform,p_url,p_action,p_reward_amount,'pending',p_user_id,p_budget_amount,
    p_budget_amount,0,p_max_participants,0,p_starts_at,p_ends_at,
    p_requires_youtube_connection,p_minimum_seconds
  ) returning * into a;

  insert into public.wallet_ledger(
    user_id,entry_type,amount,balance_after,reference_id,description
  ) values (
    p_user_id,'campaign_reservation',-p_budget_amount,
    (select available from public.wallets where user_id=p_user_id),
    a.id,'Campaign budget reserved'
  );

  return a;
end;
$$;
