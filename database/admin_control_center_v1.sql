-- VSBIL Admin Control Center v1
-- Server-side verification, feature visibility controls and admin observability.

alter table public.users add column if not exists is_verified boolean not null default false;
alter table public.users add column if not exists verified_at timestamptz;
alter table public.users add column if not exists verified_by uuid references public.users(id) on delete set null;
alter table public.users add column if not exists verification_note text;

alter table public.business_shops add column if not exists is_verified boolean not null default false;
alter table public.business_shops add column if not exists verified_at timestamptz;
alter table public.business_shops add column if not exists verified_by uuid references public.users(id) on delete set null;
alter table public.business_shops add column if not exists verification_note text;

create table if not exists public.feature_flags (
  key text primary key,
  label text not null,
  description text,
  enabled boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags(key,label,description,enabled) values
('creator_program','Creator Program','Creator campaign participation and funding.',true),
('business_suite','Business Suite','Business/shop tools.',true),
('landlord','Landlord','Property and tenant management.',false),
('services','Services','Service marketplace/tools.',false),
('church','Church','Church management tools.',true),
('funeral','Funeral','Funeral campaign tools.',true)
on conflict(key) do nothing;

create index if not exists users_verified_idx on public.users(is_verified,created_at desc);
create index if not exists shops_verified_idx on public.business_shops(is_verified,created_at desc);

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon,authenticated;
grant select,insert,update,delete on public.feature_flags to service_role;

revoke all on public.user_security_devices from anon,authenticated;
revoke all on public.account_security_events from anon,authenticated;
revoke all on public.campaign_participation_history from anon,authenticated;
grant select,insert,update,delete on public.user_security_devices to service_role;
grant select,insert,update,delete on public.account_security_events to service_role;
grant select,insert,update,delete on public.campaign_participation_history to service_role;

grant select,insert,update,delete on public.users to service_role;
grant select,insert,update,delete on public.business_shops to service_role;
grant select,insert,update,delete on public.audit_logs to service_role;
