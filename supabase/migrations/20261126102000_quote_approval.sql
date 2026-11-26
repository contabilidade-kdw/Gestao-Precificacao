create or replace function public.approve_quote(p_quote_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_data jsonb;
  event_time timestamptz := now();
begin
  if auth.uid() is null or not public.has_app_permission('orcamentos') then
    raise exception 'Seu perfil não pode aprovar orçamentos.' using errcode = '42501';
  end if;

  select data into quote_data
  from public.app_records
  where id = p_quote_id and collection_name = 'quotes'
  for update;
  if not found or quote_data ->> 'status' is distinct from 'pending' then
    raise exception 'Este orçamento não está pendente de aprovação.' using errcode = 'P0002';
  end if;
  if coalesce(nullif(quote_data ->> 'validUntil', '')::date, 'infinity'::date)
      < (event_time at time zone 'America/Sao_Paulo')::date then
    raise exception 'O orçamento venceu e não pode ser aprovado.' using errcode = '22023';
  end if;

  update public.app_records
  set data = quote_data || jsonb_build_object(
    'status', 'approved',
    'approvedAt', event_time,
    'approvedBy', auth.uid()::text
  ),
  updated_at = event_time
  where id = p_quote_id and collection_name = 'quotes';
end;
$$;

create or replace function public.finalize_quote(quote_id text, below_cost_justification text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_data jsonb;
  product_data jsonb;
  actor_name text;
  event_time timestamptz := now();
  sale_id text := gen_random_uuid()::text;
  movement_id text := gen_random_uuid()::text;
  quantity integer;
  unit_price numeric;
  unit_cost numeric;
begin
  if auth.uid() is null or not (
    public.has_app_permission('orcamentos') or public.has_app_permission('vendas')
  ) then
    raise exception 'Seu perfil não pode concluir orçamentos.' using errcode = '42501';
  end if;

  select data into quote_data
  from public.app_records
  where id = quote_id and collection_name = 'quotes'
  for update;
  if not found or quote_data ->> 'status' is distinct from 'approved' then
    raise exception 'Aprove o orçamento antes de registrar a venda.' using errcode = 'P0002';
  end if;
  if coalesce(nullif(quote_data ->> 'validUntil', '')::date, 'infinity'::date)
      < (event_time at time zone 'America/Sao_Paulo')::date then
    raise exception 'O orçamento venceu e não pode ser registrado como venda.' using errcode = '22023';
  end if;
  if (quote_data ->> 'quantity')::numeric % 1 <> 0 then
    raise exception 'A quantidade do orçamento deve ser um número inteiro.' using errcode = '22023';
  end if;
  quantity := (quote_data ->> 'quantity')::integer;
  unit_price := (quote_data ->> 'unitPrice')::numeric;
  unit_cost := (quote_data ->> 'unitCost')::numeric;
  if quantity is null or unit_price is null or unit_cost is null
    or quantity <= 0 or unit_price < 0 or unit_cost < 0 then
    raise exception 'Os valores do orçamento são inválidos.' using errcode = '22023';
  end if;
  if unit_price < unit_cost and length(trim(coalesce(below_cost_justification, ''))) < 10 then
    raise exception 'Justificativa obrigatória: informe pelo menos 10 caracteres.' using errcode = '22023';
  end if;

  select data into product_data
  from public.app_records
  where id = quote_data ->> 'productId' and collection_name = 'products'
  for update;
  if not found or coalesce((product_data ->> 'stock')::integer, 0) < quantity then
    raise exception 'Estoque insuficiente para concluir este orçamento.' using errcode = '23514';
  end if;
  select coalesce(name, email, 'Usuário') into actor_name from public.profiles where id = auth.uid();

  update public.app_records
  set data = jsonb_set(product_data, '{stock}', to_jsonb((product_data ->> 'stock')::integer - quantity), true),
      updated_at = event_time
  where id = quote_data ->> 'productId' and collection_name = 'products';

  insert into public.app_records (id, collection_name, data)
  values (
    sale_id,
    'sales',
    jsonb_build_object(
      'quoteId', quote_id,
      'customer', quote_data ->> 'customer',
      'productId', quote_data ->> 'productId',
      'productName', quote_data ->> 'productName',
      'quantity', quantity,
      'unitCost', unit_cost,
      'unitPrice', unit_price,
      'total', (quote_data ->> 'total')::numeric,
      'discountPercent', coalesce((quote_data ->> 'discountPercent')::numeric, 0),
      'discountAmount', coalesce((quote_data ->> 'discountAmount')::numeric, 0),
      'paymentMethod', coalesce(quote_data ->> 'paymentMethod', ''),
      'paymentTerms', coalesce(quote_data ->> 'paymentTerms', ''),
      'justification', trim(coalesce(below_cost_justification, '')),
      'createdBy', auth.uid()::text,
      'createdByName', coalesce(actor_name, 'Usuário'),
      'createdAt', event_time
    )
  );

  insert into public.app_records (id, collection_name, data)
  values (
    movement_id,
    'stockMovements',
    jsonb_build_object(
      'productId', quote_data ->> 'productId',
      'productName', quote_data ->> 'productName',
      'type', 'sale',
      'quantity', quantity,
      'reason', 'Venda realizada',
      'createdAt', event_time,
      'createdBy', auth.uid()::text,
      'createdByName', coalesce(actor_name, 'Usuário')
    )
  );

  update public.app_records
  set data = quote_data || jsonb_build_object(
    'status', 'effective',
    'soldAt', event_time,
    'saleId', sale_id
  ), updated_at = event_time
  where id = quote_id and collection_name = 'quotes';
end;
$$;

revoke all on function public.approve_quote(text) from public, anon;
grant execute on function public.approve_quote(text) to authenticated;
