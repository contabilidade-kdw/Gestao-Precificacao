import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const graphApiVersion = 'v27.0';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isChatAuthorized(profile: Record<string, unknown> | null) {
  return profile?.active === true
    && (profile.role === 'admin'
      || (Array.isArray(profile.permissions) && profile.permissions.includes('chat')));
}

function normalizedPhone(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

async function updateRecord(client: ReturnType<typeof createClient>, id: string, patch: Record<string, unknown>) {
  const { data: row, error: readError } = await client.from('app_records')
    .select('data').eq('id', id).eq('collection_name', 'chatMessages').maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error('A mensagem não foi encontrada para atualizar o status.');
  const { error } = await client.from('app_records')
    .update({ data: { ...row.data, ...patch }, updated_at: new Date().toISOString() })
    .eq('id', id).eq('collection_name', 'chatMessages');
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  const accessToken = authorization.replace(/^Bearer\s+/i, '');
  if (!accessToken) return jsonResponse({ error: 'Faça login para enviar mensagens.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Supabase Edge Function environment is incomplete.');
    return jsonResponse({ error: 'A integração do chat não está configurada.' }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let messageId = '';
  try {
    let bodyValue: unknown;
    try {
      bodyValue = await request.json();
    } catch {
      return jsonResponse({ error: 'O corpo da mensagem não contém JSON válido.' }, 400);
    }
    const body = asRecord(bodyValue);
    if (!body) return jsonResponse({ error: 'O corpo da mensagem deve ser um objeto JSON.' }, 400);
    const senderId = authData.user.id;
    const recipientId = String(body.recipientId || '');
    const text = String(body.text || '').trim();
    messageId = String(body.messageId || '');

    if (!recipientId || recipientId === senderId || !/^[0-9a-f-]{36}$/i.test(recipientId)) {
      return jsonResponse({ error: 'Selecione outro usuário como destinatário.' }, 400);
    }
    if (!text || text.length > 2000) {
      return jsonResponse({ error: 'A mensagem deve ter entre 1 e 2000 caracteres.' }, 400);
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) {
      return jsonResponse({ error: 'Identificador de mensagem inválido.' }, 400);
    }

    const { data: sender, error: senderError } = await admin.from('profiles')
      .select('*').eq('id', senderId).maybeSingle();
    if (senderError) throw senderError;
    if (!isChatAuthorized(sender)) return jsonResponse({ error: 'Seu perfil não tem acesso ao chat.' }, 403);

    const { data: recipient, error: recipientError } = await admin.from('profiles')
      .select('*').eq('id', recipientId).maybeSingle();
    if (recipientError) throw recipientError;
    if (!isChatAuthorized(recipient)) return jsonResponse({ error: 'O destinatário não está autorizado ao chat.' }, 403);

    const conversationId = [senderId, recipientId].sort().join('__');
    const phone = normalizedPhone(recipient.whatsapp_phone);
    const whatsappReady = recipient.whatsapp_opt_in === true && /^\d{8,15}$/.test(phone);
    const initialError = whatsappReady
      ? ''
      : 'O destinatário não autorizou o WhatsApp ou não informou um número válido.';
    const createdAt = new Date().toISOString();
    const { data: existing, error: existingError } = await admin.from('app_records')
      .select('id').eq('id', messageId).eq('collection_name', 'chatMessages').maybeSingle();
    if (existingError) throw existingError;
    if (existing) return jsonResponse({ error: 'Esta mensagem já foi enviada.' }, 409);

    const { error: saveError } = await admin.from('app_records').upsert([
      {
        id: messageId,
        collection_name: 'chatMessages',
        data: {
          conversationId,
          senderId,
          senderName: sender.name || sender.email || 'Usuário',
          recipientId,
          text,
          createdAt,
          whatsappStatus: whatsappReady ? 'pending' : 'unavailable',
          ...(whatsappReady ? {} : { whatsappError: initialError }),
        },
      },
      {
        id: conversationId,
        collection_name: 'chatConversations',
        data: {
          participants: [senderId, recipientId].sort(),
          lastMessage: text,
          lastMessageAt: createdAt,
          lastSenderId: senderId,
        },
      },
    ], { onConflict: 'id' });
    if (saveError) throw saveError;

    if (!whatsappReady) return jsonResponse({ whatsappStatus: 'unavailable', whatsappError: initialError });

    try {
      const token = Deno.env.get('META_WHATSAPP_TOKEN');
      const phoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID');
      if (!token || !phoneNumberId) throw new Error('Os segredos da WhatsApp Cloud API não estão configurados.');
      const response = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { body: text },
        }),
      });
      const result = asRecord(await response.json().catch(() => null)) || {};
      if (!response.ok) {
        const apiError = asRecord(result.error);
        throw new Error(String(apiError?.message || `A API do WhatsApp respondeu com HTTP ${response.status}.`));
      }
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const whatsappMessage = asRecord(messages[0]);
      const whatsappMessageId = typeof whatsappMessage?.id === 'string' ? whatsappMessage.id : '';
      await updateRecord(admin, messageId, {
        whatsappStatus: 'sent',
        whatsappMessageId,
        whatsappError: '',
      });
      return jsonResponse({ whatsappStatus: 'sent' });
    } catch (issue) {
      const whatsappError = String(issue instanceof Error ? issue.message : issue).slice(0, 300);
      console.error('WhatsApp delivery failed; internal chat message was saved.', issue);
      await updateRecord(admin, messageId, { whatsappStatus: 'failed', whatsappError });
      return jsonResponse({ whatsappStatus: 'failed', whatsappError });
    }
  } catch (issue) {
    console.error('Unable to persist Supabase chat message.', issue);
    return jsonResponse({ error: issue instanceof Error ? issue.message : 'Não foi possível salvar a mensagem.' }, 500);
  }
});
