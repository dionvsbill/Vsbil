-- VSBIL PRODUCTION DATABASE
-- Run in Supabase SQL Editor. Back up an existing database before applying changes.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null unique,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'pending' check (status in ('pending','active','suspended','banned')),
  referral_code text not null unique,
  referred_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists users_referred_by_idx on public.users(referred_by);
create index if not exists users_status_idx on public.users(status);

create table if not exists public.wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  available bigint not null default 0,
  pending bigint not null default 0,
  total_earned bigint not null default 0,
  lifetime_withdrawn bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_wallet (
  id integer primary key default 1 check (id = 1),
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.platform_wallet(id,balance) values(1,0) on conflict(id) do nothing;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  reference text not null unique,
  provider text not null default 'paystack',
  provider_reference text,
  purpose text not null check (purpose in ('activation','other')),
  amount bigint not null,
  amount_ghs numeric(12,2) not null,
  currency text not null default 'GHS',
  status text not null default 'pending' check (status in ('pending','success','failed','abandoned')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments(user_id);
create index if not exists payments_status_idx on public.payments(status);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  entry_type text not null check (entry_type in ('earning','referral_bonus','activation_bonus','withdrawal','refund','adjustment')),
  amount bigint not null,
  balance_after bigint,
  reference_id uuid,
  description text not null,
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger(user_id,created_at desc);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users(id) on delete restrict,
  referred_user_id uuid not null unique references public.users(id) on delete restrict,
  bonus_amount bigint not null default 1000,
  status text not null default 'pending' check (status in ('pending','credited','reversed')),
  created_at timestamptz not null default now(),
  credited_at timestamptz
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform text not null check (platform in ('youtube')),
  url text not null,
  action text not null check (action in ('watch','like','subscribe')),
  reward_amount bigint not null check (reward_amount > 0),
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  proof_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reward_amount bigint not null default 0,
  admin_note text,
  reviewed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(user_id,activity_id)
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  amount bigint not null check (amount > 0),
  method text not null check (method in ('mobile_money','bank')),
  account_details jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  admin_note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists withdrawals_status_idx on public.withdrawals(status,created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

-- Ensure wallets exist for users.
create or replace function public.ensure_wallet() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing; return new; end; $$;
drop trigger if exists users_wallet_trigger on public.users;
create trigger users_wallet_trigger after insert on public.users for each row execute function public.ensure_wallet();

create or replace function public.activate_user_after_payment(p_payment_id uuid, p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p payments%rowtype; u users%rowtype; ref users.id%type; new_balance bigint;
begin
 select * into p from public.payments where id=p_payment_id for update;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 if p.status='success' then return jsonb_build_object('success',true,'already_processed',true); end if;
 if p.purpose<>'activation' or p.amount<>5000 then raise exception 'INVALID_ACTIVATION_PAYMENT'; end if;
 select * into u from public.users where id=p.user_id for update;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
 update public.payments set status='success',provider_reference=p_provider_reference,paid_at=coalesce(paid_at,now()),verified_at=now(),updated_at=now() where id=p.id;
 update public.users set status='active',updated_at=now() where id=u.id;
 insert into public.wallets(user_id) values(u.id) on conflict(user_id) do nothing;
 -- New-user activation bonus: GH₵5.00
 update public.wallets set available=available+500,total_earned=total_earned+500,updated_at=now() where user_id=u.id returning available into new_balance;
 insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(u.id,'activation_bonus',500,new_balance,p.id,'VSBIL activation welcome bonus');
 -- Referrer bonus: GH₵10.00, exactly once.
 ref := u.referred_by;
 if ref is not null then
   insert into public.referrals(referrer_id,referred_user_id,bonus_amount,status,credited_at) values(ref,u.id,1000,'credited',now()) on conflict(referred_user_id) do nothing;
   if found then
     update public.wallets set available=available+1000,total_earned=total_earned+1000,updated_at=now() where user_id=ref returning available into new_balance;
     insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(ref,'referral_bonus',1000,new_balance,p.id,'Referral activation bonus');
   end if;
 end if;
 -- Platform allocation: GH₵35.00.
 update public.platform_wallet set balance=balance+3500,updated_at=now() where id=1;
 insert into public.notifications(user_id,title,message) values(u.id,'Account activated','Your payment was verified and your VSBIL account is now active. GH₵5.00 welcome credit has been added.');
 return jsonb_build_object('success',true,'user_id',u.id);
end; $$;

create or replace function public.request_withdrawal(p_user_id uuid,p_amount bigint,p_method text,p_account_details jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b bigint; w uuid; after_balance bigint;
begin
 if p_amount<1000 then raise exception 'MINIMUM_WITHDRAWAL'; end if;
 select available into b from public.wallets where user_id=p_user_id for update;
 if b is null or b<p_amount then raise exception 'INSUFFICIENT_BALANCE'; end if;
 update public.wallets set available=available-p_amount,pending=pending+p_amount,updated_at=now() where user_id=p_user_id returning available into after_balance;
 insert into public.withdrawals(user_id,amount,method,account_details,status) values(p_user_id,p_amount,p_method,p_account_details,'pending') returning id into w;
 insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(p_user_id,'withdrawal',-p_amount,after_balance,w,'Withdrawal requested');
 return jsonb_build_object('id',w,'amount',p_amount/100.0,'status','pending');
end; $$;

create or replace function public.refund_withdrawal(p_withdrawal_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare w withdrawals%rowtype; after_balance bigint;
begin select * into w from withdrawals where id=p_withdrawal_id for update; if not found or w.status<>'rejected' then return; end if;
 update wallets set pending=greatest(0,pending-w.amount),available=available+w.amount,updated_at=now() where user_id=w.user_id returning available into after_balance;
 insert into wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(w.user_id,'refund',w.amount,after_balance,w.id,'Rejected withdrawal refunded');
end; $$;

create or replace function public.review_submission(p_submission_id uuid,p_status text,p_admin_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s activity_submissions%rowtype; a activities%rowtype; reward bigint; after_balance bigint;
begin
 select * into s from activity_submissions where id=p_submission_id for update; if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if; if s.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;
 select * into a from activities where id=s.activity_id; reward:=a.reward_amount;
 update activity_submissions set status=p_status,reward_amount=case when p_status='approved' then reward else 0 end,admin_note=p_note,reviewed_by=p_admin_id,reviewed_at=now() where id=s.id;
 if p_status='approved' then
   update wallets set available=available+reward,total_earned=total_earned+reward,updated_at=now() where user_id=s.user_id returning available into after_balance;
   insert into wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(s.user_id,'earning',reward,after_balance,s.id,'Approved activity reward');
   insert into notifications(user_id,title,message) values(s.user_id,'Activity approved',format('GH₵%s reward was added to your wallet.',to_char(reward/100.0,'FM999999990.00')));
 else insert into notifications(user_id,title,message) values(s.user_id,'Activity rejected',coalesce(p_note,'Your activity submission was rejected.'));
 end if;
 return jsonb_build_object('id',s.id,'status',p_status,'reward',case when p_status='approved' then reward/100.0 else 0 end);
end; $$;

-- RLS: service-role server is authoritative. Clients should not use the service role key.
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.payments enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.referrals enable row level security;
alter table public.activities enable row level security;
alter table public.activity_submissions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- No anon/authenticated policies are created intentionally; the Express API uses the service role after validating Supabase JWTs.
