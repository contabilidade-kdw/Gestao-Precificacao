import { createClient } from 'npm:@supabase/supabase-js@2';

const graphApiVersion = 'v27.0';

type JsonRecord = Record<string, unknown>;
type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  active: boolean;
  permissions: unknown;
  whatsapp_phone: string | null;
  whatsapp_opt_in: boolean;
};
type Conversation = { id: string; data: JsonRecord };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizedPhone(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function asProfile(value: unknown): Profile | null {
  const profile = asRecord(value);
  if (!profile || typeof profile.id !== 'string') return null;
  return {
    id: profile.id,
    name: typeof profile.name === 'string' ? profile.name : null,
    email: typeof profile.email === 'string' ? profile.email : null,
    role: typeof profile.role === 'string' ? profile.role : '',
    active: profile.active === true,
    permissions: profile.permissions,
    whatsapp_phone: typeof profile.whatsapp_phone === 'string' ? profile.whatsapp_phone : null,
    whatsapp_opt_in: profile.whatsapp_opt_in === true,
  };
}

function asConversation(value: unknown): Conversation | null {
  const row = asRecord(value);
  const data = asRecord(row?.data);
  if (!row || typeof row.id !== 'string' || !data) return null;
  return { id: row.id, data };
}

function isChatAuthorized(profile: Profile | null) {
  return profile?.active === true
    && (profile.role === 'admin'
      || (Array.isArray(profile.permissions) && profile.permissions.includes('chat')));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function validSignature(rawBody: Uint8Array, header: string, secret: string) {
  if (!header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
  return constantTimeEqual(`sha256=${bytesToHex(digest)}`, header.toLowerCase());
}

async function updateRecord(admin: ReturnType<typeof createClient>, id: string, collectionName: string, patch: Record<string, unknown>) {
  const { data: record, error: readError } = await admin.from('app_records')
    .select('data').eq('id', id).eq('collection_name', collectionName).maybeSingle();
  if (readError) throw readError;
  if (!record) return;
  const { error } = await admin.from('app_records')
    .update({ data: { ...record.data, ...patch }, updated_at: new Date().toISOString() })
    .eq('id', id).eq('collection_name', collectionName);
  if (error) throw error;
}

async function storeIncomingMessage(admin: ReturnType<typeof createClient>, message: JsonRecord) {
  const senderPhone = normalizedPhone(message.from);
  const externalMessageId = String(message.id || '');
  if (!senderPhone || !externalMessageId) return;

  const { data: matchingProfiles, error: profileError } = await admin.from('profiles')
    .select('*').eq('whatsapp_phone', senderPhone);
  if (profileError) throw profileError;
  const contact = asArray(matchingProfiles).map(asProfile).find(isChatAuthorized) || null;
  if (!contact) return;

  const { data: conversations, error: conversationError } = await admin.from('app_records')
    .select('id, data').eq('collection_name', 'chatConversations');
  if (conversationError) throw conversationError;
  const active = asArray(conversations).map(asConversation)
    .filter((row): row is Conversation => {
      const participants = row?.data.participants;
      return Array.isArray(participants) && participants.includes(contact.id) && participants.length === 2;
    })
    .sort((left, right) => new Date(String(right.data.lastMessageAt || 0)).getTime()
      - new Date(String(left.data.lastMessageAt || 0)).getTime());

  let target: { conversationId: string; internalProfile: Profile } | null = null;
  for (const row of active) {
    const participants = Array.isArray(row.data.participants)
      ? row.data.participants.filter((uid): uid is string => typeof uid === 'string')
      : [];
    const internalId = participants.find((uid) => uid !== contact.id);
    if (!internalId) continue;
    const { data: internalProfile, error } = await admin.from('profiles')
      .select('*').eq('id', internalId).maybeSingle();
    if (error) throw error;
    const profile = asProfile(internalProfile);
    if (isChatAuthorized(profile) && profile) {
      target = { conversationId: row.id, internalProfile: profile };
      break;
    }
  }
  if (!target) return;

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(externalMessageId)));
  const messageId = `wa-${bytesToHex(digest)}`;
  const { data: existing, error: existingError } = await admin.from('app_records')
    .select('id').eq('id', messageId).eq('collection_name', 'chatMessages').maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const textData = asRecord(message.text);
  const text = message.type === 'text'
    ? String(textData?.body || '')
    : '[Mensagem recebida pelo WhatsApp]';
  const createdAt = new Date().toISOString();
  const name = contact.name || 'Usuário';
  const { error: saveError } = await admin.from('app_records').upsert([
    {
      id: messageId,
      collection_name: 'chatMessages',
      data: {
        conversationId: target.conversationId,
        senderId: contact.id,
        senderName: name,
        recipientId: target.internalProfile.id,
        text,
        source: 'whatsapp',
        externalMessageId,
        whatsappStatus: 'received',
        createdAt,
      },
    },
    {
      id: target.conversationId,
      collection_name: 'chatConversations',
      data: {
        participants: [contact.id, target.internalProfile.id].sort(),
        lastMessage: text,
        lastMessageAt: createdAt,
        lastSenderId: contact.id,
      },
    },
    {
      id: crypto.randomUUID(),
      collection_name: 'auditLogs',
      data: {
        actorId: contact.id,
        actorName: `${name} (WhatsApp)`,
        action: 'receive',
        entity: 'chat',
        entityId: target.conversationId,
        summary: `Recebeu uma mensagem pelo WhatsApp de ${name}.`,
        sourceScreen: 'chat',
        createdAt,
      },
    },
  ], { onConflict: 'id' });
  if (saveError) throw saveError;
}

async function updateMessageStatus(admin: ReturnType<typeof createClient>, status: JsonRecord) {
  if (!status.id) return;
  const { data: rows, error } = await admin.from('app_records')
    .select('id, data').eq('collection_name', 'chatMessages')
    .filter('data->>whatsappMessageId', 'eq', String(status.id)).limit(1);
  if (error) throw error;
  const message = rows?.[0];
  if (!message) return;
  const patch: Record<string, unknown> = { whatsappStatus: status.status };
  const firstError = asArray(status.errors).map(asRecord).find((item) => item?.message);
  if (firstError?.message) patch.whatsappError = String(firstError.message).slice(0, 300);
  else patch.whatsappError = '';
  await updateRecord(admin, message.id, 'chatMessages', patch);
}

Deno.serve(async (request) => {
  const verifyToken = Deno.env.get('META_VERIFY_TOKEN');
  if (!verifyToken) {
    console.error('META_VERIFY_TOKEN is not configured.');
    return new Response('Webhook não configurado.', { status: 500 });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const valid = url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === verifyToken;
    return valid
      ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 })
      : new Response('Verificação inválida.', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('Método não permitido.', { status: 405 });

  const appSecret = Deno.env.get('META_APP_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!appSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('Webhook environment is incomplete.');
    return new Response('Webhook não configurado.', { status: 500 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get('x-hub-signature-256') || '';
  if (!await validSignature(rawBody, signature, appSecret)) {
    return new Response('Assinatura inválida.', { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const event = asRecord(JSON.parse(new TextDecoder().decode(rawBody)));
    if (!event) throw new Error('Webhook payload must be a JSON object.');
    for (const entryValue of asArray(event.entry)) {
      const entry = asRecord(entryValue);
      if (!entry) continue;
      for (const changeValue of asArray(entry.changes)) {
        const change = asRecord(changeValue);
        const value = asRecord(change?.value);
        if (!value) continue;
        for (const message of asArray(value.messages)) {
          const record = asRecord(message);
          if (record) await storeIncomingMessage(admin, record);
        }
        for (const status of asArray(value.statuses)) {
          const record = asRecord(status);
          if (record) await updateMessageStatus(admin, record);
        }
      }
    }
    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (issue) {
    console.error('WhatsApp webhook processing failed.', issue);
    return new Response('Falha ao processar o webhook.', { status: 500 });
  }
});
