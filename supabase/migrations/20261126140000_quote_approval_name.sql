create or replace function public.approve_quote(p_quote_id text)
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
    raise exception 'Seu perfil não pode aprovar orçamentos.' using errcode = '42501';
  end if;

  select coalesce(nullif(name, ''), email, 'Usuário')
  into actor_name
  from public.profiles
  where id = auth.uid();

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
    'approvedBy', auth.uid()::text,
    'approvedByName', coalesce(actor_name, 'Usuário')
  ),
  updated_at = event_time
  where id = p_quote_id and collection_name = 'quotes';
end;
$$;

revoke all on function public.approve_quote(text) from public, anon;
grant execute on function public.approve_quote(text) to authenticated;

update public.app_records as quote_record
set data = quote_record.data || jsonb_build_object(
  'approvedByName',
  coalesce(nullif(approver.name, ''), approver.email, 'Usuário')
)
from public.profiles as approver
where quote_record.collection_name = 'quotes'
  and quote_record.data ->> 'approvedBy' = approver.id::text
  and nullif(quote_record.data ->> 'approvedByName', '') is null;
