-- VSBIL Jumia importer / affiliate commerce extension
-- Run after database/commerce_v1.sql.

create extension if not exists pgcrypto;

alter table inventory_products add column if not exists image_urls text[] not null default '{}';
alter table inventory_products add column if not exists original_price numeric(14,2);
alter table inventory_products add column if not exists affiliate_link text;
alter table inventory_products add column if not exists source text;
alter table inventory_products add column if not exists source_url text;
alter table inventory_products add column if not exists source_product_id text;
alter table inventory_products add column if not exists source_currency text default 'GHS';
alter table inventory_products add column if not exists source_in_stock boolean;
alter table inventory_products add column if not exists last_synced_at timestamptz;

create index if not exists inventory_products_source_idx on inventory_products(source,source_product_id);
create unique index if not exists inventory_products_jumia_source_uidx on inventory_products(shop_id,source,source_product_id) where source='jumia' and source_product_id is not null;

alter table business_shops add column if not exists affiliate_link text;
alter table business_shops add column if not exists affiliate_provider text;

create table if not exists jumia_import_cache (
  product_id text primary key,
  source_url text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jumia_import_cache_fetched_idx on jumia_import_cache(fetched_at);

alter table jumia_import_cache enable row level security;
-- Service-role API access is used for cache reads/writes; no browser policy is granted.

comment on column inventory_products.image_urls is 'Remote image URLs supplied by the source. VSBIL does not re-host imported marketplace images.';
comment on column inventory_products.affiliate_link is 'Optional merchant/official affiliate destination URL shown when configured.';
comment on table jumia_import_cache is 'Short-lived server cache for compliant Jumia product metadata retrieval.';
