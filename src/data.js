import { db, demoMode, supabase } from './supabase.js';

const storageKey = 'prisma-demo-data-v1';
const demoAdmin = { uid: 'demo-admin', email: 'admin@prisma.local' };
const demoColleague = { uid: 'demo-colleague', email: 'colega@prisma.local' };
const demoAnalyst = { uid: 'demo-darlan', email: 'darlan@prisma.local' };
const demoScreenPermissions = ['painel', 'produtos', 'estoque', 'orcamentos', 'vendas', 'despesas', 'historico', 'chat', 'perfis'];
const timestamp = () => new Date().toISOString();
const makeId = () => Math.random().toString(36).slice(2, 10);
const makeSeedData = () => {
  const now = timestamp();
  return {
    products: [
      { id: 'produto-cafe', name: 'Café especial 250g', sku: 'CAF-250', description: 'Café especial em embalagem de 250g.', purchaseCost: 18, laborCost: 2, packagingCost: 1.5, otherCost: 0.5, monthlyVolume: 100, rateioEnabled: true, stock: 18, margin: 35, createdAt: now },
      { id: 'produto-caneca', name: 'Caneca artesanal', sku: 'CNC-001', description: 'Caneca de cerâmica artesanal.', purchaseCost: 22, laborCost: 7, packagingCost: 3, otherCost: 0, monthlyVolume: 40, rateioEnabled: true, stock: 12, margin: 45, createdAt: now },
    ],
    expenses: [
      { id: 'despesa-energia', name: 'Energia elétrica', amount: 120, includedInAllocation: true, createdAt: now },
      { id: 'despesa-internet', name: 'Internet', amount: 90, includedInAllocation: false, createdAt: now },
    ],
    quotes: [
      { id: 'orcamento-pendente', customer: 'Mariana Costa', productId: 'produto-cafe', productName: 'Café especial 250g', quantity: 3, unitCost: 22.76, unitPrice: 30.72, margin: 35, total: 92.16, status: 'pending', createdBy: demoAdmin.uid, createdAt: now },
      { id: 'orcamento-efetivado', customer: 'Empório Central', productId: 'produto-caneca', productName: 'Caneca artesanal', quantity: 2, unitCost: 33.1, unitPrice: 48, margin: 45, total: 96, status: 'effective', createdBy: demoAdmin.uid, saleId: 'venda-demo', soldAt: now, createdAt: now },
    ],
    sales: [
      { id: 'venda-demo', quoteId: 'orcamento-efetivado', customer: 'Empório Central', productId: 'produto-caneca', productName: 'Caneca artesanal', quantity: 2, unitCost: 33.1, unitPrice: 48, total: 96, justification: '', createdBy: demoAdmin.uid, createdAt: now },
      { id: 'venda-abaixo-custo', customer: 'Loja do Bairro', productId: 'produto-cafe', productName: 'Café especial 250g', quantity: 2, unitCost: 22.76, unitPrice: 18, total: 36, justification: 'Desconto de lançamento aprovado pela gestão.', createdBy: demoAdmin.uid, createdAt: now },
    ],
    stockMovements: [
      { id: 'movimento-cafe-inicial', productId: 'produto-cafe', productName: 'Café especial 250g', type: 'in', quantity: 20, reason: 'Estoque inicial', createdAt: now, createdBy: demoAdmin.uid },
      { id: 'movimento-cafe-venda', productId: 'produto-cafe', productName: 'Café especial 250g', type: 'sale', quantity: 2, reason: 'Venda realizada', createdAt: now, createdBy: demoAdmin.uid },
      { id: 'movimento-caneca-inicial', productId: 'produto-caneca', productName: 'Caneca artesanal', type: 'in', quantity: 14, reason: 'Estoque inicial', createdAt: now, createdBy: demoAdmin.uid },
      { id: 'movimento-caneca-venda', productId: 'produto-caneca', productName: 'Caneca artesanal', type: 'sale', quantity: 2, reason: 'Venda realizada', createdAt: now, createdBy: demoAdmin.uid },
    ],
    profiles: [
      { id: demoAdmin.uid, name: 'Administrador demonstração', email: demoAdmin.email, role: 'admin', permissions: ['painel', 'produtos', 'estoque', 'orcamentos', 'vendas', 'despesas', 'historico', 'chat', 'perfis'], active: true, whatsappPhone: '', whatsappOptIn: false, createdAt: now },
      { id: demoColleague.uid, name: 'Colega demonstração', email: demoColleague.email, role: 'custom', permissions: ['historico', 'chat'], active: true, whatsappPhone: '', whatsappOptIn: false, createdAt: now },
      { id: demoAnalyst.uid, name: 'Darlan', email: demoAnalyst.email, role: 'analyst', permissions: demoScreenPermissions, active: true, whatsappPhone: '', whatsappOptIn: false, createdAt: now },
    ],
    dreReports: [],
    dreSettings: [{ id: 'active', reportId: '' }],
    auditLogs: [],
    chatConversations: [],
    chatMessages: [],
  };
};

