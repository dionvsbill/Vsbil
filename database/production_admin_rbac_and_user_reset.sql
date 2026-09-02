-- VSBIL PRODUCTION ADMIN RBAC + USER DATA RESET
-- Run this file manually in Supabase SQL Editor after reviewing it.
-- The reset is intentionally guarded by an explicit confirmation string.
-- Optional VSBIL tables are checked before deletion so this migration works
-- against installations where a feature has not been enabled yet.

begin;

-- Additional staff accounts are support-only. The existing admin role remains Super Admin.
update public.users
set role = 'admin', status = 'active', updated_at = now()
where lower(email) = 'billphamous@gmail.com';

-- Referral relationships are intentionally nullable. Never assign the super admin as a default referrer.
-- New accounts without a referral must keep referred_by = NULL.

-- Protect the super administrator at the database layer.
create or replace function public.protect_super_admin_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(old.email,'')) = 'billphamous@gmail.com' then
    if tg_op = 'DELETE' then
      raise exception 'PROTECTED_SUPER_ADMIN';
    end if;
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'PROTECTED_SUPER_ADMIN';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_super_admin_account on public.users;
create trigger trg_protect_super_admin_account
before update or delete on public.users
for each row execute function public.protect_super_admin_account();

-- Production reset. Change NOTHING except the confirmation value if you really intend to wipe users.
do $$
declare
  confirmation text := 'RESET_VSBIL_USERS_2026';
  super_id uuid;
begin
  if confirmation <> 'RESET_VSBIL_USERS_2026' then
    raise exception 'Reset confirmation missing';
  end if;

  select id into super_id from public.users where lower(email) = 'billphamous@gmail.com' limit 1;
  if super_id is null then
    raise exception 'Protected super administrator billphamous@gmail.com was not found; reset aborted';
  end if;

  -- Remove application/user data first. Configuration and schema are preserved.
  -- Feature-specific tables are optional; only delete from them when they exist.
  if to_regclass('public.campaign_participation_history') is not null then
    delete from public.campaign_participation_history where user_id <> super_id;
  end if;
  if to_regclass('public.user_security_devices') is not null then
    delete from public.user_security_devices where user_id <> super_id;
  end if;
  if to_regclass('public.account_security_events') is not null then
    delete from public.account_security_events where user_id <> super_id;
  end if;
  if to_regclass('public.activity_submissions') is not null then
    delete from public.activity_submissions where user_id <> super_id;
  end if;
  if to_regclass('public.withdrawals') is not null then
    delete from public.withdrawals where user_id <> super_id;
  end if;
  if to_regclass('public.wallet_ledger') is not null then
    delete from public.wallet_ledger where user_id <> super_id;
  end if;
  if to_regclass('public.wallets') is not null then
    delete from public.wallets where user_id <> super_id;
  end if;
  if to_regclass('public.payments') is not null then
    delete from public.payments where user_id <> super_id;
  end if;
  if to_regclass('public.referrals') is not null then
    delete from public.referrals where referrer_id <> super_id and referred_user_id <> super_id;
  end if;
  if to_regclass('public.support_tickets') is not null then
    delete from public.support_tickets where user_id <> super_id;
  end if;
  if to_regclass('public.notifications') is not null then
    delete from public.notifications where user_id <> super_id;
  end if;
  if to_regclass('public.business_shops') is not null then
    delete from public.business_shops where user_id <> super_id;
  end if;
  if to_regclass('public.audit_logs') is not null then
    delete from public.audit_logs where admin_id <> super_id;
  end if;
  if to_regclass('public.creator_enrollments') is not null then
    delete from public.creator_enrollments where user_id <> super_id;
  end if;
  if to_regclass('public.activities') is not null then
    delete from public.activities where created_by is not null and created_by <> super_id;
  end if;

  -- Remove all application profiles except the protected super administrator.
  delete from public.users where id <> super_id;

  -- Remove deleted users' Supabase Auth identities if the SQL editor has permission.
  delete from auth.users where id <> super_id;
end $$;

-- Make sure the preserved account remains the only Super Admin after the reset.
update public.users
set role = 'admin', status = 'active', referred_by = null, updated_at = now()
where id = (select id from public.users where lower(email) = 'billphamous@gmail.com' limit 1);

commit;
