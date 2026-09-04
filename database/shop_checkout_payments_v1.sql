-- VSBIL SHOP CHECKOUT PAYMENTS V1
-- Payment session data stays server-side. Orders are created only after verified payment.
create table if not exists public.shop_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  buyer_name text not null,
  buyer_phone text not null,
  buyer_email text,
  delivery_address text,
  delivery_note text,
  payment_method text not null check (payment_method in ('mobile_money','card')),
  items jsonb not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'GHS',
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','cancelled')),
  provider_transaction_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists shop_checkout_sessions_shop_idx on public.shop_checkout_sessions(shop_id,created_at desc);
create index if not exists shop_checkout_sessions_status_idx on public.shop_checkout_sessions(status,created_at desc);
alter table public.shop_checkout_sessions enable row level security;