function readData() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    const initialData = makeSeedData();
    localStorage.setItem(storageKey, JSON.stringify(initialData));
    return initialData;
  }
  try {
    const data = JSON.parse(saved);
    if (!Array.isArray(data.dreReports)) data.dreReports = [];
    if (!Array.isArray(data.dreSettings)) data.dreSettings = [{ id: 'active', reportId: '' }];
    if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
    if (!Array.isArray(data.chatConversations)) data.chatConversations = [];
    if (!Array.isArray(data.chatMessages)) data.chatMessages = [];
    if (!Array.isArray(data.profiles)) data.profiles = [];
    if (!data.profiles.some((profile) => profile.id === demoAnalyst.uid)) {
      data.profiles.push({
        id: demoAnalyst.uid,
        name: 'Darlan',
        email: demoAnalyst.email,
        role: 'analyst',
        permissions: demoScreenPermissions,
        active: true,
        whatsappPhone: '',
        whatsappOptIn: false,
        createdAt: timestamp(),
      });
      localStorage.setItem(storageKey, JSON.stringify(data));
    }
    for (const profile of data.profiles || []) {
      if (typeof profile.whatsappPhone !== 'string') profile.whatsappPhone = '';
      if (typeof profile.whatsappOptIn !== 'boolean') profile.whatsappOptIn = false;
    }
    return data;
  } catch (error) {
    throw new Error(`Os dados locais da demonstração estão inválidos: ${error.message}`);
  }
}

function notifyLocalSubscribers() {
  for (const subscriber of subscribers) subscriber.notify();
}

const subscribers = new Set();
function writeData(mutator) {
  const data = readData();
  mutator(data);
  localStorage.setItem(storageKey, JSON.stringify(data));
  notifyLocalSubscribers();
}

function snapshotDocument(item) {
  const data = { ...item };
  return { id: item.id, exists: () => true, data: () => data };
}

function localCollection(name) {
  return { local: true, type: 'collection', name };
}

function localDocument(name, id = makeId()) {
  return { local: true, type: 'document', name, id };
}

function requireLocalDocument(reference) {
  if (!reference?.local || reference.type !== 'document') throw new Error('Referência local de documento inválida.');
  return reference;
}

export function collection(database, name) {
  return localCollection(name);
}

export function where(fieldPath, operator, value) {
  return { local: true, type: 'constraint', fieldPath, operator, value };
}

export function query(reference, ...constraints) {
  return { ...reference, constraints };
}

export function doc(databaseOrCollection, pathOrId, id) {
  if (databaseOrCollection?.type === 'collection') return localDocument(databaseOrCollection.name, pathOrId);
  return localDocument(pathOrId, id);
}

export function serverTimestamp() {
  return timestamp();
}

export async function getDoc(reference) {
  const { name, id } = requireLocalDocument(reference);
  if (demoMode) {
    const item = readData()[name].find((record) => record.id === id);
    return item ? snapshotDocument(item) : { id, exists: () => false, data: () => undefined };
  }
  if (name === 'profiles') {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? snapshotDocument(profileFromRow(data)) : { id, exists: () => false, data: () => undefined };
  }
  const { data, error } = await supabase.from('app_records')
    .select('id, data').eq('collection_name', name).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? snapshotDocument({ id: data.id, ...data.data }) : { id, exists: () => false, data: () => undefined };
}

export async function addDoc(reference, value) {
  if (reference?.type !== 'collection') throw new Error('Referência local de coleção inválida.');
  const document = localDocument(reference.name);
  if (demoMode) {
    writeData((data) => data[reference.name].push({ ...value, id: document.id }));
    return document;
  }
  if (reference.name === 'profiles') throw new Error('Perfis são criados automaticamente pelo cadastro do Supabase Auth.');
  const { error } = await supabase.from('app_records').insert({
    id: document.id,
    collection_name: reference.name,
    data: withoutId(value),
  });
  if (error) throw error;
  return document;
}

