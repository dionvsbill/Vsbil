-- VSBIL SHOP EXPANSION V2
-- Extends the existing Business Suite/Commerce schema. Safe to run after
-- business_suite.sql, commerce_v1.sql, whatsapp.sql and wallet migrations.
create extension if not exists pgcrypto;

alter table public.business_shops add column if not exists banner_url text;
alter table public.business_shops add column if not exists momo_number text;
alter table public.business_shops add column if not exists delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0);
alter table public.business_shops add column if not exists jforce_id text;
alter table public.business_shops add column if not exists shop_status text not null default 'pending' check (shop_status in ('pending','approved','rejected','suspended'));
alter table public.business_shops add column if not exists is_pro boolean not null default false;
alter table public.business_shops add column if not exists pro_expires_at timestamptz;
create index if not exists business_shops_status_idx on public.business_shops(shop_status,created_at desc);

alter table public.inventory_products add column if not exists category text;
alter table public.inventory_products add column if not exists image_urls text[] not null default '{}';
alter table public.inventory_products add column if not exists original_price numeric(14,2);
alter table public.inventory_products add column if not exists source text;
alter table public.inventory_products add column if not exists source_url text;
alter table public.inventory_products add column if not exists source_product_id text;
alter table public.inventory_products add column if not exists source_currency text;
alter table public.inventory_products add column if not exists source_in_stock boolean;
alter table public.inventory_products add column if not exists last_synced_at timestamptz;
create index if not exists inventory_products_category_idx on public.inventory_products(shop_id,category,is_published);
create unique index if not exists inventory_products_source_uidx on public.inventory_products(shop_id,source,source_product_id) where source is not null and source_product_id is not null;

alter table public.wallets add column if not exists pending_shop bigint not null default 0 check (pending_shop >= 0);

alter table public.shop_orders add column if not exists platform_fee_amount numeric(14,2) not null default 0 check (platform_fee_amount >= 0);
alter table public.shop_orders add column if not exists seller_pending_amount numeric(14,2) not null default 0 check (seller_pending_amount >= 0);
alter table public.shop_orders add column if not exists seller_released_amount numeric(14,2) not null default 0 check (seller_released_amount >= 0);
alter table public.shop_orders add column if not exists fee_percent numeric(5,2) not null default 5 check (fee_percent >= 0 and fee_percent <= 100);
alter table public.shop_orders add column if not exists escrow_status text not null default 'not_funded' check (escrow_status in ('not_funded','held','released','refunded'));
alter table public.shop_orders add column if not exists delivery_confirmed_at timestamptz;
alter table public.shop_orders add column if not exists seller_released_at timestamptz;
create unique index if not exists shop_orders_payment_reference_uidx on public.shop_orders(payment_reference) where payment_reference is not null;
create index if not exists shop_orders_escrow_idx on public.shop_orders(escrow_status,created_at desc);

create table if not exists public.shop_customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  phone text not null,
  name text,
  email text,
  address text,
  order_count integer not null default 0 check (order_count >= 0),
  total_spent numeric(14,2) not null default 0 check (total_spent >= 0),
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id,phone)
);
create index if not exists shop_customers_shop_idx on public.shop_customers(shop_id,last_order_at desc);

create table if not exists public.jforce_clicks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  product_id uuid references public.inventory_products(id) on delete set null,
  affiliate_url text not null,
  referrer text,
  user_agent_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists jforce_clicks_shop_idx on public.jforce_clicks(shop_id,created_at desc);

