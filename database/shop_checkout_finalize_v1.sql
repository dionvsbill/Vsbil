-- VSBIL SHOP CHECKOUT FINALIZATION V1
-- Run after commerce_atomic.sql and shop_checkout_payments_v1.sql.
create or replace function public.finalize_shop_checkout(p_session_id uuid,p_provider_transaction_id text)
returns public.shop_orders
language plpgsql security definer set search_path=public as $$
declare s public.shop_checkout_sessions; created public.shop_orders; result_row public.shop_orders; order_row record;
begin
  select * into s from public.shop_checkout_sessions where id=p_session_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  if s.status='paid' then select * into result_row from public.shop_orders where payment_reference=s.reference limit 1; return result_row; end if;
  if s.status<>'pending' then raise exception 'CHECKOUT_NOT_PENDING'; end if;
  select * into order_row from public.create_shop_order(s.shop_id,s.buyer_name,s.buyer_phone,s.buyer_email,s.delivery_address,s.delivery_note,s.payment_method,(select delivery_fee from public.business_shops where id=s.shop_id),s.items);
  update public.shop_orders set payment_status='paid',payment_reference=s.reference,escrow_status='held',seller_pending_amount=gross.total,pending_shop=gross.total where id=order_row.order_id returning * into result_row;
  update public.shop_checkout_sessions set status='paid',provider_transaction_id=p_provider_transaction_id,paid_at=now() where id=s.id;
  insert into public.shop_wallet_holds(shop_id,order_id,gross_amount,fee_amount,net_amount,status)
  values(result_row.shop_id,result_row.id,result_row.total,round(result_row.total*result_row.fee_percent/100,2),greatest(0,result_row.total-round(result_row.total*result_row.fee_percent/100,2)),'held')
  on conflict(order_id) do nothing;
  return result_row;
exception when undefined_column then
  -- Compatibility fallback for databases where the wallet pending column has not yet been applied.
  raise exception 'SHOP_CHECKOUT_SCHEMA_MISSING';
end; $$;
revoke all on function public.finalize_shop_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_shop_checkout(uuid,text) to service_role;