export async function setDoc(reference, value) {
  const document = requireLocalDocument(reference);
  if (demoMode) {
    writeData((data) => {
      const records = data[document.name];
      const existingIndex = records.findIndex((item) => item.id === document.id);
      const next = { ...value, id: document.id };
      if (existingIndex < 0) records.push(next);
      else records[existingIndex] = next;
    });
    return;
  }
  if (document.name === 'profiles') throw new Error('Perfis são provisionados pelo gatilho do Supabase Auth.');
  const { error } = await supabase.from('app_records').upsert({
    id: document.id,
    collection_name: document.name,
    data: withoutId(value),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateDoc(reference, value) {
  const document = requireLocalDocument(reference);
  if (demoMode) {
    writeData((data) => {
      const records = data[document.name];
      const existingIndex = records.findIndex((item) => item.id === document.id);
      if (existingIndex < 0) throw new Error('O documento local não foi encontrado.');
      records[existingIndex] = { ...records[existingIndex], ...value };
    });
    return;
  }
  if (document.name === 'profiles') {
    const { error, data } = await supabase.from('profiles')
      .update(profileChangesToRow(value)).eq('id', document.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Perfil não encontrado ou alteração não autorizada.');
    return;
  }
  const { error } = await supabase.rpc('update_app_record', {
    target_collection: document.name,
    target_id: document.id,
    record_patch: withoutId(value),
  });
  if (error) throw error;
}

export async function deleteDoc(reference) {
  const document = requireLocalDocument(reference);
  if (demoMode) {
    writeData((data) => {
      data[document.name] = data[document.name].filter((item) => item.id !== document.id);
    });
    return;
  }
  const { error } = await supabase.from('app_records').delete()
    .eq('collection_name', document.name).eq('id', document.id);
  if (error) throw error;
}

export function onSnapshot(reference, next, error) {
  if (!demoMode) return subscribeSupabase(reference, next, error);
  const notify = () => {
    try {
      const documents = reference.type === 'collection'
        ? (readData()[reference.name] || []).filter((item) => (reference.constraints || []).every((constraint) => {
          const value = item[constraint.fieldPath];
          if (constraint.operator === 'array-contains') return Array.isArray(value) && value.includes(constraint.value);
          if (constraint.operator === '==') return value === constraint.value;
          throw new Error(`Operador local de consulta não suportado: ${constraint.operator}`);
        })).map(snapshotDocument)
        : [readData()[reference.name].find((item) => item.id === reference.id)].filter(Boolean).map(snapshotDocument);
      next({ docs: documents, empty: documents.length === 0, size: documents.length });
    } catch (issue) {
      if (error) error(issue);
      else throw issue;
    }
  };
  const subscriber = { reference, notify };
  subscribers.add(subscriber);
  notify();
  return () => subscribers.delete(subscriber);
}

export function writeBatch(database) {
  const writes = [];
  const batch = {
    set(reference, value) { writes.push({ type: 'set', reference, value }); return batch; },
    async commit() {
      if (demoMode) {
        writeData((data) => applyWrites(data, writes));
        return;
      }
      const payload = writes.map(({ reference, value }) => {
        const document = requireLocalDocument(reference);
        return {
          id: document.id,
          collection_name: document.name,
          data: withoutId(value),
        };
      });
      const { error } = await supabase.rpc('write_app_records', { writes: payload });
      if (error) throw error;
    },
  };
  return batch;
}

export async function runTransaction(database, callback) {
  if (!demoMode) throw new Error('Use uma operação transacional do Supabase para esta alteração.');
  const writes = [];
  const transaction = {
    async get(reference) { return getDoc(reference); },
    update(reference, value) { writes.push({ type: 'update', reference, value }); return transaction; },
    set(reference, value) { writes.push({ type: 'set', reference, value }); return transaction; },
  };
  const result = await callback(transaction);
  writeData((data) => applyWrites(data, writes));
  return result;
}

function withoutId(value) {
  const { id, ...data } = value || {};
  return data;
}

function profileFromRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    role: row.role || 'pending',
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    active: row.active === true,
    whatsappPhone: row.whatsapp_phone || '',
    whatsappOptIn: row.whatsapp_opt_in === true,
    createdAt: row.created_at,
  };
}

function profileChangesToRow(value) {
  const row = {};
  if ('name' in value) row.name = value.name;
  if ('email' in value) row.email = value.email;
  if ('role' in value) row.role = value.role;
  if ('permissions' in value) row.permissions = value.permissions;
  if ('active' in value) row.active = value.active;
  if ('whatsappPhone' in value) row.whatsapp_phone = value.whatsappPhone;
  if ('whatsappOptIn' in value) row.whatsapp_opt_in = value.whatsappOptIn;
  if ('createdAt' in value) row.created_at = value.createdAt;
  return row;
}

function createSupabaseSnapshot(records) {
  const docs = records.map((record) => snapshotDocument(record));
  return { docs, empty: docs.length === 0, size: docs.length };
}

function recordMatchesConstraints(record, constraints = []) {
  return constraints.every(({ fieldPath, operator, value }) => {
    const field = record[fieldPath];
    if (operator === 'array-contains') return Array.isArray(field) && field.includes(value);
    if (operator === '==') return field === value;
    throw new Error(`Operador de consulta não suportado: ${operator}`);
  });
}

async function loadSupabaseCollection(reference) {
  if (reference.name === 'profiles') {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    return (data || []).map(profileFromRow).filter((record) => recordMatchesConstraints(record, reference.constraints));
  }
  const { data, error } = await supabase.from('app_records')
    .select('id, data').eq('collection_name', reference.name);
  if (error) throw error;
  return (data || []).map((row) => ({ id: row.id, ...(row.data || {}) }))
    .filter((record) => recordMatchesConstraints(record, reference.constraints));
}

function subscribeSupabase(reference, next, error) {
  let closed = false;
  const notify = async () => {
    try {
      let records;
      if (reference.type === 'collection') records = await loadSupabaseCollection(reference);
      else {
        const document = await getDoc(reference);
        records = document.exists() ? [{ id: document.id, ...document.data() }] : [];
      }
      if (!closed) next(createSupabaseSnapshot(records));
    } catch (issue) {
      if (!closed) error?.(issue);
    }
  };

  void notify();
  const table = reference.name === 'profiles' ? 'profiles' : 'app_records';
  const channel = supabase.channel(`data:${table}:${reference.name}:${makeId()}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      ...(table === 'app_records' ? { filter: `collection_name=eq.${reference.name}` } : {}),
    }, () => { void notify(); })
    .subscribe((status, issue) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        error?.(issue || new Error(`Não foi possível manter a sincronização em tempo real (${status}).`));
      }
    });

  return () => {
    closed = true;
    void supabase.removeChannel(channel);
  };
}

export async function listProfiles() {
  if (demoMode) return readData().profiles;
  const { data, error } = await supabase.rpc('list_profiles');
  if (error) throw error;
  return (data || []).map(profileFromRow);
}

export async function listChatContacts() {
  if (demoMode) return [];
  const { data, error } = await supabase.rpc('list_chat_contacts');
  if (error) throw error;
  return (data || []).map((contact) => ({ id: contact.id, name: contact.name }));
}

export async function listHistoryActors(ids) {
  if (demoMode || !ids.length) return {};
  const names = {};
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await supabase.rpc('list_history_actors', {
      actor_ids: ids.slice(index, index + 200),
    });
    if (error) throw error;
    for (const person of data || []) names[person.id] = person.name;
  }
  return names;
}

export async function adjustProductStock({ productId, delta, type, reason, userId, actorName }) {
  if (demoMode) {
    return runTransaction(db, async (transaction) => {
      const productRef = doc(db, 'products', productId);
      const snapshot = await transaction.get(productRef);
      if (!snapshot.exists() || Number(snapshot.data().stock) + delta < 0) {
        throw new Error('Estoque insuficiente ou produto não encontrado.');
      }
      transaction.update(productRef, { stock: Number(snapshot.data().stock) + delta });
      transaction.set(doc(collection(db, 'stockMovements')), {
        productId,
        productName: snapshot.data().name,
        type,
        quantity: Math.abs(delta),
        reason,
        createdAt: serverTimestamp(),
        createdBy: userId,
        createdByName: actorName,
      });
    });
  }
  const { error } = await supabase.rpc('adjust_product_stock', {
    product_id: productId,
    quantity_delta: delta,
    movement_type: type,
    movement_reason: reason,
  });
  if (error) throw error;
}

export async function importStockBatch(groups, fileName, userId, actorName) {
  const changes = groups.map((group) => ({
    productId: group.product.id,
    quantity: group.quantity,
    movementId: doc(collection(db, 'stockMovements')).id,
    reason: `Importação · ${fileName.slice(0, 100)} (${group.lineCount} ${group.lineCount === 1 ? 'linha' : 'linhas'})`,
  }));
  if (demoMode) {
    return runTransaction(db, async (transaction) => {
      const currentProducts = [];
      for (const group of groups) {
        const reference = doc(db, 'products', group.product.id);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error(`O produto "${group.product.name}" não existe mais.`);
        const stock = snapshot.data().stock;
        if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(stock + group.quantity)) {
          throw new Error(`O saldo do produto "${group.product.name}" não permite esta importação.`);
        }
        currentProducts.push({ reference, stock });
      }
      groups.forEach((group, index) => {
        transaction.update(currentProducts[index].reference, { stock: currentProducts[index].stock + group.quantity });
        transaction.set(doc(db, 'stockMovements', changes[index].movementId), {
          productId: group.product.id,
          productName: group.product.name,
          type: 'in',
          quantity: group.quantity,
          reason: changes[index].reason,
          createdAt: serverTimestamp(),
          createdBy: userId,
          createdByName: actorName,
        });
      });
    });
  }
  const { error } = await supabase.rpc('import_stock_batch', { p_changes: changes });
  if (error) throw error;
}

export async function finalizeQuoteSale(quote, justification, userId, actorName) {
  if (demoMode) {
    return runTransaction(db, async (transaction) => {
      const quoteRef = doc(db, 'quotes', quote.id);
      const quoteSnapshot = await transaction.get(quoteRef);
      if (!quoteSnapshot.exists() || quoteSnapshot.data().status === 'effective') {
        throw new Error('Este orçamento já foi concluído ou não existe.');
      }
      const productRef = doc(db, 'products', quote.productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists() || Number(productSnapshot.data().stock) < Number(quote.quantity)) {
        throw new Error('Estoque insuficiente para concluir este orçamento.');
      }
      const saleRef = doc(collection(db, 'sales'));
      const movementRef = doc(collection(db, 'stockMovements'));
      const createdAt = serverTimestamp();
      transaction.update(productRef, { stock: Number(productSnapshot.data().stock) - Number(quote.quantity) });
      transaction.set(saleRef, {
        quoteId: quote.id, customer: quote.customer, productId: quote.productId,
        productName: quote.productName, quantity: Number(quote.quantity),
        unitCost: Number(quote.unitCost), unitPrice: Number(quote.unitPrice),
        total: Number(quote.total), justification: justification?.trim() || '',
        createdBy: userId, createdByName: actorName,
        createdAt,
      });
      transaction.set(movementRef, {
        productId: quote.productId, productName: quote.productName, type: 'sale',
        quantity: Number(quote.quantity), reason: 'Venda realizada', createdAt,
        createdBy: userId, createdByName: actorName,
      });
      transaction.update(quoteRef, { status: 'effective', soldAt: createdAt, saleId: saleRef.id });
    });
  }
  const { error } = await supabase.rpc('finalize_quote', {
    quote_id: quote.id,
    below_cost_justification: justification?.trim() || '',
  });
  if (error) throw error;
}

export async function sendChatMessage({ recipientId, text, messageId }) {
  const { error } = await supabase.rpc('send_chat_message', {
    p_recipient_id: recipientId,
    p_message_id: messageId,
    p_message_text: text,
  });
  if (error) throw error;
}

function applyWrites(data, writes) {
  for (const write of writes) {
    const document = requireLocalDocument(write.reference);
    const records = data[document.name];
    const index = records.findIndex((item) => item.id === document.id);
    if (write.type === 'update') {
      if (index < 0) throw new Error('O documento local não foi encontrado.');
      records[index] = { ...records[index], ...write.value };
    } else {
      const next = { ...write.value, id: document.id };
      if (index < 0) records.push(next);
      else records[index] = next;
    }
  }
}

export function getDemoAdmin() {
  const profile = readData().profiles.find((item) => item.id === demoAdmin.uid);
  if (!profile) throw new Error('O perfil local de demonstração não foi encontrado.');
  return { user: demoAdmin, profile };
}

export function authenticateDemo({ email, name, whatsappPhone, whatsappOptIn, signup }) {
  const normalizedEmail = email.trim().toLowerCase();
  const profiles = readData().profiles;
  let profile = profiles.find((item) => item.email.toLowerCase() === normalizedEmail);
  if (signup) {
    if (profile) {
      const error = new Error('Este e-mail já possui cadastro.');
      error.code = 'auth/email-already-in-use';
      throw error;
    }
    profile = {
      id: `demo-${makeId()}`,
      name: name.trim(),
      email: normalizedEmail,
      role: 'pending',
      permissions: [],
      active: false,
      whatsappPhone: String(whatsappPhone || '').replace(/\D/g, ''),
      whatsappOptIn: whatsappOptIn === true,
      createdAt: timestamp(),
    };
    writeData((data) => data.profiles.push(profile));
  } else if (!profile) {
    const error = new Error('E-mail ou senha inválidos.');
    error.code = 'auth/invalid-credential';
    throw error;
  }
  return { user: { uid: profile.id, email: profile.email }, profile };
}

export function resetDemoData() {
  localStorage.setItem(storageKey, JSON.stringify(makeSeedData()));
  notifyLocalSubscribers();
}
