-- VSBIL Production Phase 4B: trusted backend privileges.
-- Apply in the production Supabase SQL Editor after production_phase4_creator_program.sql.
-- IMPORTANT: never grant these tables to anon/authenticated.

grant select, insert, update, delete on table public.creator_program_enrollments to service_role;
grant select, insert, update, delete on table public.wallets to service_role;
grant select, insert, update, delete on table public.wallet_ledger to service_role;

grant execute on function public.join_creator_program(uuid) to service_role;
grant execute on function public.leave_creator_program(uuid) to service_role;
grant execute on function public.activate_creator_program_after_account_activation(uuid) to service_role;
grant execute on function public.create_funded_activity(uuid,text,text,text,text,bigint,bigint,integer,timestamptz,timestamptz,boolean,integer) to service_role;

revoke all on table public.creator_program_enrollments from anon, authenticated;
revoke all on table public.wallets from anon, authenticated;
revoke all on table public.wallet_ledger from anon, authenticated;
revoke all on function public.join_creator_program(uuid) from public, anon, authenticated;
revoke all on function public.leave_creator_program(uuid) from public, anon, authenticated;
revoke all on function public.activate_creator_program_after_account_activation(uuid) from public, anon, authenticated;
revoke all on function public.create_funded_activity(uuid,text,text,text,text,bigint,bigint,integer,timestamptz,timestamptz,boolean,integer) from public, anon, authenticated;
