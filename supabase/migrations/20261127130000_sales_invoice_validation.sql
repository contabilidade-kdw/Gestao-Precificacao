create policy app_records_select_faturamento on public.app_records
for select to authenticated
using (
  collection_name = 'sales'
  and public.has_app_permission('faturamento')
);

create or replace function public.register_sale_invoice(p_sale_id text, p_access_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_time timestamptz := now();
  actor_name text;
begin
  if auth.uid() is null or not public.has_app_permission('faturamento') then
    raise exception 'Seu perfil não tem permissão para registrar notas fiscais.'
      using errcode = '42501';
  end if;

  if p_access_key is null or p_access_key !~ '^[0-9]{44}$' then
    raise exception 'A chave de acesso da NF-e deve conter exatamente 44 dígitos numéricos.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(name, ''), email, 'Usuário')
  into actor_name
  from public.profiles
  where id = auth.uid();

  update public.app_records
  set data = data || jsonb_build_object(
    'invoiceAccessKey', p_access_key,
    'invoiceValidatedAt', event_time,
    'invoiceValidatedBy', auth.uid()::text,
    'invoiceValidatedByName', coalesce(actor_name, 'Usuário')
  ), updated_at = event_time
  where id = p_sale_id and collection_name = 'sales';

  if not found then
    raise exception 'Venda não encontrada.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.register_sale_invoice(text, text) from public, anon;
grant execute on function public.register_sale_invoice(text, text) to authenticated;
