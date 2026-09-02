-- VSBIL PRODUCTION ADMIN RBAC + USER DATA RESET
-- Run this file manually in Supabase SQL Editor after reviewing it.
-- The reset is intentionally guarded by an explicit confirmation string.

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
  -- auth.users is handled last so Supabase Auth accounts for deleted application users are removed too.
  delete from public.campaign_participation_history where user_id <> super_id;
  delete from public.user_security_devices where user_id <> super_id;
  delete from public.account_security_events where user_id <> super_id;
  delete from public.activity_submissions where user_id <> super_id;
  delete from public.withdrawals where user_id <> super_id;
  delete from public.wallet_ledger where user_id <> super_id;
  delete from public.wallets where user_id <> super_id;
  delete from public.payments where user_id <> super_id;
  delete from public.referrals where referrer_id <> super_id and referred_user_id <> super_id;
  delete from public.support_tickets where user_id <> super_id;
  delete from public.notifications where user_id <> super_id;
  delete from public.business_shops where user_id <> super_id;
  delete from public.audit_logs where admin_id <> super_id;
  delete from public.creator_enrollments where user_id <> super_id;

  -- User-created campaigns/activities are application data. Keep none from old users.
  delete from public.activities where created_by is not null and created_by <> super_id;

  -- Remove all application profiles except the protected super administrator.
  delete from public.users where id <> super_id;

  -- Remove deleted users' Supabase Auth identities if the SQL editor has permission.
  delete from auth.users where id <> super_id;
exception
  when undefined_table then
    raise exception 'A referenced VSBIL table is missing. Review this migration before retrying: %', sqlerrm;
end $$;

-- Make sure the preserved account remains the only Super Admin after the reset.
update public.users
set role = 'admin', status = 'active', referred_by = null, updated_at = now()
where id = (select id from public.users where lower(email) = 'billphamous@gmail.com' limit 1);

commit;
