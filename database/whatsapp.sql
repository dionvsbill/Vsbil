-- VSBIL WhatsApp Business automation production migration
-- Run once in Supabase SQL Editor after the existing production schema.
-- Express uses the service-role key only after authenticating the VSBIL user.

create table if not exists public.whatsapp_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  phone_number_id text not null unique,
  access_token_encrypted text not null,
  display_phone_number text,
  business_name text,
  status text not null default 'connected' check (status in ('connected','disconnected','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_bots_phone_idx on public.whatsapp_bots(phone_number_id);
create index if not exists whatsapp_bots_status_idx on public.whatsapp_bots(status);

create table if not exists public.whatsapp_bot_flows (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.whatsapp_bots(id) on delete cascade,
  keyword text not null,
  reply_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bot_id, keyword)
);
create index if not exists whatsapp_bot_flows_bot_idx on public.whatsapp_bot_flows(bot_id,is_active);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.whatsapp_bots(id) on delete cascade,
  wa_message_id text not null,
  sender_phone text not null,
  incoming_text text,
  matched_keyword text,
  outgoing_text text,
  status text not null check (status in ('sent','failed','no_match','ignored')),
  error_message text,
  created_at timestamptz not null default now(),
  unique(bot_id,wa_message_id)
);
create index if not exists whatsapp_messages_bot_created_idx on public.whatsapp_messages(bot_id,created_at desc);
create index if not exists whatsapp_messages_sender_idx on public.whatsapp_messages(bot_id,sender_phone,created_at desc);

create table if not exists public.whatsapp_subscriptions (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null unique references public.whatsapp_bots(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  plan text not null check (plan in ('starter','business','pro')),
  status text not null default 'active' check (status in ('active','past_due','cancelled','suspended')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_subscriptions_user_idx on public.whatsapp_subscriptions(user_id,status,current_period_end desc);

create table if not exists public.whatsapp_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  bot_id uuid not null references public.whatsapp_bots(id) on delete restrict,
  reference text not null unique,
  provider_reference text,
  plan text not null check (plan in ('starter','business','pro')),
  amount_ghs numeric(12,2) not null check (amount_ghs in (150,250,350)),
  status text not null default 'pending' check (status in ('pending','success','failed','abandoned')),
  paid_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_subscription_payments_user_idx on public.whatsapp_subscription_payments(user_id,created_at desc);

alter table public.whatsapp_bots enable row level security;
alter table public.whatsapp_bot_flows enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_subscriptions enable row level security;
alter table public.whatsapp_subscription_payments enable row level security;

-- No client policies: the VSBIL Express API is the authoritative access layer.

insert into public.system_settings(key,value)
values ('whatsapp_plans','{"starter":150,"business":250,"pro":350,"currency":"GHS","period_days":30}'::jsonb)
on conflict(key) do update set value=excluded.value,updated_at=now();
