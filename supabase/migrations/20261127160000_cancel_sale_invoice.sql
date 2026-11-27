create or replace function public.register_sale_invoice(p_sale_id text, p_access_key text, p_invoice_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_time timestamptz := now();
  actor_name text;
  sale_data jsonb;
begin
  if auth.uid() is null or not public.has_app_permission('faturamento') then
    raise exception 'Seu perfil não tem permissão para registrar notas fiscais.'
      using errcode = '42501';
  end if;

  if p_access_key is null or p_access_key !~ '^[0-9]{44}$' then
    raise exception 'A chave de acesso da NF-e deve conter exatamente 44 dígitos numéricos.'
      using errcode = '22023';
  end if;

  if p_invoice_number is null or nullif(trim(p_invoice_number), '') is null then
    raise exception 'Informe o número da nota fiscal.'
      using errcode = '22023';
  end if;

  select data into sale_data
  from public.app_records
  where id = p_sale_id and collection_name = 'sales'
  for update;
  if not found then
    raise exception 'Venda não encontrada.'
      using errcode = 'P0002';
  end if;
  if nullif(sale_data ->> 'invoiceCancelledAt', '') is not null
    or (
      nullif(sale_data ->> 'invoiceValidatedAt', '') is not null
      and coalesce(sale_data ->> 'invoiceAccessKey', '') ~ '^[0-9]{44}$'
      and nullif(trim(sale_data ->> 'invoiceNumber'), '') is not null
    ) then
    raise exception 'Esta venda já possui uma NF validada ou cancelada.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(name, ''), email, 'Usuário')
  into actor_name
  from public.profiles
  where id = auth.uid();

  update public.app_records
  set data = data || jsonb_build_object(
    'invoiceAccessKey', p_access_key,
    'invoiceNumber', trim(p_invoice_number),
    'invoiceValidatedAt', event_time,
    'invoiceValidatedBy', auth.uid()::text,
    'invoiceValidatedByName', coalesce(actor_name, 'Usuário')
  ), updated_at = event_time
  where id = p_sale_id and collection_name = 'sales';
end;
$$;

create or replace function public.cancel_sale_invoice(p_sale_id text, p_access_key text, p_invoice_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_time timestamptz := now();
  actor_name text;
  sale_data jsonb;
begin
  if auth.uid() is null or not public.has_app_permission('faturamento') then
    raise exception 'Seu perfil não tem permissão para cancelar notas fiscais.'
      using errcode = '42501';
  end if;

  if p_access_key is null or p_access_key !~ '^[0-9]{44}$' then
    raise exception 'A chave de acesso da NF de cancelamento deve conter exatamente 44 dígitos numéricos.'
      using errcode = '22023';
  end if;

  if p_invoice_number is null or nullif(trim(p_invoice_number), '') is null then
    raise exception 'Informe o número da NF de cancelamento.'
      using errcode = '22023';
  end if;

  select data into sale_data
  from public.app_records
  where id = p_sale_id and collection_name = 'sales'
  for update;
  if not found then
    raise exception 'Venda não encontrada.'
      using errcode = 'P0002';
  end if;
  if nullif(sale_data ->> 'invoiceValidatedAt', '') is null
    or coalesce(sale_data ->> 'invoiceAccessKey', '') !~ '^[0-9]{44}$'
    or nullif(trim(sale_data ->> 'invoiceNumber'), '') is null then
    raise exception 'Somente uma NF validada pode ser cancelada.'
      using errcode = '22023';
  end if;
  if nullif(sale_data ->> 'invoiceCancelledAt', '') is not null then
    raise exception 'Esta NF já foi cancelada.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(name, ''), email, 'Usuário')
  into actor_name
  from public.profiles
  where id = auth.uid();

  update public.app_records
  set data = data || jsonb_build_object(
    'invoiceCancellationAccessKey', p_access_key,
    'invoiceCancellationNumber', trim(p_invoice_number),
    'invoiceCancelledAt', event_time,
    'invoiceCancelledBy', auth.uid()::text,
    'invoiceCancelledByName', coalesce(actor_name, 'Usuário')
  ), updated_at = event_time
  where id = p_sale_id and collection_name = 'sales';
end;
$$;

revoke all on function public.cancel_sale_invoice(text, text, text) from public, anon;
grant execute on function public.cancel_sale_invoice(text, text, text) to authenticated;
