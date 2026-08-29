-- VSBIL Wallet Security v2
-- Money is credited only by trusted server-side payment verification.
create table if not exists public.wallet_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  action text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  amount bigint,
  currency text,
  requested_reference text,
  endpoint text,
  ip_hash text,
  device_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wallet_security_user_idx on public.wallet_security_events(user_id,created_at desc);
create index if not exists wallet_security_ip_idx on public.wallet_security_events(ip_hash,created_at desc);
create index if not exists wallet_security_device_idx on public.wallet_security_events(device_hash,created_at desc);

create table if not exists public.wallet_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete restrict,
  provider text not null,
  provider_transaction_id text not null,
  reference text not null,
  amount bigint not null check (amount > 0),
  currency text not null,
  status text not null default 'verified' check (status in ('pending','verified','reversed','rejected')),
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider,provider_transaction_id),
  unique(reference)
);
create index if not exists wallet_credits_user_idx on public.wallet_credits(user_id,created_at desc);

alter table public.wallet_security_events enable row level security;
alter table public.wallet_credits enable row level security;

-- Browser clients receive no insert/update/delete policy. Only the trusted
-- service-role backend can create verified credits or security records.
