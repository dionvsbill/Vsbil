-- VSBIL COMMERCE ATOMIC ORDER ENGINE V1
-- Run after database/commerce_v1.sql.
create or replace function public.create_shop_order(p_shop_id uuid,p_buyer_name text,p_buyer_phone text,p_buyer_email text,p_delivery_address text,p_delivery_note text,p_payment_method text,p_delivery_fee numeric,p_items jsonb) returns table(order_id uuid,order_number text,subtotal numeric,discount_amount numeric,delivery_fee numeric,total numeric) language plpgsql security definer set search_path=public as $$
declare
  s business_shops%rowtype; item jsonb; p inventory_products%rowtype; qty integer; sale numeric; line numeric; sub numeric:=0; disc numeric:=0; oid uuid:=gen_random_uuid(); num text; fee numeric:=greatest(coalesce(p_delivery_fee,0),0);
begin
  select * into s from business_shops where id=p_shop_id and is_published=true for share;
  if not found then raise exception 'SHOP_NOT_AVAILABLE'; end if;
  if nullif(trim(p_buyer_name),'') is null or nullif(trim(p_buyer_phone),'') is null then raise exception 'BUYER_DETAILS_REQUIRED'; end if;
  if p_payment_method not in ('cash_on_delivery','mobile_money','card') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'ORDER_ITEMS_REQUIRED'; end if;
  num := 'VSBIL-' || to_char(now(),'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  for item in select value from jsonb_array_elements(p_items) loop
    qty := greatest(0,(item->>'quantity')::integer);
    if qty < 1 then raise exception 'INVALID_QUANTITY'; end if;
    select * into p from inventory_products where id=(item->>'product_id')::uuid and shop_id=s.id and is_published=true for update;
    if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
    if p.quantity < qty then raise exception 'INSUFFICIENT_STOCK:%',p.name; end if;
    sale := round((p.selling_price * (1 - least(greatest(coalesce(p.discount_percent,0),0),100)/100))::numeric,2);
    line := round(sale*qty,2);
    sub := sub + line;
    disc := disc + round((p.selling_price-sale)*qty,2);
  end loop;
  insert into shop_orders(id,shop_id,user_id,order_number,buyer_name,buyer_phone,buyer_email,delivery_address,delivery_note,subtotal,discount_amount,delivery_fee,total,currency,payment_method,payment_status,status)
  values(oid,s.id,s.user_id,num,left(trim(p_buyer_name),160),left(trim(p_buyer_phone),40),nullif(left(trim(coalesce(p_buyer_email,'')),255),''),nullif(left(trim(coalesce(p_delivery_address,'')),1000),''),nullif(left(trim(coalesce(p_delivery_note,'')),1000),''),sub,disc,fee,sub+fee,'GHS',p_payment_method,'unpaid','pending');
  for item in select value from jsonb_array_elements(p_items) loop
    qty := (item->>'quantity')::integer;
    select * into p from inventory_products where id=(item->>'product_id')::uuid and shop_id=s.id for update;
    sale := round((p.selling_price * (1 - least(greatest(coalesce(p.discount_percent,0),0),100)/100))::numeric,2);
    line := round(sale*qty,2);
    insert into shop_order_items(order_id,product_id,product_name,sku,quantity,unit_price,discount_percent,line_total) values(oid,p.id,p.name,p.sku,qty,sale,coalesce(p.discount_percent,0),line);
    update inventory_products set quantity=quantity-qty,updated_at=now() where id=p.id;
  end loop;
  insert into shop_order_events(order_id,status,note) values(oid,'pending','Order received');
  return query select oid,num,sub,disc,fee,sub+fee;
end; $$;
revoke all on function public.create_shop_order(uuid,text,text,text,text,text,text,numeric,jsonb) from public;
grant execute on function public.create_shop_order(uuid,text,text,text,text,text,text,numeric,jsonb) to service_role;