create table if not exists public.shop_wallet_holds (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  order_id uuid not null unique references public.shop_orders(id) on delete cascade,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  fee_amount numeric(14,2) not null default 0 check (fee_amount >= 0),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  status text not null default 'held' check (status in ('held','released','refunded')),
  held_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists shop_wallet_holds_shop_idx on public.shop_wallet_holds(shop_id,status,held_at desc);

create table if not exists public.shop_settlements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  order_id uuid not null unique references public.shop_orders(id) on delete restrict,
  gross_amount numeric(14,2) not null,
  platform_fee numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  status text not null default 'released' check (status in ('released','reversed')),
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists shop_settlements_shop_idx on public.shop_settlements(shop_id,released_at desc);

create table if not exists public.shop_subscription_usage (
  user_id uuid primary key references public.users(id) on delete cascade,
  product_count integer not null default 0 check (product_count >= 0),
  conversations_used integer not null default 0 check (conversations_used >= 0),
  period_start timestamptz not null default now(),
  period_end timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_shop_flows (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.business_shops(id) on delete cascade,
  trigger_keyword text not null,
  action_type text not null check (action_type in ('send_message','send_product_list','send_product','create_order','send_payment_link','check_order_status')),
  action_config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id,trigger_keyword)
);
create index if not exists whatsapp_shop_flows_shop_idx on public.whatsapp_shop_flows(shop_id,is_enabled);

alter table public.shop_customers enable row level security;
alter table public.jforce_clicks enable row level security;
alter table public.shop_wallet_holds enable row level security;
alter table public.shop_settlements enable row level security;
alter table public.shop_subscription_usage enable row level security;
alter table public.whatsapp_shop_flows enable row level security;

-- Existing VSBIL Express API is the trusted access layer; no direct client
-- financial writes are granted here.

create or replace function public.shop_fee_percent(p_user_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select case when exists (
    select 1 from public.business_shops s
    where s.user_id=p_user_id and s.is_pro=true and (s.pro_expires_at is null or s.pro_expires_at>now())
  ) then 3 else 5 end
$$;
revoke all on function public.shop_fee_percent(uuid) from public,anon,authenticated;
grant execute on function public.shop_fee_percent(uuid) to service_role;

create or replace function public.release_shop_order(p_order_id uuid,p_actor_id uuid)
returns public.shop_orders
language plpgsql security definer set search_path=public as $$
declare o public.shop_orders; w public.wallets; settlement public.shop_settlements; hold public.shop_wallet_holds; net numeric; fee numeric;
begin
  select * into o from public.shop_orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status<>'delivered' then raise exception 'ORDER_NOT_DELIVERED'; end if;
  if o.payment_status<>'paid' then raise exception 'ORDER_NOT_PAID'; end if;
  if o.escrow_status='released' then return o; end if;
  fee:=round(o.total*o.fee_percent/100,2);
  net:=greatest(0,o.total-fee);
  select * into w from public.wallets where user_id=o.user_id for update;
  if not found then raise exception 'SHOP_OWNER_WALLET_NOT_FOUND'; end if;
  update public.wallets set pending_shop=greatest(0,pending_shop-net),available=available+net,updated_at=now() where user_id=o.user_id;
  insert into public.shop_settlements(shop_id,order_id,gross_amount,platform_fee,net_amount,status) values(o.shop_id,o.id,o.total,fee,net,'released') on conflict(order_id) do nothing returning * into settlement;
  insert into public.wallet_ledger(user_id,entry_type,amount,balance_after,reference_id,description) values(o.user_id,'shop_sale_release',net,(select available from public.wallets where user_id=o.user_id),o.id,'Shop order settlement after delivery');
  update public.shop_orders set platform_fee_amount=fee,seller_pending_amount=0,seller_released_amount=net,escrow_status='released',delivery_confirmed_at=coalesce(delivery_confirmed_at,now()),seller_released_at=now(),updated_at=now() where id=o.id returning * into o;
  update public.shop_wallet_holds set status='released',released_at=now() where order_id=o.id and status='held';
  insert into public.audit_events(actor_id,target_user_id,event_type,metadata) values(p_actor_id,o.user_id,'shop_order_released',jsonb_build_object('order_id',o.id,'gross',o.total,'fee',fee,'net',net));
  return o;
end; $$;
revoke all on function public.release_shop_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_shop_order(uuid,uuid) to service_role;
