create or replace function public.reject_quote(p_quote_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_data jsonb;
  actor_name text;
  event_time timestamptz := now();
begin
  if auth.uid() is null or not public.has_app_permission('orcamentos') then
    raise exception 'Seu perfil não pode recusar orçamentos.' using errcode = '42501';
  end if;

  select data into quote_data
  from public.app_records
  where id = p_quote_id and collection_name = 'quotes'
  for update;
  if not found or quote_data ->> 'status' is distinct from 'pending' then
    raise exception 'Somente orçamentos pendentes podem ser recusados.' using errcode = 'P0002';
  end if;

  select coalesce(name, email, 'Usuário') into actor_name
  from public.profiles
  where id = auth.uid();

  update public.app_records
  set data = quote_data || jsonb_build_object(
    'status', 'rejected',
    'rejectedAt', event_time,
    'rejectedBy', auth.uid()::text,
    'rejectedByName', coalesce(actor_name, 'Usuário')
  ),
  updated_at = event_time
  where id = p_quote_id and collection_name = 'quotes';
end;
$$;

create or replace function public.delete_rejected_quote(p_quote_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_data jsonb;
begin
  if auth.uid() is null or not public.has_app_permission('orcamentos') then
    raise exception 'Seu perfil não pode excluir orçamentos.' using errcode = '42501';
  end if;

  select data into quote_data
  from public.app_records
  where id = p_quote_id and collection_name = 'quotes'
  for update;
  if not found or quote_data ->> 'status' is distinct from 'rejected' then
    raise exception 'Somente orçamentos recusados podem ser excluídos.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.app_records
    where collection_name = 'sales' and data ->> 'quoteId' = p_quote_id
  ) then
    raise exception 'Um orçamento vinculado a uma venda não pode ser excluído.' using errcode = '23503';
  end if;

  delete from public.app_records
  where id = p_quote_id and collection_name = 'quotes';
end;
$$;

revoke all on function public.reject_quote(text) from public, anon;
grant execute on function public.reject_quote(text) to authenticated;
revoke all on function public.delete_rejected_quote(text) from public, anon;
grant execute on function public.delete_rejected_quote(text) to authenticated;
