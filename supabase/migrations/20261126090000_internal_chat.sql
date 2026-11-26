create or replace function public.send_chat_message(
  p_recipient_id uuid,
  p_message_id text,
  p_message_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  conversation_id text;
  message_text text := btrim(coalesce(p_message_text, ''));
  event_time timestamptz := now();
begin
  if sender_id is null or not public.has_app_permission('chat') then
    raise exception 'Seu perfil não tem acesso ao chat.' using errcode = '42501';
  end if;

  if p_recipient_id is null or p_recipient_id = sender_id then
    raise exception 'Selecione outro usuário como destinatário.' using errcode = '22023';
  end if;
  if p_message_id is null or p_message_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'Identificador de mensagem inválido.' using errcode = '22023';
  end if;
  if length(message_text) not between 1 and 2000 then
    raise exception 'A mensagem deve ter entre 1 e 2000 caracteres.' using errcode = '22023';
  end if;

  select coalesce(nullif(p.name, ''), nullif(p.email, ''), 'Usuário')
  into sender_name
  from public.profiles p
  where p.id = sender_id
    and p.active
    and (p.role = 'admin' or 'chat' = any(p.permissions));
  if not found then
    raise exception 'Seu perfil não tem acesso ao chat.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_recipient_id
      and p.active
      and (p.role = 'admin' or 'chat' = any(p.permissions))
  ) then
    raise exception 'O destinatário não está autorizado ao chat.' using errcode = '42501';
  end if;

  conversation_id := least(sender_id::text, p_recipient_id::text)
    || '__' || greatest(sender_id::text, p_recipient_id::text);

  insert into public.app_records as existing_record (id, collection_name, data, updated_at)
  values (
    conversation_id,
    'chatConversations',
    jsonb_build_object(
      'participants', jsonb_build_array(
        least(sender_id::text, p_recipient_id::text),
        greatest(sender_id::text, p_recipient_id::text)
      ),
      'lastMessage', message_text,
      'lastMessageAt', event_time,
      'lastSenderId', sender_id::text
    ),
    event_time
  )
  on conflict (id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at
    where existing_record.collection_name = 'chatConversations';
  if not found then
    raise exception 'Não foi possível atualizar a conversa.' using errcode = '42501';
  end if;

  insert into public.app_records (id, collection_name, data, updated_at)
  values (
    p_message_id,
    'chatMessages',
    jsonb_build_object(
      'conversationId', conversation_id,
      'senderId', sender_id::text,
      'senderName', sender_name,
      'recipientId', p_recipient_id::text,
      'text', message_text,
      'createdAt', event_time
    ),
    event_time
  )
  on conflict (id) do nothing;
  if not found then
    raise exception 'Identificador de mensagem já utilizado.' using errcode = '23505';
  end if;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text, text) to authenticated;
