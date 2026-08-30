-- VSBIL COMMERCE EXTENSION V1
-- E-commerce storefronts, order tracking, discounts and WhatsApp bot linking.
-- Run after business_suite.sql and whatsapp.sql.

create extension if not exists pgcrypto;

alter table business_shops add column if not exists store_slug text;
alter table business_shops add column if not exists description text;
alter table business_shops add column if not exists logo_url text;
alter table business_shops add column if not exists is_published boolean not null default false;
alter table business_shops add column if not exists whatsapp_bot_id uuid references whatsapp_bots(id) on delete set null;
alter table business_shops add column if not exists whatsapp_auto_reply boolean not null default true;

update business_shops set store_slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(id::text,'-',''),1,8) where store_slug is null or trim(store_slug) = '';
create unique index if not exists business_shops_store_slug_uidx on business_shops(store_slug) where store_slug is not null;
create index if not exists business_shops_public_idx on business_shops(store_slug,is_published);

alter table inventory_products add column if not exists description text;
alter table inventory_products add column if not exists image_url text;
alter table inventory_products add column if not exists discount_percent numeric(5,2) not null default 0 check(discount_percent >= 0 and discount_percent <= 100);
alter table inventory_products add column if not exists is_published boolean not null default false;
alter table inventory_products add column if not exists updated_at timestamptz not null default now();
create index if not exists inventory_products_store_idx on inventory_products(shop_id,is_published,name);

create table if not exists shop_orders(id uuid primary key default gen_random_uuid(),shop_id uuid not null references business_shops(id) on delete cascade,user_id uuid not null references public.users(id) on delete cascade,order_number text not null unique,buyer_name text not null,buyer_phone text not null,buyer_email text,delivery_address text,delivery_note text,subtotal numeric(14,2) not null default 0 check(subtotal>=0),discount_amount numeric(14,2) not null default 0 check(discount_amount>=0),delivery_fee numeric(14,2) not null default 0 check(delivery_fee>=0),total numeric(14,2) not null default 0 check(total>=0),currency text not null default 'GHS',payment_method text not null default 'cash_on_delivery' check(payment_method in ('cash_on_delivery','mobile_money','card')),payment_status text not null default 'unpaid' check(payment_status in ('unpaid','pending','paid','failed','refunded')),status text not null default 'pending' check(status in ('pending','confirmed','processing','ready','shipped','delivered','cancelled','refunded')),payment_reference text,tracking_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists shop_order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references shop_orders(id) on delete cascade,product_id uuid not null references inventory_products(id) on delete restrict,product_name text not null,sku text not null,quantity integer not null check(quantity>0),unit_price numeric(14,2) not null check(unit_price>=0),discount_percent numeric(5,2) not null default 0,line_total numeric(14,2) not null check(line_total>=0),created_at timestamptz not null default now());
create table if not exists shop_order_events(id uuid primary key default gen_random_uuid(),order_id uuid not null references shop_orders(id) on delete cascade,status text not null,note text,created_at timestamptz not null default now());
create index if not exists shop_orders_shop_idx on shop_orders(shop_id,created_at desc); create index if not exists shop_orders_buyer_idx on shop_orders(order_number,buyer_phone); create index if not exists shop_order_items_order_idx on shop_order_items(order_id); create index if not exists shop_order_events_order_idx on shop_order_events(order_id,created_at desc);
alter table shop_orders enable row level security; alter table shop_order_items enable row level security; alter table shop_order_events enable row level security;
create or replace function public.shop_order_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists shop_orders_updated_at on shop_orders; create trigger shop_orders_updated_at before update on shop_orders for each row execute function public.shop_order_touch_updated_at();
comment on table shop_orders is 'VSBIL shop ecommerce orders. Customer data must only be returned after order-number plus buyer verification.';
comment on table shop_order_events is 'Customer-visible order status timeline.';
