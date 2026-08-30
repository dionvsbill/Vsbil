-- VSBIL SOCIAL V2 PATCH / PROGRAM PARTICIPATION
alter table public.business_shops add column if not exists is_verified boolean not null default false;
alter table public.business_shops add column if not exists verification_badge text not null default 'none' check(verification_badge in ('none','verified','trusted'));
alter table public.shop_orders add column if not exists buyer_id uuid references public.users(id) on delete set null;
create index if not exists shop_orders_buyer_user_idx on public.shop_orders(buyer_id,created_at desc);

create table if not exists public.creator_program_enrollments(user_id uuid primary key references public.users(id) on delete cascade,accepted_terms_at timestamptz not null default now(),status text not null default 'active' check(status in ('active','paused','left')),originality_required boolean not null default true,quality_required boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.creator_earnings(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,post_id uuid references public.social_posts(id) on delete set null,amount numeric(14,2) not null check(amount>=0),reason text not null,eligibility_snapshot jsonb not null default '{}'::jsonb,status text not null default 'pending' check(status in ('pending','approved','rejected','paid')),created_at timestamptz not null default now());
create index if not exists creator_earnings_user_idx on public.creator_earnings(user_id,created_at desc);
alter table public.creator_program_enrollments enable row level security;alter table public.creator_earnings enable row level security;
