-- VSBIL SHOP CHECKOUT FINALIZATION V1
-- Run after commerce_atomic.sql, shop_expansion_v2.sql and shop_checkout_payments_v1.sql.
create or replace function public.finalize_shop_checkout(p_session_id uuid,p_provider_transaction_id text)
returns public.shop_orders
language plpgsql security definer set search_path=public as $$
declare
  s public.shop_checkout_sessions;
  created_row record;
  result_row public.shop_orders;
  fee numeric;
  net numeric;
  owner_id uuid;
begin
  select * into s from public.shop_checkout_sessions where id=p_session_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  if s.status='paid' then
    select * into result_row from public.shop_orders where payment_reference=s.reference limit 1;
    return result_row;
  end if;
  if s.status<>'pending' then raise exception 'CHECKOUT_NOT_PENDING'; end if;
  select user_id into owner_id from public.business_shops where id=s.shop_id;
  if owner_id is null then raise exception 'SHOP_NOT_FOUND'; end if;

  select * into created_row from public.create_shop_order(
    s.shop_id,s.buyer_name,s.buyer_phone,s.buyer_email,s.delivery_address,s.delivery_note,
    s.payment_method,(select delivery_fee from public.business_shops where id=s.shop_id),s.items
  );

  fee:=round(created_row.total*public.shop_fee_percent(owner_id)/100,2);
  net:=greatest(0,created_row.total-fee);

  update public.shop_orders
  set payment_status='paid',payment_reference=s.reference,escrow_status='held',
      platform_fee_amount=fee,seller_pending_amount=net,fee_percent=public.shop_fee_percent(owner_id),updated_at=now()
  where id=created_row.order_id
  returning * into result_row;

  update public.wallets set pending_shop=coalesce(pending_shop,0)+net,updated_at=now() where user_id=owner_id;
  update public.shop_checkout_sessions set status='paid',provider_transaction_id=p_provider_transaction_id,paid_at=now() where id=s.id;

  insert into public.shop_wallet_holds(shop_id,order_id,gross_amount,fee_amount,net_amount,status)
  values(result_row.shop_id,result_row.id,result_row.total,fee,net,'held')
  on conflict(order_id) do nothing;
  return result_row;
end; $$;
revoke all on function public.finalize_shop_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_shop_checkout(uuid,text) to service_role;
