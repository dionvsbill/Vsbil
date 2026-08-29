-- VSBIL support inbox: first-party, provider-independent support storage.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references public.users(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 5 and 254),
  category text not null check (category in ('general','account','payment','campaign','wallet','withdrawal','privacy','other','safety','campaign_report','impersonation','harassment','account_compromise','reward_dispute','security')),
  reference_value text,
  message text not null check (char_length(message) between 10 and 5000),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id, created_at desc);
alter table public.support_tickets enable row level security;
-- Browser clients never receive support-ticket rows. Server uses the Supabase service role.
revoke all on public.support_tickets from anon, authenticated;
comment on table public.support_tickets is 'VSBIL first-party support and safety report inbox; access is server-side only.';
