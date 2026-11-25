create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'pending' check (role in ('pending', 'admin', 'analyst', 'custom')),
  permissions text[] not null default '{}',
  active boolean not null default false,
  whatsapp_phone text not null default '',
  whatsapp_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.app_records (
  id text primary key,
  collection_name text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_records_collection_idx on public.app_records (collection_name);
create index if not exists app_records_data_gin_idx on public.app_records using gin (data);
create index if not exists profiles_phone_idx on public.profiles (whatsapp_phone);

alter table public.profiles enable row level security;
alter table public.app_records enable row level security;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active and role = 'admin'
  );
$$;

create or replace function public.has_app_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and active
      and (role = 'admin' or required_permission = any(permissions))
  );
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.id and not public.is_active_admin()
    and (new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.role is distinct from old.role
      or new.permissions is distinct from old.permissions
      or new.active is distinct from old.active
      or new.created_at is distinct from old.created_at) then
    raise exception 'Usuários só podem alterar o próprio telefone e consentimento do WhatsApp.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
before update on public.profiles
for each row execute function public.guard_profile_update();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role, permissions, active, whatsapp_phone, whatsapp_opt_in)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, ''),
    'pending',
    '{}',
    false,
    coalesce(new.raw_user_meta_data ->> 'whatsapp_phone', ''),
    coalesce((new.raw_user_meta_data ->> 'whatsapp_opt_in')::boolean, false)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.write_app_records(writes jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  item_id text;
  item_collection text;
  item_data jsonb;
begin
  if auth.uid() is null or jsonb_typeof(writes) is distinct from 'array' then
    raise exception 'Lote inválido ou não autorizado.' using errcode = '42501';
  end if;
  if jsonb_array_length(writes) > 500 then
    raise exception 'Lote excede o limite permitido.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(writes)
  loop
    item_id := item ->> 'id';
    item_collection := item ->> 'collection_name';
    item_data := item -> 'data';
    if item_id is null or length(item_id) > 128
      or item_collection is null
      or item_collection not in ('products', 'expenses', 'quotes', 'sales',
        'stockMovements', 'dreReports', 'dreSettings', 'auditLogs',
        'chatConversations', 'chatMessages')
      or item_data is null
      or jsonb_typeof(item_data) is distinct from 'object' then
      raise exception 'Registro inválido no lote.' using errcode = '22023';
    end if;

    insert into public.app_records (id, collection_name, data)
    values (item_id, item_collection, item_data)
    on conflict (id) do update
      set collection_name = excluded.collection_name,
          data = excluded.data,
          updated_at = now()
      where public.app_records.collection_name = excluded.collection_name;

    if not found then
      raise exception 'O registro não foi gravado.' using errcode = '42501';
    end if;
  end loop;
end;
$$;

create or replace function public.update_app_record(target_collection text, target_id text, record_patch jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or jsonb_typeof(record_patch) is distinct from 'object' then
    raise exception 'Atualização inválida ou não autorizada.' using errcode = '42501';
  end if;
  update public.app_records
  set data = data || record_patch, updated_at = now()
  where id = target_id and collection_name = target_collection;
  if not found then
    raise exception 'Registro não encontrado ou alteração não autorizada.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.adjust_product_stock(
  product_id text,
  quantity_delta integer,
  movement_type text,
  movement_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_data jsonb;
  new_stock integer;
  actor_name text;
  event_time timestamptz := now();
begin
  if auth.uid() is null or not (
    public.has_app_permission('estoque') or public.has_app_permission('produtos')
  ) then
    raise exception 'Seu perfil não pode movimentar estoque.' using errcode = '42501';
  end if;
  if product_id is null or quantity_delta is null or quantity_delta = 0
    or (movement_type = 'in' and quantity_delta < 0)
    or (movement_type = 'out' and quantity_delta > 0)
    or movement_type not in ('in', 'out') then
    raise exception 'Movimentação inválida.' using errcode = '22023';
  end if;

  select data into product_data
  from public.app_records
  where id = product_id and collection_name = 'products'
  for update;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;

  new_stock := coalesce((product_data ->> 'stock')::integer, 0) + quantity_delta;
  if new_stock < 0 then raise exception 'Estoque insuficiente.' using errcode = '23514'; end if;
  select coalesce(name, email, 'Usuário') into actor_name from public.profiles where id = auth.uid();

  update public.app_records
  set data = jsonb_set(product_data, '{stock}', to_jsonb(new_stock), true), updated_at = event_time
  where id = product_id and collection_name = 'products';

  insert into public.app_records (id, collection_name, data)
  values (
    gen_random_uuid()::text,
    'stockMovements',
    jsonb_build_object(
      'productId', product_id,
      'productName', product_data ->> 'name',
      'type', movement_type,
      'quantity', abs(quantity_delta),
      'reason', movement_reason,
      'createdAt', event_time,
      'createdBy', auth.uid()::text,
      'createdByName', coalesce(actor_name, 'Usuário')
    )
  );
end;
$$;

create or replace function public.import_stock_batch(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  product_data jsonb;
  product_id text;
  item_quantity integer;
  actor_name text;
  event_time timestamptz := now();
begin
  if auth.uid() is null or not public.has_app_permission('estoque')
    or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Lote de importação inválido ou não autorizado.' using errcode = '42501';
  end if;
  if jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 200 then
    raise exception 'Lote de importação inválido ou excede o limite.' using errcode = '22023';
  end if;
  select coalesce(name, email, 'Usuário') into actor_name from public.profiles where id = auth.uid();

  for item in
    select value from jsonb_array_elements(p_changes)
    order by value ->> 'productId'
  loop
    product_id := item ->> 'productId';
    if item ->> 'quantity' is null
      or (item ->> 'quantity')::numeric % 1 <> 0 then
      raise exception 'A quantidade da importação deve ser um número inteiro.' using errcode = '22023';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if product_id is null or item_quantity is null or item_quantity <= 0
      or coalesce(item ->> 'movementId', '') = ''
      or length(item ->> 'movementId') > 128 then
      raise exception 'Quantidade ou identificador inválido na importação.' using errcode = '22023';
    end if;
    select data into product_data
    from public.app_records
    where id = product_id and collection_name = 'products'
    for update;
    if not found then raise exception 'Produto não encontrado: %', product_id using errcode = 'P0002'; end if;
    if coalesce((product_data ->> 'stock')::integer, 0) > 2147483647 - item_quantity then
      raise exception 'Saldo não permite a importação do produto %.', product_data ->> 'name' using errcode = '22003';
    end if;

    update public.app_records
    set data = jsonb_set(product_data, '{stock}', to_jsonb(coalesce((product_data ->> 'stock')::integer, 0) + item_quantity), true),
        updated_at = event_time
    where id = product_id and collection_name = 'products';

    insert into public.app_records (id, collection_name, data)
    values (
      item ->> 'movementId',
      'stockMovements',
      jsonb_build_object(
        'productId', product_id,
        'productName', product_data ->> 'name',
        'type', 'in',
        'quantity', item_quantity,
        'reason', item ->> 'reason',
        'createdAt', event_time,
        'createdBy', auth.uid()::text,
        'createdByName', coalesce(actor_name, 'Usuário')
      )
    );
  end loop;
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
  if not found or quote_data ->> 'status' is distinct from 'pending' then
    raise exception 'Este orçamento já foi concluído ou não existe.' using errcode = 'P0002';
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

create or replace function public.guard_app_record_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.collection_name is distinct from old.collection_name then
    raise exception 'Não é permitido mover registros entre coleções.' using errcode = '42501';
  end if;
  if old.collection_name = 'chatMessages'
    and (not public.has_app_permission('chat')
      or old.data ->> 'recipientId' <> auth.uid()::text
      or (new.data - 'readAt') is distinct from (old.data - 'readAt')
      or not (new.data ? 'readAt')) then
    raise exception 'Só é permitido marcar como lida uma mensagem recebida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists app_records_guard_update on public.app_records;
create trigger app_records_guard_update
before update on public.app_records
for each row execute function public.guard_app_record_update();

create or replace function public.list_chat_contacts()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_app_permission('chat') then
    raise exception 'Seu perfil não tem acesso ao chat.' using errcode = '42501';
  end if;
  return query
    select p.id, coalesce(nullif(p.name, ''), p.email, 'Usuário')
    from public.profiles p
    where p.id <> auth.uid()
      and p.active
      and (p.role = 'admin' or 'chat' = any(p.permissions))
    order by p.name, p.email;
end;
$$;

create or replace function public.list_profiles()
returns table (
  id uuid,
  name text,
  email text,
  role text,
  permissions text[],
  active boolean,
  whatsapp_phone text,
  whatsapp_opt_in boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_admin() and not public.has_app_permission('perfis') then
    raise exception 'Seu perfil não pode consultar os perfis.' using errcode = '42501';
  end if;
  return query select p.id, p.name, p.email, p.role, p.permissions, p.active,
    case when public.is_active_admin() then p.whatsapp_phone else '' end,
    case when public.is_active_admin() then p.whatsapp_opt_in else false end
    from public.profiles p order by p.name, p.email;
end;
$$;

create or replace function public.list_history_actors(actor_ids uuid[])
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_app_permission('historico') then
    raise exception 'Seu perfil não tem acesso ao histórico.' using errcode = '42501';
  end if;
  if coalesce(array_length(actor_ids, 1), 0) > 200 then
    raise exception 'A lista de usuários excede o limite.' using errcode = '22023';
  end if;
  return query select p.id, coalesce(nullif(p.name, ''), p.email, 'Usuário')
    from public.profiles p where p.id = any(coalesce(actor_ids, '{}'));
end;
$$;

revoke all on table public.profiles, public.app_records from anon, authenticated;
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.app_records to authenticated;
revoke all on function public.is_active_admin() from public, anon;
revoke all on function public.has_app_permission(text) from public, anon;
revoke all on function public.write_app_records(jsonb) from public, anon;
revoke all on function public.update_app_record(text, text, jsonb) from public, anon;
revoke all on function public.adjust_product_stock(text, integer, text, text) from public, anon;
revoke all on function public.import_stock_batch(jsonb) from public, anon;
revoke all on function public.finalize_quote(text, text) from public, anon;
revoke all on function public.list_chat_contacts() from public, anon;
revoke all on function public.list_profiles() from public, anon;
revoke all on function public.list_history_actors(uuid[]) from public, anon;
grant execute on function public.is_active_admin() to authenticated;
grant execute on function public.has_app_permission(text) to authenticated;
grant execute on function public.write_app_records(jsonb) to authenticated;
grant execute on function public.update_app_record(text, text, jsonb) to authenticated;
grant execute on function public.adjust_product_stock(text, integer, text, text) to authenticated;
grant execute on function public.import_stock_batch(jsonb) to authenticated;
grant execute on function public.finalize_quote(text, text) to authenticated;
grant execute on function public.list_chat_contacts() to authenticated;
grant execute on function public.list_profiles() to authenticated;
grant execute on function public.list_history_actors(uuid[]) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_active_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid() or public.is_active_admin())
with check (id = auth.uid() or public.is_active_admin());

drop policy if exists app_records_select on public.app_records;
create policy app_records_select on public.app_records
for select to authenticated
using (
  case collection_name
    when 'products' then public.has_app_permission('produtos') or public.has_app_permission('estoque')
      or public.has_app_permission('orcamentos') or public.has_app_permission('vendas') or public.has_app_permission('painel')
    when 'expenses' then public.has_app_permission('produtos') or public.has_app_permission('estoque')
      or public.has_app_permission('orcamentos') or public.has_app_permission('painel')
    when 'quotes' then public.has_app_permission('orcamentos') or public.has_app_permission('painel') or public.has_app_permission('historico')
    when 'sales' then public.has_app_permission('vendas') or public.has_app_permission('painel') or public.has_app_permission('historico')
    when 'stockMovements' then public.has_app_permission('estoque') or public.has_app_permission('painel') or public.has_app_permission('historico')
    when 'dreReports' then public.has_app_permission('produtos') or public.has_app_permission('despesas') or public.has_app_permission('painel')
    when 'dreSettings' then public.has_app_permission('produtos') or public.has_app_permission('despesas') or public.has_app_permission('painel')
    when 'auditLogs' then public.has_app_permission('historico')
    when 'chatConversations' then public.has_app_permission('chat') and (data -> 'participants') ? (auth.uid()::text)
    when 'chatMessages' then public.has_app_permission('chat')
      and (data ->> 'senderId' = auth.uid()::text or data ->> 'recipientId' = auth.uid()::text)
    else false
  end
);

drop policy if exists app_records_insert on public.app_records;
create policy app_records_insert on public.app_records
for insert to authenticated
with check (
  case collection_name
    when 'products' then public.has_app_permission('produtos')
    when 'expenses' then public.has_app_permission('produtos')
    when 'quotes' then public.has_app_permission('orcamentos')
      and data ->> 'createdBy' = auth.uid()::text
      and coalesce((data ->> 'quantity')::numeric, 0) > 0
      and (data ->> 'quantity')::numeric % 1 = 0
      and coalesce((data ->> 'unitCost')::numeric, -1) >= 0
      and coalesce((data ->> 'unitPrice')::numeric, -1) >= 0
      and abs(coalesce((data ->> 'total')::numeric, -1)
        - (data ->> 'quantity')::numeric * (data ->> 'unitPrice')::numeric) <= 0.01
    when 'stockMovements' then public.has_app_permission('produtos') or public.has_app_permission('estoque')
      or public.has_app_permission('vendas') or public.has_app_permission('orcamentos')
    when 'dreReports' then public.has_app_permission('despesas')
    when 'dreSettings' then public.has_app_permission('despesas')
    when 'auditLogs' then public.has_app_permission(data ->> 'sourceScreen') and data ->> 'actorId' = auth.uid()::text
    else false
  end
);

drop policy if exists app_records_update on public.app_records;
create policy app_records_update on public.app_records
for update to authenticated
using (
  public.is_active_admin()
  or (collection_name in ('products', 'expenses') and public.has_app_permission('produtos'))
  or (collection_name = 'dreReports' and public.has_app_permission('despesas'))
  or (collection_name = 'dreSettings' and public.has_app_permission('despesas'))
  or (collection_name = 'chatMessages' and public.has_app_permission('chat')
    and data ->> 'recipientId' = auth.uid()::text)
)
with check (
  public.is_active_admin()
  or (collection_name in ('products', 'expenses') and public.has_app_permission('produtos'))
  or (collection_name = 'dreReports' and public.has_app_permission('despesas'))
  or (collection_name = 'dreSettings' and public.has_app_permission('despesas'))
  or (collection_name = 'chatMessages' and public.has_app_permission('chat')
    and data ->> 'recipientId' = auth.uid()::text)
);

drop policy if exists app_records_delete on public.app_records;
create policy app_records_delete on public.app_records
for delete to authenticated
using (
  public.is_active_admin()
  or (collection_name = 'products' and public.has_app_permission('produtos')
    and coalesce((data ->> 'stock')::integer, 0) = 0)
  or (collection_name = 'expenses' and public.has_app_permission('produtos'))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dre-reports', 'dre-reports', false, 10485760,
  array['application/pdf', 'text/csv', 'text/plain', 'application/vnd.ms-excel'])
on conflict (id) do update
set public = false, file_size_limit = 10485760,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dre_reports_select on storage.objects;
create policy dre_reports_select on storage.objects
for select to authenticated
using (
  bucket_id = 'dre-reports'
  and (public.has_app_permission('despesas') or public.has_app_permission('produtos'))
);

drop policy if exists dre_reports_insert on storage.objects;
create policy dre_reports_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'dre-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_app_permission('despesas') or public.has_app_permission('produtos'))
);

drop policy if exists dre_reports_update on storage.objects;
create policy dre_reports_update on storage.objects
for update to authenticated
using (
  bucket_id = 'dre-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_app_permission('despesas') or public.has_app_permission('produtos'))
)
with check (
  bucket_id = 'dre-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_app_permission('despesas') or public.has_app_permission('produtos'))
);

drop policy if exists dre_reports_delete on storage.objects;
create policy dre_reports_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'dre-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_app_permission('despesas') or public.has_app_permission('produtos'))
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_records'
  ) then
    alter publication supabase_realtime add table public.app_records;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;
