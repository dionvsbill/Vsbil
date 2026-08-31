-- VSBIL SOCIAL MONETIZATION V1
-- Server-side ad-revenue accounting for eligible creator content.
-- This layer never pays users for ad clicks/views and does not alter YouTube campaign rewards.

create extension if not exists pgcrypto;

create table if not exists public.social_post_views(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  view_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique(post_id,user_id,view_date)
);
create index if not exists social_post_views_post_idx on public.social_post_views(post_id,view_date desc);

create table if not exists public.social_ad_revenue_periods(
  id uuid primary key default gen_random_uuid(),
  external_reference text not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  gross_revenue numeric(14,2) not null check(gross_revenue >= 0),
  creator_share_rate numeric(6,5) not null default 0.55 check(creator_share_rate >= 0 and creator_share_rate <= 1),
  creator_pool numeric(14,2) not null default 0,
  platform_revenue numeric(14,2) not null default 0,
  currency text not null default 'GHS' check(currency='GHS'),
  status text not null default 'pending' check(status in ('pending','allocated','void')),
  source text not null default 'ads',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  allocated_at timestamptz
);
create index if not exists social_ad_revenue_periods_status_idx on public.social_ad_revenue_periods(status,period_end desc);

create table if not exists public.social_creator_earnings(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period_id uuid not null references public.social_ad_revenue_periods(id) on delete restrict,
  amount numeric(14,2) not null check(amount >= 0),
  currency text not null default 'GHS' check(currency='GHS'),
  score numeric(18,6) not null default 0,
  status text not null default 'accrued' check(status in ('accrued','approved','paid','held','reversed')),
  created_at timestamptz not null default now(),
  unique(user_id,period_id)
);
create index if not exists social_creator_earnings_user_idx on public.social_creator_earnings(user_id,status,created_at desc);

alter table public.social_post_views enable row level security;
alter table public.social_ad_revenue_periods enable row level security;
alter table public.social_creator_earnings enable row level security;

create or replace function public.record_social_post_view(p_post uuid,p_user uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare inserted_count integer;
begin
  if not exists(select 1 from social_posts where id=p_post and moderation_status='approved') then return false; end if;
  insert into social_post_views(post_id,user_id,view_date) values(p_post,p_user,current_date)
  on conflict(post_id,user_id,view_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end; $$;

create or replace function public.allocate_social_ad_revenue(p_period uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  period social_ad_revenue_periods%rowtype;
  total_score numeric := 0;
  creator_count integer := 0;
begin
  select * into period from social_ad_revenue_periods where id=p_period for update;
  if not found then raise exception 'AD_REVENUE_PERIOD_NOT_FOUND'; end if;
  if period.status='allocated' then return jsonb_build_object('success',true,'already_allocated',true); end if;
  if period.status='void' then raise exception 'AD_REVENUE_PERIOD_VOID'; end if;

  update social_ad_revenue_periods
  set creator_pool=round(gross_revenue*creator_share_rate,2),
      platform_revenue=round(gross_revenue-(gross_revenue*creator_share_rate),2)
  where id=p_period
  returning * into period;

  with scores as (
    select p.user_id,
      sum((coalesce(l.likes,0)*1 + coalesce(c.comments,0)*2 + coalesce(v.views,0)*0.25)
          * greatest(0,least(coalesce(p.quality_score,0),100))/100.0) as score
    from social_posts p
    join users u on u.id=p.user_id
    left join lateral (select count(*)::numeric likes from social_post_likes x where x.post_id=p.id) l on true
    left join lateral (select count(*)::numeric comments from social_comments x where x.post_id=p.id and x.moderation_status='approved') c on true
    left join lateral (select count(*)::numeric views from social_post_views x where x.post_id=p.id and x.created_at between period.period_start and period.period_end) v on true
    where p.created_at between period.period_start and period.period_end
      and p.moderation_status='approved'
      and p.originality_status='approved'
      and coalesce(p.quality_score,0) >= 60
      and u.content_participant=true
      and u.status='active'
    group by p.user_id
  ) select coalesce(sum(score),0),count(*) into total_score,creator_count from scores;

  if total_score <= 0 then
    update social_ad_revenue_periods set status='allocated',allocated_at=now() where id=p_period;
    return jsonb_build_object('success',true,'creator_count',0,'creator_pool',period.creator_pool,'platform_revenue',period.platform_revenue);
  end if;

  with scores as (
    select p.user_id,
      sum((coalesce(l.likes,0)*1 + coalesce(c.comments,0)*2 + coalesce(v.views,0)*0.25)
          * greatest(0,least(coalesce(p.quality_score,0),100))/100.0) as score
    from social_posts p
    join users u on u.id=p.user_id
    left join lateral (select count(*)::numeric likes from social_post_likes x where x.post_id=p.id) l on true
    left join lateral (select count(*)::numeric comments from social_comments x where x.post_id=p.id and x.moderation_status='approved') c on true
    left join lateral (select count(*)::numeric views from social_post_views x where x.post_id=p.id and x.created_at between period.period_start and period.period_end) v on true
    where p.created_at between period.period_start and period.period_end
      and p.moderation_status='approved'
      and p.originality_status='approved'
      and coalesce(p.quality_score,0) >= 60
      and u.content_participant=true
      and u.status='active'
    group by p.user_id
  )
  insert into social_creator_earnings(user_id,period_id,amount,score,status)
  select user_id,p_period,round(period.creator_pool*(score/total_score),2),score,'accrued'
  from scores
  where score > 0
  on conflict(user_id,period_id) do nothing;

  update social_ad_revenue_periods set status='allocated',allocated_at=now() where id=p_period;
  return jsonb_build_object('success',true,'creator_count',creator_count,'creator_pool',period.creator_pool,'platform_revenue',period.platform_revenue);
end; $$;
