import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, adjustProductStock, authenticateDemo, collection, deleteDoc, doc, finalizeQuoteSale, getDemoAdmin, getDoc,
  importStockBatch, listChatContacts, listHistoryActors, listProfiles, onSnapshot, query, resetDemoData,
  sendSupabaseChatMessage, where, writeBatch,
  serverTimestamp, setDoc, updateDoc,
} from './data.js';
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, BadgeDollarSign, Boxes,
  Check, CheckCheck, ChevronDown, CircleDollarSign, ClipboardList, Download, FileText,
  History, LayoutDashboard, LogOut, MessageCircle, Package, Pencil, Plus, Search, Send, ShieldCheck,
  ShoppingCart, Tag, Upload, Users, X,
} from 'lucide-react';
import { db, demoMode, supabase, supabaseConfigured } from './supabase.js';
import { parseErpStockFile, parseStockFile, planStockImport } from './stockImport.js';
import { parseDreFile } from './dreImport.js';
import { loadDreAttachment, removeDreAttachment, saveDreAttachment } from './dreAttachments.js';

const screens = [
  { id: 'painel', label: 'Painel de gestão', icon: LayoutDashboard },
  { id: 'produtos', label: 'Produtos e custos', icon: Package },
  { id: 'estoque', label: 'Controle de estoque', icon: Boxes },
  { id: 'orcamentos', label: 'Orçamentos', icon: FileText },
  { id: 'vendas', label: 'Vendas realizadas', icon: ShoppingCart },
  { id: 'despesas', label: 'Despesas e DRE', icon: CircleDollarSign },
  { id: 'historico', label: 'Histórico do sistema', icon: History },
  { id: 'chat', label: 'Chat da equipe', icon: MessageCircle },
  { id: 'perfis', label: 'Perfis e acessos', icon: Users },
];
const permissionScreens = screens;
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const dateLabel = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('pt-BR') : '—';
};
const uid = () => Math.random().toString(36).slice(2, 10);
const asNumber = (value) => Number.parseFloat(value) || 0;
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const userError = (error) => {
  const messages = {
    'auth/invalid-credential': 'E-mail ou senha inválidos.',
    'auth/email-already-in-use': 'Este e-mail já possui cadastro.',
    'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
    'weak_password': 'A senha deve ter pelo menos 6 caracteres.',
    'user_already_exists': 'Este e-mail já possui cadastro.',
    'email_exists': 'Este e-mail já possui cadastro.',
    'invalid_credentials': 'E-mail ou senha inválidos.',
    'permission-denied': 'Seu perfil não tem permissão para esta ação.',
    '42501': 'Seu perfil não tem permissão para esta ação.',
    '23514': 'A operação viola uma regra de estoque ou venda.',
  };
  return messages[error.code] || error.message || 'Não foi possível concluir a operação.';
};

function Field({ label, children, className = '' }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

function Modal({ title, onClose, children, className = '', closeDisabled = false }) {
  return <div className="modal-backdrop" onMouseDown={(event) => !closeDisabled && event.target === event.currentTarget && onClose()}>
    <section className={`modal ${className}`}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar" disabled={closeDisabled}><X size={19} /></button></header>{children}</section>
  </div>;
}

function AuthScreen({ onDemoLogin }) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const email = String(form.get('email')).trim();
      const whatsappPhone = normalizePhone(form.get('whatsappPhone'));
      const whatsappOptIn = form.get('whatsappOptIn') === 'on';
      if (demoMode) {
        await onDemoLogin({ email, name: String(form.get('name') || ''), whatsappPhone, whatsappOptIn, signup });
        return;
      }
      if (signup) {
        const { data, error: signupError } = await supabase.auth.signUp({
          email,
          password: String(form.get('password')),
          options: {
            data: {
              name: String(form.get('name')).trim(),
              whatsapp_phone: whatsappPhone,
              whatsapp_opt_in: whatsappOptIn,
            },
          },
        });
        if (signupError) throw signupError;
        if (!data.session) {
          setSignup(false);
          setNotice('Cadastro criado. Confirme o e-mail enviado para entrar; depois, um administrador ativará seu perfil.');
        }
      } else {
        const { error: signinError } = await supabase.auth.signInWithPassword({
          email,
          password: String(form.get('password')),
        });
        if (signinError) throw signinError;
      }
    } catch (issue) { setError(userError(issue)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-card">
    <div className="brand-mark"><Activity size={25} /></div><p className="eyebrow">GESTÃO INTELIGENTE</p>
    <h1>{signup ? 'Crie seu acesso' : 'Bem-vindo de volta'}</h1>
    <p className="muted">{signup ? 'Após o cadastro, confirme o e-mail se solicitado; um administrador libera seu perfil.' : 'Entre para acessar seu espaço de gestão.'}</p>
    {demoMode && <div className="quote-info demo-auth-note">Modo local: use admin@prisma.local para entrar como administrador ou darlan@prisma.local para acessar como analista. A senha é apenas demonstrativa.</div>}
    <form onSubmit={submit} className="form-stack">
      {signup && <><Field label="Nome completo"><input name="name" required autoComplete="name" /></Field><Field label="WhatsApp com DDI (opcional)"><input name="whatsappPhone" type="tel" placeholder="+55 11 99999-9999" autoComplete="tel" /></Field><label className="check-label"><input name="whatsappOptIn" type="checkbox" /> Aceito receber mensagens do chat pelo WhatsApp.</label></>}
      <Field label="E-mail"><input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Senha"><input name="password" type="password" required minLength="6" autoComplete={signup ? 'new-password' : 'current-password'} /></Field>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text" role="status">{notice}</p>}
      <button className="primary-button full-button" disabled={busy}>{busy ? 'Aguarde…' : signup ? 'Criar acesso' : 'Entrar'}</button>
    </form>
    <button className="text-button" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Já tenho uma conta · Entrar' : 'Primeiro acesso? Criar conta'}</button>
  </div><span className="auth-footer">Atrativa · Estoque, custos e precificação</span></main>;
}

function SetupNotice() {
  return <main className="setup-page"><div className="setup-card"><div className="brand-mark"><Activity size={25} /></div>
    <p className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</p><h1>Conecte seu projeto Supabase</h1>
    <p className="muted">Adicione a URL e a chave pública do projeto em um arquivo <code>.env</code> na raiz, usando <code>.env.example</code> como referência. Configure o banco, Authentication, Storage e as Edge Functions conforme o README.</p>
    <div className="setup-steps"><span>1</span><p>Copie a URL e a chave anon/public das configurações do Supabase.</p><span>2</span><p>Execute a migração SQL e configure as políticas RLS e o bucket privado.</p><span>3</span><p>Crie o primeiro administrador conforme o README.</p></div>
  </div></main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('painel');
  const [products, setProducts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dreReports, setDreReports] = useState([]);
  const [dreSettings, setDreSettings] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [sales, setSales] = useState([]);
  const [movements, setMovements] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (demoMode) {
      try {
        const demoSession = getDemoAdmin();
        setUser(demoSession.user);
        setProfile(demoSession.profile);
      } catch (issue) { setError(userError(issue)); }
      finally { setLoading(false); }
      return undefined;
    }
    if (!supabase) { setLoading(false); return undefined; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ? { ...session.user, uid: session.user.id } : null;
      setUser(currentUser);
      setProfile(null);
      if (!currentUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      queueMicrotask(async () => {
        try {
          const snapshot = await getDoc(doc(db, 'profiles', currentUser.uid));
          setProfile(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        } catch (issue) {
          setError(userError(issue));
        } finally {
          setLoading(false);
        }
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !profile?.active) return undefined;
    const refs = {
      products: collection(db, 'products'), expenses: collection(db, 'expenses'),
      quotes: collection(db, 'quotes'), sales: collection(db, 'sales'),
      stockMovements: collection(db, 'stockMovements'), profiles: collection(db, 'profiles'),
      dreReports: collection(db, 'dreReports'), dreSettings: collection(db, 'dreSettings'),
      auditLogs: collection(db, 'auditLogs'),
    };
    const watch = (ref, setter, enabled = true) => enabled ? onSnapshot(ref, (snapshot) => setter(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (issue) => setError(userError(issue))) : () => {};
    const canSee = (key) => profile.role === 'admin' || profile.permissions?.includes(key);
    const unsubscribers = [
      watch(refs.products, setProducts, ['produtos', 'estoque', 'orcamentos', 'vendas', 'painel'].some(canSee)),
      watch(refs.expenses, setExpenses, canSee('produtos') || canSee('estoque') || canSee('orcamentos') || canSee('painel')),
      watch(refs.quotes, setQuotes, canSee('orcamentos') || canSee('painel') || canSee('historico')),
      watch(refs.sales, setSales, canSee('vendas') || canSee('painel') || canSee('historico')),
      watch(refs.stockMovements, setMovements, canSee('estoque') || canSee('painel') || canSee('historico')),
      watch(refs.profiles, setProfiles, profile.role === 'admin'),
      watch(refs.dreReports, setDreReports, canSee('despesas') || canSee('produtos') || canSee('painel')),
      watch(refs.dreSettings, setDreSettings, canSee('despesas') || canSee('produtos') || canSee('painel')),
      watch(refs.auditLogs, setAuditLogs, canSee('historico')),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [user, profile]);

  useEffect(() => {
    if (!user || !profile?.active || profile.role === 'admin' || !profile.permissions?.includes('perfis') || demoMode) return undefined;
    let active = true;
    listProfiles()
      .then((result) => {
        if (active) setProfiles(result);
      })
      .catch((issue) => {
        if (active) setError(userError(issue));
      });
    return () => { active = false; };
  }, [user, profile, screen]);

  const allowed = useMemo(() => profile?.role === 'admin' ? screens.map((item) => item.id) : profile?.active ? profile.permissions || [] : [], [profile]);
  const visibleScreens = screens.filter((item) => allowed.includes(item.id));
  useEffect(() => {
    if (visibleScreens.length && !allowed.includes(screen)) setScreen(visibleScreens[0].id);
  }, [allowed, screen, visibleScreens]);

  async function logout() {
    if (demoMode) {
      setUser(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
  }
  async function demoLogin(credentials) {
    const session = authenticateDemo(credentials);
    setUser(session.user);
    setProfile(session.profile);
    setScreen('painel');
  }

  if (!supabaseConfigured && !demoMode) return <SetupNotice />;
  if (loading) return <div className="loading-screen"><div className="spinner" />Carregando seu espaço…</div>;
  if (!user) return <AuthScreen onDemoLogin={demoLogin} />;
  if (!profile?.active) return <main className="setup-page"><div className="setup-card"><div className="brand-mark"><ShieldCheck size={25} /></div><p className="eyebrow">ACESSO PENDENTE</p><h1>Olá, {profile?.name || user.email}</h1><p className="muted">{profile ? 'Seu cadastro foi recebido. Um administrador precisa ativar seu perfil e conceder as telas permitidas.' : 'Seu usuário não possui um perfil cadastrado. Peça ao administrador para verificar seu acesso.'}</p><button className="secondary-button" onClick={logout}><LogOut size={16} /> Sair</button></div></main>;

  const currentScreen = screens.find((item) => item.id === screen);
  async function run(action, onFailure, auditEvent) {
    setError('');
    try { await action(); } catch (issue) {
      const message = userError(issue);
      setError(message);
      onFailure?.(message);
      return false;
    }
    if (auditEvent) {
      try {
        await addDoc(collection(db, 'auditLogs'), {
          actorId: user.uid,
          actorName: profile.name || user.email,
          action: auditEvent.action,
          entity: auditEvent.entity,
          entityId: auditEvent.entityId || '',
          summary: auditEvent.summary,
          sourceScreen: auditEvent.sourceScreen,
          createdAt: serverTimestamp(),
        });
      } catch (issue) {
        setError(`A alteração foi concluída, mas não foi possível registrá-la no histórico: ${userError(issue)}`);
      }
    }
    return true;
  }
  const activeDreReportId = dreSettings.find((item) => item.id === 'active')?.reportId || '';
  const activeDreReport = dreReports.find((item) => item.id === activeDreReportId) || null;
  const sharedProps = { products, expenses, quotes, sales, movements, profiles, auditLogs, profile, user, onRun: run, dreReports, activeDreReport, activeDreReportId };
  return <div className="app-shell">
    <aside className="sidebar">
    
      <div className="nav-caption">MENU PRINCIPAL</div>
      <nav>{visibleScreens.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${screen === id ? 'selected' : ''}`} onClick={() => setScreen(id)}><Icon size={18} /><span>{label}</span>{id === 'orcamentos' && quotes.filter((quote) => quote.status !== 'effective').length > 0 && <span className="nav-count">{quotes.filter((quote) => quote.status !== 'effective').length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(profile.name || user.email || 'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{profile.name || user.email}</strong><small>{profile.role === 'admin' ? 'Administrador' : profile.role === 'analyst' ? 'Analista' : 'Usuário autorizado'}</small></div><button className="icon-button logout" title="Sair" onClick={logout}><LogOut size={17} /></button></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div><p className="breadcrumb">Atrativa <span>/</span> {currentScreen?.label}</p><h1>{currentScreen?.label}</h1></div><div className="topbar-meta"><span className="live-dot" />{demoMode ? 'Demonstração local' : 'Dados sincronizados'}<ChevronDown size={15} /></div></header>
      {demoMode && <div className="demo-banner"><span>Modo demonstração · os dados ficam salvos somente neste navegador.</span><button className="text-button" onClick={() => { if (window.confirm('Restaurar os dados de exemplo? Isso substituirá os dados locais atuais.')) resetDemoData(); }}>Restaurar dados de exemplo</button></div>}
      {error && <div className="alert-error"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar"><X size={16} /></button></div>}
      <div className="page-content">{screen === 'painel' && <Dashboard {...sharedProps} />}
        {screen === 'produtos' && <ProductsPage {...sharedProps} />}
        {screen === 'estoque' && <StockPage {...sharedProps} />}
        {screen === 'orcamentos' && <QuotesPage {...sharedProps} />}
        {screen === 'vendas' && <SalesPage {...sharedProps} />}
        {screen === 'despesas' && <DreExpensesPage {...sharedProps} />}
        {screen === 'historico' && <HistoryPage {...sharedProps} />}
        {screen === 'chat' && <ChatPage {...sharedProps} />}
        {screen === 'perfis' && <ProfilesPage {...sharedProps} />}
      </div>
    </main>
  </div>;
}

function Dashboard({ products, expenses, quotes, sales, activeDreReport }) {
  const [belowCostOnly, setBelowCostOnly] = useState(false);
  const belowCostSales = sales.filter((sale) => Number(sale.unitPrice) < Number(sale.unitCost));
  const filteredSales = (belowCostOnly ? belowCostSales : sales)
    .slice().sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  const stockValue = products.reduce((sum, product) => sum + (Number(product.stock) || 0) * productCost(product, products, expenses, activeDreReport), 0);
  const totalSold = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const effective = quotes.filter((quote) => quote.status === 'effective').length;
  const pending = quotes.filter((quote) => quote.status !== 'effective').length;
  const metrics = [
    { title: 'Valor em estoque', value: money(stockValue), hint: `${products.reduce((sum, item) => sum + (Number(item.stock) || 0), 0)} unidades disponíveis`, icon: Boxes, tone: 'blue' },
    { title: 'Vendas realizadas', value: money(totalSold), hint: `${sales.length} itens vendidos`, icon: CircleDollarSign, tone: 'green' },
    { title: 'Orçamentos efetivados', value: effective, hint: 'convertidos em venda', icon: Check, tone: 'violet' },
    { title: 'Orçamentos em aberto', value: pending, hint: 'aguardando conclusão', icon: ClipboardList, tone: 'amber' },
  ];
  return <><div className="welcome-row"><div><h2>Visão geral</h2><p className="muted">Acompanhe os principais indicadores da sua operação.</p></div><span className="date-pill">{new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })}</span></div>
    <div className="metric-grid">{metrics.map(({ title, value, hint, icon: Icon, tone }) => <article className="metric-card" key={title}><div className={`metric-icon ${tone}`}><Icon size={19} /></div><p>{title}</p><strong>{value}</strong><small>{hint}</small></article>)}</div>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>{belowCostOnly ? 'Vendas abaixo do custo' : 'Vendas recentes'}</h2><p className="muted">{belowCostOnly ? 'Cada venda exibe a justificativa registrada.' : 'Itens efetivamente vendidos, não apenas orçados.'}</p></div><button className={`secondary-button ${belowCostOnly ? 'filter-active' : ''}`} onClick={() => setBelowCostOnly(!belowCostOnly)}><Search size={16} />{belowCostOnly ? 'Mostrar todas' : `Abaixo do custo (${belowCostSales.length})`}</button></div>
      <SalesTable sales={belowCostOnly ? filteredSales : filteredSales.slice(0, 8)} empty="Nenhuma venda registrada." />
    </section>
  </>;
}

function timeValue(value) { return value ? new Date(value).getTime() : 0; }

function dreTypeLabel(type) {
  if (type === 'direct') return 'Direta';
  if (type === 'indirect') return 'Indireta';
  return 'Fora do rateio';
}

function sumDreAccounts(accounts, predicate = () => true) {
  return (accounts || []).filter(predicate).reduce((sum, account) => sum + (Number(account.monthlyAverage) || 0), 0);
}

function dateTimeLabel(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
    : '—';
}

function HistoryPage({ auditLogs, movements, quotes, sales, profiles }) {
  const [search, setSearch] = useState('');
  const [actorNames, setActorNames] = useState({});
  const [actorError, setActorError] = useState('');
  const profileNames = new Map((profiles || []).map((person) => [person.id, person.name]));
  const events = [
    ...(auditLogs || []).map((item) => ({
      id: `audit-${item.id}`, createdAt: item.createdAt,
      actorId: item.actorId, actorName: item.actorName || profileNames.get(item.actorId) || '',
      type: item.entity || 'Sistema', summary: item.summary || item.action || 'Atividade registrada',
    })),
    ...(movements || []).filter((item) => item.type !== 'sale').map((item) => ({
      id: `movement-${item.id}`, createdAt: item.createdAt,
      actorId: item.createdBy, actorName: item.createdByName || profileNames.get(item.createdBy) || '',
      type: 'Estoque',
      summary: `${item.type === 'in' ? 'Entrada' : item.type === 'sale' ? 'Baixa por venda' : 'Saída'} de ${item.quantity} un. · ${item.productName}${item.reason ? ` · ${item.reason}` : ''}`,
    })),
    ...(quotes || []).map((item) => ({
      id: `quote-${item.id}`, createdAt: item.createdAt,
      actorId: item.createdBy, actorName: item.createdByName || profileNames.get(item.createdBy) || '',
      type: 'Orçamento',
      summary: `Orçamento criado para ${item.customer} · ${item.quantity} un. de ${item.productName} · ${item.status === 'effective' ? 'efetivado' : 'em aberto'}`,
    })),
    ...(sales || []).map((item) => ({
      id: `sale-${item.id}`, createdAt: item.createdAt,
      actorId: item.createdBy, actorName: item.createdByName || profileNames.get(item.createdBy) || '',
      type: 'Venda',
      summary: `Venda para ${item.customer} · ${item.quantity} un. de ${item.productName} · ${money(item.total)}`,
    })),
  ].sort((left, right) => timeValue(right.createdAt) - timeValue(left.createdAt));
  const actorIdsKey = JSON.stringify([...new Set(events.filter((item) => !item.actorName && item.actorId && item.actorId !== 'initial').map((item) => item.actorId))].sort());
  useEffect(() => {
    if (demoMode || actorIdsKey === '[]') return undefined;
    let active = true;
    setActorError('');
    const actorIds = JSON.parse(actorIdsKey);
    listHistoryActors(actorIds)
      .then((names) => {
        if (active) setActorNames((current) => ({ ...current, ...names }));
      })
      .catch((issue) => {
        if (active) setActorError(userError(issue));
      });
    return () => { active = false; };
  }, [actorIdsKey]);
  const displayEvents = events.map((item) => ({
    ...item,
    actorName: item.actorName || actorNames[item.actorId] || (item.actorId && item.actorId !== 'initial' ? 'Usuário' : 'Sistema'),
  }));
  const searchTerm = search.trim().toLocaleLowerCase('pt-BR');
  const filteredEvents = displayEvents.filter((item) => `${item.actorName} ${item.type} ${item.summary}`.toLocaleLowerCase('pt-BR').includes(searchTerm));
  return <>
    <div className="action-row"><div><h2>Histórico de movimentações</h2><p className="muted">Ações de gestão, estoque, orçamentos, vendas, despesas e mensagens em ordem cronológica.</p></div><Field label="Filtrar histórico"><input aria-label="Filtrar histórico" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Usuário, tipo ou descrição" /></Field></div>
    {actorError && <p className="error-text" role="alert">Não foi possível carregar alguns nomes de usuários: {actorError}</p>}
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Data e hora</th><th>Usuário</th><th>Movimentação</th><th>Descrição</th></tr></thead><tbody>
      {filteredEvents.map((item) => <tr key={item.id}><td>{dateTimeLabel(item.createdAt)}</td><td><strong>{item.actorName}</strong></td><td><span className="history-type">{item.type}</span></td><td>{item.summary}</td></tr>)}
    </tbody></table>{!filteredEvents.length && <div className="empty-state"><History size={26} /><p>{events.length ? 'Nenhuma movimentação corresponde ao filtro.' : 'As movimentações aparecerão aqui.'}</p></div>}</div></section>
  </>;
}

function chatConversationId(firstUid, secondUid) {
  return [firstUid, secondUid].sort().join('__');
}

function canChat(person) {
  return person?.active === true && (person.role === 'admin' || person.permissions?.includes('chat'));
}

function whatsappStatusLabel(message) {
  if (message.whatsappStatus === 'sent') return 'Enviada pelo WhatsApp';
  if (message.whatsappStatus === 'delivered') return 'Entregue pelo WhatsApp';
  if (message.whatsappStatus === 'read') return 'Lida pelo WhatsApp';
  if (message.whatsappStatus === 'failed') return `Falha no WhatsApp${message.whatsappError ? ` · ${message.whatsappError}` : ''}`;
  if (message.whatsappStatus === 'unavailable') return `WhatsApp não enviado${message.whatsappError ? ` · ${message.whatsappError}` : ''}`;
  if (message.whatsappStatus === 'local_only') return 'Modo local · somente no chat';
  if (message.whatsappStatus === 'pending') return 'Enviando pelo WhatsApp…';
  return '';
}

function ChatPage({ profiles, profile, user, onRun }) {
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [draft, setDraft] = useState('');
  const [myPhone, setMyPhone] = useState(profile.whatsappPhone || '');
  const [whatsappOptIn, setWhatsappOptIn] = useState(profile.whatsappOptIn === true);
  const [contactError, setContactError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null;
  const currentConversationId = selectedContact ? chatConversationId(user.uid, selectedContact.id) : '';

  useEffect(() => {
    setMyPhone(profile.whatsappPhone || '');
    setWhatsappOptIn(profile.whatsappOptIn === true);
  }, [profile.whatsappPhone, profile.whatsappOptIn]);

  useEffect(() => {
    let active = true;
    setContactError('');
    if (demoMode) {
      setContacts(profiles.filter((person) => person.id !== user.uid && canChat(person))
        .map((person) => ({ id: person.id, name: person.name || person.email })));
      return () => { active = false; };
    }
    listChatContacts().then((result) => {
      if (active) setContacts(result);
    }).catch((issue) => {
      if (active) setContactError(userError(issue));
    });
    return () => { active = false; };
  }, [profiles, user.uid, profile.role, profile.permissions]);

  useEffect(() => onSnapshot(
    query(collection(db, 'chatConversations'), where('participants', 'array-contains', user.uid)),
    (snapshot) => setConversations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    (issue) => setMessageError(userError(issue)),
  ), [user.uid]);

  useEffect(() => {
    setMessages([]);
    if (!currentConversationId) return undefined;
    return onSnapshot(
      query(collection(db, 'chatMessages'), where('conversationId', '==', currentConversationId)),
      (snapshot) => setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((left, right) => timeValue(left.createdAt) - timeValue(right.createdAt))),
      (issue) => setMessageError(userError(issue)),
    );
  }, [currentConversationId]);

  useEffect(() => {
    const unread = messages.filter((message) => message.recipientId === user.uid && !message.readAt);
    if (!unread.length) return;
    Promise.all(unread.map((message) => updateDoc(doc(db, 'chatMessages', message.id), { readAt: serverTimestamp() })))
      .catch((issue) => setMessageError(userError(issue)));
  }, [messages, user.uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function saveWhatsappSettings(event) {
    event.preventDefault();
    const phone = normalizePhone(myPhone);
    if (whatsappOptIn && phone.length < 8) {
      setMessageError('Informe um número com DDI válido antes de autorizar o WhatsApp.');
      return;
    }
    setMessageError('');
    await onRun(() => updateDoc(doc(db, 'profiles', user.uid), { whatsappPhone: phone, whatsappOptIn }), undefined, {
      action: 'update', entity: 'profile', entityId: user.uid, sourceScreen: 'chat',
      summary: `${whatsappOptIn ? 'Ativou' : 'Atualizou'} o contato e a autorização de WhatsApp.`,
    });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedContact || !text || sending) return;
    setSending(true);
    setMessageError('');
    const messageRef = doc(collection(db, 'chatMessages'));
    const conversationId = chatConversationId(user.uid, selectedContact.id);
    let whatsappResult = null;
    const succeeded = await onRun(async () => {
      if (demoMode) {
        const batch = writeBatch(db);
        const sentAt = serverTimestamp();
        batch.set(doc(db, 'chatConversations', conversationId), {
          participants: [user.uid, selectedContact.id].sort(),
          lastMessage: text,
          lastMessageAt: sentAt,
          lastSenderId: user.uid,
        });
        batch.set(messageRef, {
          conversationId, senderId: user.uid, senderName: profile.name || user.email,
          recipientId: selectedContact.id, text, createdAt: sentAt,
          whatsappStatus: 'local_only',
          whatsappError: 'A integração WhatsApp não envia mensagens no modo demonstração.',
        });
        await batch.commit();
      } else {
        whatsappResult = await sendSupabaseChatMessage({
          recipientId: selectedContact.id,
          text,
          messageId: messageRef.id,
        });
      }
    }, undefined, {
      action: 'send', entity: 'chat', entityId: conversationId, sourceScreen: 'chat',
      summary: `Enviou uma mensagem para ${selectedContact.name}.`,
    });
    if (succeeded) {
      setDraft('');
      if (whatsappResult?.whatsappStatus === 'failed' || whatsappResult?.whatsappStatus === 'unavailable') {
        setMessageError(`A mensagem foi salva no chat, mas não foi enviada pelo WhatsApp: ${whatsappResult.whatsappError || 'verifique a configuração do destinatário.'}`);
      }
    }
    setSending(false);
  }

  const selectedConversation = conversations.find((item) => item.id === currentConversationId);
  return <>
    <div className="action-row"><div><h2>Chat da equipe</h2><p className="muted">Converse individualmente com os usuários autorizados ao chat.</p></div></div>
    <section className="panel whatsapp-preferences"><div><h2>Meu WhatsApp</h2><p className="muted">O número só é usado para mensagens do chat. A autorização pode ser retirada a qualquer momento.</p></div><form onSubmit={saveWhatsappSettings}><Field label="Número com código do país"><input type="tel" value={myPhone} onChange={(event) => setMyPhone(event.currentTarget.value)} placeholder="+55 11 99999-9999" /></Field><label className="check-label"><input type="checkbox" checked={whatsappOptIn} onChange={(event) => setWhatsappOptIn(event.currentTarget.checked)} /> Autorizo receber mensagens operacionais do chat pelo WhatsApp.</label><button className="secondary-button">Salvar WhatsApp</button></form></section>
    <div className="quote-info chat-whatsapp-note"><MessageCircle size={18} /><span>{demoMode
      ? 'Modo demonstração: mensagens ficam somente no chat local. Para enviá-las ao WhatsApp, conecte o Supabase, publique as Edge Functions e configure os segredos da Cloud API; o destinatário também precisa ter número válido e autorizar o recebimento.'
      : 'Mensagens são armazenadas no sistema e enviadas ao WhatsApp quando o destinatário tem número válido e autorizou o recebimento. Respostas recebidas pelo webhook aparecem nesta conversa.'}</span></div>
    {contactError && <p className="error-text chat-error">{contactError}</p>}
    {messageError && <p className="error-text chat-error" role="alert">{messageError}</p>}
    <section className="chat-layout">
      <aside className="panel chat-contact-panel"><div className="panel-heading"><div><h2>Usuários</h2><p className="muted">{contacts.length} disponíveis</p></div></div>
        <div className="chat-contact-list">{contacts.map((contact) => {
          const conversationId = chatConversationId(user.uid, contact.id);
          const conversation = conversations.find((item) => item.id === conversationId);
          return <button key={contact.id} className={`chat-contact ${selectedContactId === contact.id ? 'selected' : ''}`} onClick={() => setSelectedContactId(contact.id)}>
            <span className="avatar">{contact.name.charAt(0).toUpperCase()}</span><span className="chat-contact-text"><strong>{contact.name}</strong><small>{conversation?.lastMessage || 'Iniciar conversa'}</small></span>
          </button>;
        })}{!contacts.length && <div className="empty-state"><Users size={24} /><p>Nenhum usuário autorizado ao chat.</p></div>}</div>
      </aside>
      <section className="panel chat-thread">
        {selectedContact ? <>
          <header className="chat-thread-header"><div className="avatar">{selectedContact.name.charAt(0).toUpperCase()}</div><div><strong>{selectedContact.name}</strong><small>{selectedConversation ? 'Conversa individual' : 'Nova conversa'}</small></div></header>
          <div className="chat-message-list">{messages.map((message) => {
            const ownMessage = message.senderId === user.uid;
            const status = ownMessage ? whatsappStatusLabel(message) : '';
            return <article className={`chat-message ${ownMessage ? 'own' : ''}`} key={message.id}>
              <p>{message.text}</p><div className="chat-message-meta"><time>{dateTimeLabel(message.createdAt)}</time>{status && <span title={message.whatsappError || ''}>{status}</span>}{ownMessage && message.readAt && <CheckCheck size={14} aria-label="Lida no sistema" />}</div>
            </article>;
          })}{!messages.length && <div className="empty-state"><MessageCircle size={25} /><p>Envie a primeira mensagem para iniciar a conversa.</p></div>}<div ref={bottomRef} />
          </div>
          <form className="chat-compose" onSubmit={sendMessage}><textarea aria-label="Mensagem" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} maxLength="2000" placeholder="Escreva uma mensagem…" /><button className="primary-button" disabled={!draft.trim() || sending}><Send size={16} />{sending ? 'Enviando…' : 'Enviar'}</button></form>
        </> : <div className="empty-state chat-no-selection"><MessageCircle size={28} /><p>Selecione um usuário para abrir uma conversa.</p></div>}
      </section>
    </section>
  </>;
}

function DreExpensesPage({ dreReports, activeDreReport, activeDreReportId, onRun, user }) {
  const [pendingImport, setPendingImport] = useState(null);
  const [draftAccounts, setDraftAccounts] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [importError, setImportError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraftAccounts(activeDreReport?.accounts || []);
  }, [activeDreReport?.id]);

  async function inspectFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImportError('');
    setPendingImport(null);
    setParsing(true);
    try {
      const parsed = await parseDreFile(file);
      setPendingImport({ file, ...parsed });
    } catch (issue) {
      setImportError(issue.message || 'Não foi possível ler o arquivo DRE.');
    } finally {
      setParsing(false);
      input.value = '';
    }
  }

  async function importReport() {
    if (!pendingImport || saving) return;
    setSaving(true);
    const reportRef = doc(collection(db, 'dreReports'));
    let attachmentSaved = false;
    let attachmentPath = '';
    await onRun(async () => {
      try {
        attachmentPath = await saveDreAttachment(reportRef.id, user.uid, pendingImport.file);
        attachmentSaved = true;
        const report = {
          attachmentName: pendingImport.file.name,
          attachmentType: pendingImport.file.type || (pendingImport.file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/csv'),
          attachmentSize: pendingImport.file.size,
          attachmentPath,
          months: pendingImport.months,
          periodStart: pendingImport.months[0],
          periodEnd: pendingImport.months[pendingImport.months.length - 1],
          accounts: pendingImport.accounts,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        };
        const batch = writeBatch(db);
        batch.set(reportRef, report);
        batch.set(doc(db, 'dreSettings', 'active'), { reportId: reportRef.id });
        await batch.commit();
        setPendingImport(null);
        setImportError('');
      } catch (issue) {
        if (attachmentSaved) {
          try {
            await removeDreAttachment({ id: reportRef.id, attachmentPath });
          } catch (cleanupIssue) {
            throw new Error(`${issue.message} O relatório não foi registrado e a limpeza do arquivo original também falhou: ${cleanupIssue.message}`);
          }
        }
        throw issue;
      }
    }, undefined, { action: 'import', entity: 'dre', entityId: reportRef.id, sourceScreen: 'despesas', summary: `Importou o DRE ${pendingImport.file.name} (${pendingImport.months[0]} a ${pendingImport.months[pendingImport.months.length - 1]}).` });
    setSaving(false);
  }

  async function selectActiveReport(event) {
    const reportId = event.currentTarget.value;
    await onRun(() => setDoc(doc(db, 'dreSettings', 'active'), { reportId }), undefined, { action: 'select', entity: 'dre', entityId: reportId, sourceScreen: 'despesas', summary: reportId ? 'Selecionou o DRE usado no rateio.' : 'Removeu o DRE ativo do rateio.' });
  }

  function changeAccount(code, change) {
    setDraftAccounts((current) => current.map((account) => account.code === code ? { ...account, ...change } : account));
  }

  function changeAccountType(account, type) {
    changeAccount(account.code, {
      type,
      includedInAllocation: type === 'indirect' ? (account.type === 'indirect' ? account.includedInAllocation : true) : false,
    });
  }

  async function saveClassifications() {
    if (!activeDreReport) return;
    await onRun(() => updateDoc(doc(db, 'dreReports', activeDreReport.id), { accounts: draftAccounts }), undefined, { action: 'classify', entity: 'dre', entityId: activeDreReport.id, sourceScreen: 'despesas', summary: `Atualizou a classificação de contas do DRE ${activeDreReport.attachmentName}.` });
  }

  async function downloadOriginal(report) {
    await onRun(async () => {
      const blob = await loadDreAttachment(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = report.attachmentName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  const sortedReports = dreReports.slice().sort((left, right) => timeValue(right.createdAt) - timeValue(left.createdAt));
  const directMonthly = sumDreAccounts(activeDreReport?.accounts, (account) => account.type === 'direct');
  const indirectMonthly = sumDreAccounts(activeDreReport?.accounts, (account) => account.type === 'indirect');
  const allocatedMonthly = sumDreAccounts(activeDreReport?.accounts, (account) => account.type === 'indirect' && account.includedInAllocation);
  return <>
    <div className="action-row"><div><h2>Controle de despesas diretas e indiretas</h2><p className="muted">Importe o DRE da contabilidade, revise as classificações e consulte as médias mensais.</p></div><label className="secondary-button file-picker"><Upload size={16} />{parsing ? 'Lendo arquivo…' : 'Anexar DRE (PDF ou CSV)'}<input type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={inspectFile} disabled={parsing || saving} /></label></div>
    <div className="cost-note"><FileText size={19} /><p>O sistema sugere despesas diretas pelas contas 5.1 e 5.3.01 e indiretas pelas contas 5.3.03 e 5.7. Revise as sugestões antes de salvar. Subtotais são ignorados; somente um DRE selecionado é usado no rateio. O arquivo original é preservado para download.</p></div>
    {importError && <div className="stock-import-errors dre-import-error"><strong>Não foi possível importar o DRE.</strong><p>{importError}</p></div>}
    {pendingImport && <section className="panel table-panel"><div className="panel-heading"><div><h2>Revisão do arquivo</h2><p className="muted">{pendingImport.file.name} · {pendingImport.months.length} meses · {pendingImport.accounts.length} contas detalhadas</p></div><div className="button-group"><button className="secondary-button" onClick={() => setPendingImport(null)}>Cancelar</button><button className="primary-button" onClick={importReport} disabled={saving}>{saving ? 'Salvando…' : 'Importar DRE'}</button></div></div>
      <div className="table-wrap dre-review-table"><table><thead><tr><th>Conta</th><th>Descrição</th><th>Média mensal</th><th>Classificação sugerida / editável</th><th>Ratear</th></tr></thead><tbody>
        {pendingImport.accounts.map((account) => <tr key={account.code}><td>{account.code}</td><td><strong>{account.name}</strong></td><td>{money(account.monthlyAverage)}</td><td><select aria-label={`Classificação de ${account.name}`} value={account.type} onChange={(event) => {
          const type = event.currentTarget.value;
          setPendingImport((current) => ({ ...current, accounts: current.accounts.map((item) => item.code === account.code ? { ...item, type, includedInAllocation: type === 'indirect' ? (item.type === 'indirect' ? item.includedInAllocation : true) : false } : item) }));
        }}><option value="direct">Direta</option><option value="indirect">Indireta</option><option value="excluded">Não classificar</option></select></td><td>{account.type === 'indirect' ? <label className="check-label"><input type="checkbox" checked={account.includedInAllocation} onChange={(event) => {
          const includedInAllocation = event.currentTarget.checked;
          setPendingImport((current) => ({ ...current, accounts: current.accounts.map((item) => item.code === account.code ? { ...item, includedInAllocation } : item) }));
        }} /> Sim</label> : '—'}</td></tr>)}
      </tbody></table></div>
    </section>}
    <div className="metric-grid dre-metric-grid">
      <article className="metric-card"><div className="metric-icon blue"><CircleDollarSign size={19} /></div><p>Despesas diretas / mês</p><strong>{money(directMonthly)}</strong><small>{activeDreReport ? `${activeDreReport.periodStart} a ${activeDreReport.periodEnd}` : 'Nenhum DRE selecionado'}</small></article>
      <article className="metric-card"><div className="metric-icon violet"><CircleDollarSign size={19} /></div><p>Despesas indiretas / mês</p><strong>{money(indirectMonthly)}</strong><small>Contas classificadas como indiretas</small></article>
      <article className="metric-card"><div className="metric-icon green"><BadgeDollarSign size={19} /></div><p>Incluído no rateio / mês</p><strong>{money(allocatedMonthly)}</strong><small>Distribuído nos custos dos produtos</small></article>
      <article className="metric-card"><div className="metric-icon amber"><FileText size={19} /></div><p>Relatórios importados</p><strong>{dreReports.length}</strong><small>Arquivos originais preservados</small></article>
    </div>
    <section className="panel dre-active-panel"><div><h2>DRE usado nos custos</h2><p className="muted">Apenas o relatório selecionado compõe as despesas indiretas nos custos dos produtos.</p></div><Field label="Relatório ativo"><select value={activeDreReportId} onChange={selectActiveReport}><option value="">Nenhum relatório selecionado</option>{sortedReports.map((report) => <option key={report.id} value={report.id}>{report.attachmentName} · {report.periodStart} a {report.periodEnd}</option>)}</select></Field></section>
    {activeDreReport && <section className="panel table-panel"><div className="panel-heading"><div><h2>Classificação das contas do DRE</h2><p className="muted">Altere a classificação ou desmarque o rateio e salve as alterações.</p></div><button className="primary-button" onClick={saveClassifications}>Salvar classificações</button></div>
      <div className="table-wrap dre-review-table"><table><thead><tr><th>Conta</th><th>Descrição</th><th>Média mensal</th><th>Classificação</th><th>Ratear no custo</th></tr></thead><tbody>
        {draftAccounts.map((account) => <tr key={account.code}><td>{account.code}</td><td><strong>{account.name}</strong></td><td>{money(account.monthlyAverage)}</td><td><select aria-label={`Classificação de ${account.name}`} value={account.type} onChange={(event) => changeAccountType(account, event.currentTarget.value)}><option value="direct">Direta</option><option value="indirect">Indireta</option><option value="excluded">Não classificar</option></select></td><td>{account.type === 'indirect' ? <label className="check-label"><input type="checkbox" checked={Boolean(account.includedInAllocation)} onChange={(event) => changeAccount(account.code, { includedInAllocation: event.currentTarget.checked })} /> Sim</label> : '—'}</td></tr>)}
      </tbody></table></div>
    </section>}
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Histórico de DREs</h2><p className="muted">Arquivos anexados e períodos importados.</p></div></div><div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Período</th><th>Contas</th><th>Importado em</th><th>Uso</th><th>Original</th></tr></thead><tbody>
      {sortedReports.map((report) => <tr key={report.id}><td><strong>{report.attachmentName}</strong></td><td>{report.periodStart} a {report.periodEnd}</td><td>{report.accounts?.length || 0}</td><td>{dateLabel(report.createdAt)}</td><td>{report.id === activeDreReportId ? <span className="regular-tag">Ativo</span> : 'Histórico'}</td><td><button className="secondary-button" onClick={() => downloadOriginal(report)}><Download size={15} /> Baixar</button></td></tr>)}
    </tbody></table>{!sortedReports.length && <div className="empty-state"><FileText size={26} /><p>Nenhum DRE importado.</p></div>}</div></section>
  </>;
}

function SalesTable({ sales, empty = 'Nenhum registro.' }) {
  if (!sales.length) return <div className="empty-state"><ShoppingCart size={26} /><p>{empty}</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Cliente</th><th>Data</th><th>Qtd.</th><th>Valor unitário</th><th>Total</th><th>Observação</th></tr></thead><tbody>
    {sales.map((sale) => <tr key={sale.id}><td><strong>{sale.productName}</strong></td><td>{sale.customer || '—'}</td><td>{dateLabel(sale.createdAt || sale.soldAt)}</td><td>{sale.quantity}</td><td>{money(sale.unitPrice)}</td><td><strong>{money(sale.total)}</strong></td><td>{Number(sale.unitPrice) < Number(sale.unitCost) ? <span className="below-tag" title={sale.justification}>Abaixo do custo · {sale.justification}</span> : <span className="regular-tag">Dentro do custo</span>}</td></tr>)}
  </tbody></table></div>;
}

function ProductsPage({ products, expenses, onRun, activeDreReport, user, profile }) {
  const [modal, setModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const dreAccounts = activeDreReport?.accounts || [];
  const allocatedExpenses = expenses.filter((item) => item.includedInAllocation).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    + dreAccounts.filter((item) => item.type === 'indirect' && item.includedInAllocation).reduce((sum, item) => sum + Number(item.monthlyAverage || 0), 0);
  async function saveProduct(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const details = { name: String(data.get('name')).trim(), sku: String(data.get('sku')).trim(), description: String(data.get('description')).trim(), purchaseCost: asNumber(data.get('purchaseCost')), laborCost: asNumber(data.get('laborCost')), packagingCost: asNumber(data.get('packagingCost')), otherCost: asNumber(data.get('otherCost')), monthlyVolume: Math.max(1, asNumber(data.get('monthlyVolume'))), rateioEnabled: data.get('rateioEnabled') === 'on', margin: Math.max(0, asNumber(data.get('margin'))) };
    await onRun(async () => {
      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), details);
        setModal(false);
        setEditingProduct(null);
        return;
      }
      const product = { ...details, stock: Math.max(0, asNumber(data.get('stock'))), createdAt: serverTimestamp() };
      const batch = writeBatch(db);
      const productRef = doc(collection(db, 'products'));
      batch.set(productRef, product);
      if (product.stock > 0) {
        const movementRef = doc(collection(db, 'stockMovements'));
        batch.set(movementRef, { productId: productRef.id, productName: product.name, type: 'in', quantity: product.stock, reason: 'Estoque inicial', createdAt: serverTimestamp(), createdBy: user.uid, createdByName: profile?.name || user.email });
      }
      await batch.commit();
      setModal(false);
    }, undefined, { action: editingProduct ? 'update' : 'create', entity: 'product', entityId: editingProduct?.id, sourceScreen: 'produtos', summary: `${editingProduct ? 'Atualizou' : 'Cadastrou'} o produto "${details.name}".` });
  }
  async function saveExpense(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const expense = { name: String(data.get('name')).trim(), amount: asNumber(data.get('amount')), includedInAllocation: data.get('includedInAllocation') === 'on' };
    await onRun(async () => {
      if (editingExpense) await updateDoc(doc(db, 'expenses', editingExpense.id), expense);
      else await addDoc(collection(db, 'expenses'), { ...expense, createdAt: serverTimestamp() });
      setExpenseModal(false);
      setEditingExpense(null);
    }, undefined, { action: editingExpense ? 'update' : 'create', entity: 'expense', entityId: editingExpense?.id, sourceScreen: 'produtos', summary: `${editingExpense ? 'Atualizou' : 'Cadastrou'} a despesa "${expense.name}".` });
  }
  async function removeProduct(product) {
    if (Number(product.stock) > 0) { await onRun(async () => { throw new Error('Zere o estoque antes de excluir este produto.'); }); return; }
    if (!window.confirm(`Excluir ${product.name}?`)) return;
    await onRun(() => deleteDoc(doc(db, 'products', product.id)), undefined, { action: 'delete', entity: 'product', entityId: product.id, sourceScreen: 'produtos', summary: `Excluiu o produto "${product.name}".` });
  }
  async function toggleExpense(expense) { await onRun(() => updateDoc(doc(db, 'expenses', expense.id), { includedInAllocation: !expense.includedInAllocation }), undefined, { action: 'allocation', entity: 'expense', entityId: expense.id, sourceScreen: 'produtos', summary: `${expense.includedInAllocation ? 'Removeu' : 'Incluiu'} "${expense.name}" do rateio.` }); }
  async function removeExpense(expense) {
    if (!window.confirm(`Excluir a despesa "${expense.name}"?`)) return;
    await onRun(() => deleteDoc(doc(db, 'expenses', expense.id)), undefined, { action: 'delete', entity: 'expense', entityId: expense.id, sourceScreen: 'produtos', summary: `Excluiu a despesa "${expense.name}".` });
  }
  const updatedProducts = products.map((product) => ({ ...product, unitCost: productCost(product, products, expenses, activeDreReport) }));
  return <><div className="action-row"><div><h2>Produtos cadastrados</h2><p className="muted">Composição do custo unitário e despesas rateadas.</p></div><div className="button-group"><button className="secondary-button" onClick={() => { setEditingExpense(null); setExpenseModal(true); }}><CircleDollarSign size={16} /> Despesas indiretas</button><button className="primary-button" onClick={() => { setEditingProduct(null); setModal(true); }}><Plus size={17} /> Novo produto</button></div></div>
    <div className="cost-note"><BadgeDollarSign size={19} /><p><strong>Como funciona o rateio:</strong> despesas manuais selecionadas e contas indiretas habilitadas do DRE são distribuídas entre os produtos habilitados, proporcionalmente ao custo direto mensal estimado (custo direto × volume mensal). O custo unitário inclui a parcela alocada. Contas diretas do DRE ficam visíveis para conferência e não são somadas automaticamente aos custos cadastrados por produto.</p></div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Composição direta</th><th>Rateio / un.</th><th>Custo unitário</th><th>Preço sugerido</th><th></th></tr></thead><tbody>
      {updatedProducts.map((item) => { const share = Number(item.unitCost) - directCost(item); return <tr key={item.id}><td><strong>{item.name}</strong><small className="table-sub">{item.sku || 'Sem código'}</small></td><td>{item.stock} un.</td><td>{money(directCost(item))}</td><td>{item.rateioEnabled ? money(share) : '—'}</td><td><strong>{money(item.unitCost)}</strong></td><td><span className="price-pill">{money(Number(item.unitCost) * (1 + Number(item.margin || 0) / 100))}</span></td><td><div className="button-group"><button className="icon-button" title="Editar produto" aria-label={`Editar ${item.name}`} onClick={() => { setEditingProduct(item); setModal(true); }}><Pencil size={15} /></button><button className="text-button danger-text" onClick={() => removeProduct(item)}>Excluir</button></div></td></tr>; })}
    </tbody></table>{!products.length && <div className="empty-state"><Package size={26} /><p>Cadastre seu primeiro produto para compor os custos.</p></div>}</div></section>
    <section className="panel expense-panel"><div className="panel-heading"><div><h2>Despesas indiretas</h2><p className="muted">Despesas manuais e valores indiretos do DRE selecionados para rateio.</p></div><strong className="expense-total">{money(allocatedExpenses)} <small>média mensal incluída no rateio</small></strong></div>
      {expenses.length ? <div className="expense-list">{expenses.map((expense) => <div className="expense-row" key={expense.id}><div><strong>{expense.name}</strong><small>{expense.includedInAllocation ? 'Rateio ativo' : 'Fora do rateio'}</small></div><strong>{money(expense.amount)}</strong><button className={`switch ${expense.includedInAllocation ? 'on' : ''}`} onClick={() => toggleExpense(expense)} aria-label="Alternar inclusão no rateio"><span /></button><button className="icon-button" title="Editar despesa" aria-label={`Editar ${expense.name}`} onClick={() => { setEditingExpense(expense); setExpenseModal(true); }}><Pencil size={14} /></button><button className="icon-button danger-text" title="Excluir despesa" aria-label={`Excluir ${expense.name}`} onClick={() => removeExpense(expense)}><X size={15} /></button></div>)}</div> : <p className="muted">Nenhuma despesa cadastrada.</p>}
    </section>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Despesas do DRE</h2><p className="muted">{activeDreReport ? `${activeDreReport.attachmentName} · ${activeDreReport.periodStart} a ${activeDreReport.periodEnd} · médias mensais` : 'Importe um DRE na tela Despesas e DRE para consultar os valores aqui.'}</p></div></div>
      {dreAccounts.length ? <div className="table-wrap dre-product-table"><table><thead><tr><th>Conta</th><th>Despesa</th><th>Classificação</th><th>Média mensal</th><th>Rateio</th></tr></thead><tbody>
        {dreAccounts.map((account) => <tr key={account.code}><td>{account.code}</td><td><strong>{account.name}</strong></td><td>{dreTypeLabel(account.type)}</td><td>{money(account.monthlyAverage)}</td><td>{account.type === 'indirect' && account.includedInAllocation ? <span className="regular-tag">Incluída</span> : '—'}</td></tr>)}
      </tbody></table></div> : <p className="muted dre-empty">{activeDreReport ? 'O relatório ativo não contém contas detalhadas.' : 'Nenhum DRE selecionado para consulta.'}</p>}
    </section>
    {modal && <Modal title={editingProduct ? 'Editar produto e custos' : 'Cadastrar produto'} onClose={() => { setModal(false); setEditingProduct(null); }}><form className="modal-form" onSubmit={saveProduct}>
      <Field label="Nome do produto"><input name="name" required defaultValue={editingProduct?.name || ''} /></Field><div className="field-grid"><Field label="Código / SKU"><input name="sku" defaultValue={editingProduct?.sku || ''} /></Field>{!editingProduct && <Field label="Estoque inicial (un.)"><input name="stock" type="number" min="0" step="1" defaultValue="0" required /></Field>}</div>
      <Field label="Descrição"><input name="description" defaultValue={editingProduct?.description || ''} /></Field><div className="form-section-label">Composição do custo unitário</div>
      <div className="field-grid two"><Field label="Matéria-prima / compra (R$)"><input name="purchaseCost" type="number" min="0" step="0.01" defaultValue={editingProduct?.purchaseCost ?? 0} /></Field><Field label="Mão de obra (R$)"><input name="laborCost" type="number" min="0" step="0.01" defaultValue={editingProduct?.laborCost ?? 0} /></Field><Field label="Embalagem (R$)"><input name="packagingCost" type="number" min="0" step="0.01" defaultValue={editingProduct?.packagingCost ?? 0} /></Field><Field label="Outros custos diretos (R$)"><input name="otherCost" type="number" min="0" step="0.01" defaultValue={editingProduct?.otherCost ?? 0} /></Field></div>
      <div className="field-grid"><Field label="Volume mensal estimado (un.)"><input name="monthlyVolume" type="number" min="1" step="1" defaultValue={editingProduct?.monthlyVolume ?? 100} required /></Field><Field label="Margem desejada (%)"><input name="margin" type="number" min="0" step="0.1" defaultValue={editingProduct?.margin ?? 30} /></Field></div>
      <label className="check-label"><input name="rateioEnabled" type="checkbox" defaultChecked={editingProduct ? editingProduct.rateioEnabled : true} /> Incluir despesas rateadas no custo</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setModal(false); setEditingProduct(null); }}>Cancelar</button><button className="primary-button"><Plus size={16} /> {editingProduct ? 'Salvar alterações' : 'Salvar produto'}</button></div>
    </form></Modal>}
    {expenseModal && <Modal title={editingExpense ? 'Editar despesa indireta' : 'Adicionar despesa indireta'} onClose={() => { setExpenseModal(false); setEditingExpense(null); }}><form className="modal-form" onSubmit={saveExpense}><p className="muted">Informe o valor mensal. Você poderá habilitar ou desabilitar o rateio na lista.</p><Field label="Descrição da despesa"><input name="name" placeholder="Ex.: aluguel, energia, contabilidade" required defaultValue={editingExpense?.name || ''} /></Field><Field label="Valor mensal (R$)"><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editingExpense?.amount ?? ''} /></Field><label className="check-label"><input name="includedInAllocation" type="checkbox" defaultChecked={editingExpense ? editingExpense.includedInAllocation : true} /> Incluir no rateio de custos</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setExpenseModal(false); setEditingExpense(null); }}>Cancelar</button><button className="primary-button"><Plus size={16} /> {editingExpense ? 'Salvar alterações' : 'Salvar despesa'}</button></div></form></Modal>}
  </>;
}

function directCost(product) {
  return ['purchaseCost', 'laborCost', 'packagingCost', 'otherCost'].reduce((sum, key) => sum + (Number(product[key]) || 0), 0);
}

function productCost(product, products, expenses, dreReport) {
  const baseCost = directCost(product);
  if (!product.rateioEnabled || Number(product.monthlyVolume) <= 0) return baseCost;
  const manualExpenses = expenses.filter((item) => item.includedInAllocation).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const dreExpenses = (dreReport?.accounts || [])
    .filter((item) => item.type === 'indirect' && item.includedInAllocation)
    .reduce((sum, item) => sum + (Number(item.monthlyAverage) || 0), 0);
  const totalExpenses = manualExpenses + dreExpenses;
  const totalWeight = products.filter((item) => item.rateioEnabled && Number(item.monthlyVolume) > 0)
    .reduce((sum, item) => sum + directCost(item) * Number(item.monthlyVolume), 0);
  return baseCost + (totalWeight > 0 ? totalExpenses * baseCost / totalWeight : 0);
}

const STOCK_IMPORT_CHUNK_SIZE = 200;

function StockPage({ products, expenses, movements, onRun, user, profile, activeDreReport }) {
  const [modal, setModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importRows, setImportRows] = useState([]);
  const [importSource, setImportSource] = useState('file');
  const [ignoredErpRows, setIgnoredErpRows] = useState(0);
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importProgress, setImportProgress] = useState('');
  const [completedProductIds, setCompletedProductIds] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const fileInput = useRef(null);
  const erpFileInput = useRef(null);
  const importPlan = planStockImport(products, importRows);
  const completedProducts = new Set(completedProductIds);
  const remainingGroups = importPlan.groups.filter((group) => !completedProducts.has(group.product.id));
  const completedLineCount = importPlan.groups
    .filter((group) => completedProducts.has(group.product.id))
    .reduce((sum, group) => sum + group.lineCount, 0);
  const previewGroups = importPlan.groups.slice(0, 100);
  async function adjustStock(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const product = products.find((item) => item.id === data.get('productId'));
    const quantity = asNumber(data.get('quantity')); const type = String(data.get('type'));
    const delta = type === 'in' ? quantity : -quantity;
    if (!product || !quantity) return;
    if (Number(product.stock) + delta < 0) { await onRun(async () => { throw new Error('A saída é maior que o saldo disponível.'); }); return; }
    await onRun(async () => {
      await adjustProductStock({
        productId: product.id,
        delta,
        type,
        reason: String(data.get('reason')).trim(),
        userId: user.uid,
        actorName: profile?.name || user.email,
      });
      setModal(false);
    });
  }
  async function selectImportFile(event, source = 'file') {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setImportFile(file);
    setImportSource(source);
    setImportRows([]);
    setIgnoredErpRows(0);
    setImportError('');
    setImportStatus('');
    setImportProgress('Lendo arquivo…');
    setCompletedProductIds([]);
    setImportModal(true);
    setImportBusy(true);
    try {
      if (source === 'erp') {
        const parsed = await parseErpStockFile(file);
        setImportRows(parsed.rows);
        setIgnoredErpRows(parsed.ignoredNonpositiveTotals);
      } else {
        setImportRows(await parseStockFile(file));
      }
    } catch (issue) {
      setImportError(issue.message || 'Não foi possível ler o arquivo selecionado.');
    } finally {
      setImportBusy(false);
      setImportProgress('');
    }
  }
  function downloadImportTemplate() {
    const csv = '\uFEFFsku;produto;quantidade\r\nCOD-001;Produto cadastrado;10\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-importacao-estoque.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function closeImportModal(force = false) {
    if (!force && completedLineCount > 0 && remainingGroups.length > 0
      && !window.confirm(`A importação já confirmou ${completedLineCount} linha(s). Fechar agora e reimportar o arquivo completo poderá duplicar essas entradas. Deseja fechar?`)) return;
    setImportModal(false);
    setImportFile(null);
    setImportRows([]);
    setImportSource('file');
    setIgnoredErpRows(0);
    setImportError('');
    setImportStatus('');
    setImportProgress('');
    setCompletedProductIds([]);
    setImportBusy(false);
  }
  async function importStock() {
    if (!importFile || !importRows.length || importPlan.errors.length || importBusy || !remainingGroups.length) return;
    setImportBusy(true);
    setImportStatus('');
    let importedLines = completedLineCount;
    let allSaved = true;
    const batchCount = Math.ceil(remainingGroups.length / STOCK_IMPORT_CHUNK_SIZE);
    for (let offset = 0; offset < remainingGroups.length; offset += STOCK_IMPORT_CHUNK_SIZE) {
      const groups = remainingGroups.slice(offset, offset + STOCK_IMPORT_CHUNK_SIZE);
      const batchNumber = Math.floor(offset / STOCK_IMPORT_CHUNK_SIZE) + 1;
      setImportProgress(`Gravando lote ${batchNumber} de ${batchCount}…`);
      let batchError = '';
      const succeeded = await onRun(
        () => importStockBatch(groups, importFile.name, user.uid, profile?.name || user.email),
        (message) => { batchError = message; },
      );
      if (!succeeded) {
        allSaved = false;
        setImportStatus(`Falha no lote ${batchNumber}. ${importedLines} de ${importRows.length} linhas já foram confirmadas; os lotes restantes continuam pendentes. Tente novamente para retomar sem repetir os lotes concluídos. ${batchError}`);
        break;
      }
      importedLines += groups.reduce((sum, group) => sum + group.lineCount, 0);
      setCompletedProductIds((current) => [...current, ...groups.map((group) => group.product.id)]);
    }
    setImportProgress('');
    setImportBusy(false);
    if (allSaved) closeImportModal(true);
  }
  return <><div className="action-row"><div><h2>Posição do estoque</h2><p className="muted">Saldos atualizados a cada entrada, saída ou venda.</p></div><div className="button-group stock-action-buttons"><button className="secondary-button" onClick={downloadImportTemplate}><Download size={16} /> Baixar modelo CSV</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={16} /> Importar arquivo</button><button className="secondary-button" onClick={() => erpFileInput.current?.click()}><Upload size={16} /> Importar relatório do ERP</button><button className="primary-button" onClick={() => setModal(true)}><Plus size={17} /> Ajustar estoque</button></div><input ref={fileInput} type="file" accept=".xls,.xlsx,.csv,.txt,.xml" hidden onChange={(event) => selectImportFile(event, 'file')} /><input ref={erpFileInput} type="file" accept=".xls,.xlsx" hidden onChange={(event) => selectImportFile(event, 'erp')} /></div>
    <div className="stock-cards">{products.map((product) => <article className="stock-card" key={product.id}><div className="stock-card-top"><div className="metric-icon blue"><Package size={18} /></div><span className={Number(product.stock) > 0 ? 'stock-status' : 'stock-status zero'}>{Number(product.stock) > 0 ? 'Disponível' : 'Sem saldo'}</span></div><h3>{product.name}</h3><div className="stock-quantity"><strong>{product.stock || 0}</strong><span>unidades</span></div><div className="stock-foot"><span>Custo em estoque</span><strong>{money(Number(product.stock || 0) * productCost(product, products, expenses, activeDreReport))}</strong></div></article>)}</div>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p className="muted">Histórico de entradas e saídas manuais e de vendas.</p></div></div><div className="table-wrap"><table><thead><tr><th>Movimento</th><th>Produto</th><th>Quantidade</th><th>Motivo</th><th>Data</th></tr></thead><tbody>{movements.slice().sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt)).slice(0, 30).map((item) => <tr key={item.id}><td><span className={`movement-type ${item.type === 'in' ? 'positive' : 'negative'}`}>{item.type === 'in' ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}{item.type === 'in' ? 'Entrada' : 'Saída'}</span></td><td><strong>{item.productName}</strong></td><td>{item.quantity} un.</td><td>{item.reason || (item.type === 'sale' ? 'Venda realizada' : '—')}</td><td>{dateLabel(item.createdAt)}</td></tr>)}</tbody></table>{!movements.length && <div className="empty-state"><Boxes size={25} /><p>As movimentações aparecerão aqui.</p></div>}</div></section>
    {importModal && <Modal title={importSource === 'erp' ? 'Importar relatório do ERP' : 'Importar arquivo para o estoque'} onClose={closeImportModal} closeDisabled={importBusy} className="stock-import-modal"><div className="modal-form">
      {importFile && <p className="muted">Arquivo: <strong>{importFile.name}</strong></p>}
      <div className="quote-info"><Upload size={17} /><span>{importSource === 'erp' ? 'Relatório ERP: o código vem da coluna A, o produto da B e a quantidade da coluna Quant. Est. (U:W). O total das colunas X:Z é somado; linhas com total menor ou igual a zero são ignoradas.' : 'As quantidades serão somadas ao saldo atual. Os produtos precisam estar cadastrados e serão localizados pelo SKU ou, sem SKU, pelo nome exato. Planilhas usam a primeira aba; arquivos limitados a 10 MB e processados em lotes.'}</span></div>
      {importProgress && <p className="muted">{importProgress}</p>}
      {importError && <p className="error-text" role="alert">{importError}</p>}
      {!importBusy && !importError && importSource === 'erp' && !importRows.length && ignoredErpRows > 0 && <p className="muted" role="status">Nenhum produto importável: {ignoredErpRows} linha(s) ignorada(s) por total X:Z menor ou igual a zero.</p>}
      {!importBusy && !importError && importRows.length > 0 && <>
        <p className="muted">{importRows.length} {importRows.length === 1 ? 'linha encontrada' : 'linhas encontradas'} · {importPlan.groups.length} produtos identificados · {completedLineCount} linhas já confirmadas{importSource === 'erp' && ignoredErpRows ? ` · ${ignoredErpRows} linhas ignoradas (total X:Z ≤ 0)` : ''}</p>
        <div className="table-wrap stock-import-preview"><table><thead><tr><th>Produto</th><th>SKU</th><th>Quantidade de entrada</th><th>Linhas</th><th>Status</th></tr></thead><tbody>
          {previewGroups.map((group) => <tr key={group.product.id}><td><strong>{group.product.name}</strong></td><td>{group.product.sku || '—'}</td><td>{group.quantity} un.</td><td>{group.lineCount}</td><td>{completedProducts.has(group.product.id) ? 'Concluído' : 'Pendente'}</td></tr>)}
          {importPlan.groups.length > previewGroups.length && <tr><td colSpan="5">Mais {importPlan.groups.length - previewGroups.length} produtos na lista; todos serão importados.</td></tr>}
        </tbody></table></div>
        {importStatus && <div className="stock-import-errors" role="alert"><strong>Importação parcial interrompida</strong><p>{importStatus}</p></div>}
        {importPlan.errors.length > 0 && <div className="stock-import-errors" role="alert"><strong>Corrija as linhas abaixo antes de importar:</strong><ul>{importPlan.errors.slice(0, 8).map((item) => <li key={item.rowNumber}>Linha {item.rowNumber}: {item.message}</li>)}{importPlan.errors.length > 8 && <li>e mais {importPlan.errors.length - 8} linhas com problemas.</li>}</ul></div>}
      </>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={importBusy} onClick={closeImportModal}>Cancelar</button><button className="primary-button" disabled={importBusy || !!importError || !importRows.length || importPlan.errors.length > 0 || !remainingGroups.length} onClick={importStock}><Upload size={16} /> {completedLineCount ? 'Retomar' : 'Importar'} {remainingGroups.length} {remainingGroups.length === 1 ? 'produto' : 'produtos'} {completedLineCount ? 'pendentes' : ''}</button></div>
    </div></Modal>}
    {modal && <Modal title="Movimentar estoque" onClose={() => setModal(false)}><form className="modal-form" onSubmit={adjustStock}><Field label="Produto"><select name="productId" required defaultValue=""><option value="" disabled>Selecione um produto</option>{products.map((item) => <option value={item.id} key={item.id}>{item.name} · saldo {item.stock}</option>)}</select></Field><div className="field-grid"><Field label="Tipo de movimento"><select name="type"><option value="in">Entrada</option><option value="out">Saída</option></select></Field><Field label="Quantidade"><input name="quantity" type="number" min="1" step="1" required /></Field></div><Field label="Motivo"><input name="reason" placeholder="Ex.: compra, ajuste, perda" required /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancelar</button><button className="primary-button">Registrar movimento</button></div></form></Modal>}
  </>;
}

function QuotesPage({ products, expenses, quotes, onRun, user, profile, activeDreReport }) {
  const [modal, setModal] = useState(false);
  const [approvalQuote, setApprovalQuote] = useState(null);
  async function saveQuote(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const product = products.find((item) => item.id === data.get('productId'));
    if (!product) return;
    const quantity = asNumber(data.get('quantity')); const margin = asNumber(data.get('margin'));
    const unitCost = productCost(product, products, expenses, activeDreReport);
    const suggestedPrice = unitCost * (1 + margin / 100);
    const customPrice = String(data.get('unitPrice') || '').trim();
    const unitPrice = customPrice === '' ? suggestedPrice : asNumber(customPrice);
    const customer = String(data.get('customer')).trim();
    await onRun(async () => { await addDoc(collection(db, 'quotes'), { customer, productId: product.id, productName: product.name, quantity, unitCost, unitPrice, margin, total: quantity * unitPrice, status: 'pending', createdBy: user.uid, createdByName: profile?.name || user.email, createdAt: serverTimestamp() }); setModal(false); });
  }
  async function concludeQuote(quote) {
    if (Number(quote.unitPrice) < Number(quote.unitCost)) {
      setApprovalQuote(quote);
      return;
    }
    await finalizeQuote(quote, '');
  }
  async function authorizeBelowCost(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await finalizeQuote(approvalQuote, String(data.get('justification')).trim())) setApprovalQuote(null);
  }
  async function finalizeQuote(quote, justification) {
    if (!quote) return false;
    if (Number(quote.unitPrice) < Number(quote.unitCost) && justification.length < 10) {
      return onRun(async () => { throw new Error('Justificativa obrigatória: informe pelo menos 10 caracteres para liberar esta venda.'); });
    }
    return onRun(() => finalizeQuoteSale(
      quote,
      justification,
      user.uid,
      profile?.name || user.email,
    ));
  }
  const sortedQuotes = quotes.slice().sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  return <><div className="action-row"><div><h2>Simulação e acompanhamento</h2><p className="muted">Simule o preço pela margem desejada e registre a venda somente na efetivação.</p></div><button className="primary-button" onClick={() => setModal(true)}><Plus size={17} /> Novo orçamento</button></div>
    <div className="quote-info"><Tag size={18} /><span>Preço sugerido = custo unitário completo (com rateio, se habilitado) × (1 + margem desejada).</span></div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Produto</th><th>Data</th><th>Qtd.</th><th>Custo unit.</th><th>Preço unit.</th><th>Total</th><th>Status / ação</th></tr></thead><tbody>{sortedQuotes.map((quote) => <tr key={quote.id}><td><strong>{quote.customer}</strong></td><td>{quote.productName}</td><td>{dateLabel(quote.createdAt)}</td><td>{quote.quantity}</td><td>{money(quote.unitCost)}</td><td><strong>{money(quote.unitPrice)}</strong>{Number(quote.unitPrice) < Number(quote.unitCost) && <small className="table-sub warning-text">Abaixo do custo</small>}</td><td>{money(quote.total)}</td><td>{quote.status === 'effective' ? <span className="regular-tag">Efetivado</span> : <button className="small-primary" onClick={() => concludeQuote(quote)}>Registrar venda</button>}</td></tr>)}</tbody></table>{!quotes.length && <div className="empty-state"><FileText size={26} /><p>Nenhum orçamento criado.</p></div>}</div></section>
    {approvalQuote && <Modal title="Autorizar venda abaixo do custo" onClose={() => setApprovalQuote(null)}><form className="modal-form" onSubmit={authorizeBelowCost}><div className="cost-note"><ShieldCheck size={18} /><p><strong>{approvalQuote.productName}</strong> será vendido por {money(approvalQuote.unitPrice)} por unidade, abaixo do custo de {money(approvalQuote.unitCost)}. Registre a justificativa para liberar a venda.</p></div><Field label="Justificativa (mínimo 10 caracteres)"><textarea name="justification" required minLength="10" rows="4" autoFocus /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setApprovalQuote(null)}>Cancelar</button><button className="primary-button"><ShieldCheck size={16} /> Autorizar venda</button></div></form></Modal>}
    {modal && <Modal title="Simular orçamento" onClose={() => setModal(false)}><form className="modal-form" onSubmit={saveQuote}><Field label="Cliente"><input name="customer" required placeholder="Nome do cliente" /></Field><Field label="Produto"><select name="productId" required defaultValue=""><option value="" disabled>Selecione um produto</option>{products.map((item) => <option value={item.id} key={item.id}>{item.name} · custo {money(productCost(item, products, expenses, activeDreReport))} · estoque {item.stock}</option>)}</select></Field><div className="field-grid"><Field label="Quantidade"><input name="quantity" type="number" min="1" step="1" required defaultValue="1" /></Field><Field label="Margem desejada (%)"><input name="margin" type="number" min="0" step="0.1" defaultValue="30" /></Field></div><Field label="Preço unitário personalizado (R$) · opcional"><input name="unitPrice" type="number" min="0" step="0.01" placeholder="Em branco para usar o preço sugerido" /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancelar</button><button className="primary-button"><FileText size={16} /> Salvar orçamento</button></div></form></Modal>}
  </>;
}

function SalesPage({ sales }) {
  const total = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  return <><div className="sales-summary"><div className="metric-icon green"><BadgeDollarSign size={20} /></div><div><span>Faturamento registrado</span><strong>{money(total)}</strong></div><div className="summary-divider" /><div><span>Vendas concluídas</span><strong>{sales.length}</strong></div></div><section className="panel table-panel"><div className="panel-heading"><div><h2>Histórico de vendas</h2><p className="muted">Somente vendas efetivamente concluídas a partir dos orçamentos.</p></div></div><SalesTable sales={sales.slice().sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))} empty="As vendas serão exibidas após efetivar um orçamento." /></section></>;
}

function ProfilesPage({ profiles, onRun, user, profile }) {
  const isAdmin = profile.role === 'admin';
  async function updateProfile(person, event) {
    const data = new FormData(event.currentTarget); const permissions = data.getAll('permissions');
    const name = String(data.get('name')).trim();
    const whatsappPhone = normalizePhone(data.get('whatsappPhone'));
    await onRun(() => updateDoc(doc(db, 'profiles', person.id), { name, whatsappPhone, role: person.role === 'analyst' ? 'analyst' : 'custom', permissions, active: data.get('active') === 'on' }), undefined, { action: 'update', entity: 'profile', entityId: person.id, sourceScreen: 'perfis', summary: `Atualizou o perfil de ${name} e suas permissões.` });
  }
  async function updateAdminContact(person, event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    const whatsappPhone = normalizePhone(data.get('whatsappPhone'));
    await onRun(() => updateDoc(doc(db, 'profiles', person.id), { name, whatsappPhone }), undefined, { action: 'update', entity: 'profile', entityId: person.id, sourceScreen: 'perfis', summary: `Atualizou o contato do administrador ${name}.` });
  }
  async function makeAdmin(person) {
    if (person.id === user.uid) { await onRun(async () => { throw new Error('Não é possível alterar o próprio perfil por esta tela.'); }); return; }
    if (!window.confirm(`Conceder acesso total de administrador a ${person.email}?`)) return;
    await onRun(() => updateDoc(doc(db, 'profiles', person.id), { role: 'admin', permissions: permissionScreens.map((item) => item.id), active: true }), undefined, { action: 'promote', entity: 'profile', entityId: person.id, sourceScreen: 'perfis', summary: `Concedeu acesso de administrador a ${person.email}.` });
  }
  return <><div className="action-row"><div><h2>Usuários e permissões</h2><p className="muted">{isAdmin ? 'Novas contas entram como pendentes. Defina as telas e ative o acesso.' : 'Consulte os perfis cadastrados e suas permissões.'}</p></div></div>
    <div className="cost-note"><ShieldCheck size={19} /><p>O administrador tem acesso total. Analistas podem acessar todas as telas, mas a gestão de perfis permanece restrita ao administrador. {isAdmin ? 'Os demais usuários acessam somente as telas autorizadas.' : 'Esta tela está disponível para consulta.'}</p></div>
    <div className="profile-grid">{profiles.map((person) => <article className="panel profile-card" key={person.id}><div className="profile-card-heading"><div className="avatar">{(person.name || person.email || '?').charAt(0).toUpperCase()}</div><div><strong>{person.name || 'Sem nome'}</strong><small>{person.email} · {person.role === 'admin' ? 'Administrador' : person.role === 'analyst' ? 'Analista' : 'Usuário'}</small></div><span className={`profile-status ${person.active ? 'active' : ''}`}>{person.active ? 'Ativo' : 'Pendente'}</span></div>
      {person.role === 'admin' ? <><div className="admin-badge"><ShieldCheck size={16} /> Administrador · acesso total</div>{isAdmin && person.id === user.uid && <form className="profile-contact-form" onSubmit={(event) => updateAdminContact(person, event)}><Field label="Nome"><input name="name" defaultValue={person.name || ''} required /></Field><Field label="WhatsApp com DDI"><input name="whatsappPhone" type="tel" placeholder="+55 11 99999-9999" defaultValue={person.whatsappPhone || ''} /></Field><button className="secondary-button">Salvar contato</button></form>}</> : isAdmin ? <form onSubmit={(event) => { event.preventDefault(); updateProfile(person, event); }}><Field label="Nome"><input name="name" defaultValue={person.name || ''} required /></Field><Field label="WhatsApp com DDI"><input name="whatsappPhone" type="tel" placeholder="+55 11 99999-9999" defaultValue={person.whatsappPhone || ''} /></Field><div className="permissions-list">{permissionScreens.map((item) => <label key={item.id}><input type="checkbox" name="permissions" value={item.id} defaultChecked={person.permissions?.includes(item.id)} /><span>{item.label}{item.id === 'perfis' ? ' · consulta' : ''}</span></label>)}</div><label className="check-label"><input name="active" type="checkbox" defaultChecked={person.active} /> Acesso ativo</label><div className="profile-actions"><button className="primary-button"><Check size={15} /> Salvar perfil</button><button type="button" className="text-button" onClick={() => makeAdmin(person)}>Tornar administrador</button></div></form> : <div className="profile-readonly-info"><span>{person.role === 'analyst' ? 'Analista · acesso a todas as telas' : `${person.permissions?.length || 0} telas autorizadas`}</span><small>Gerenciamento de perfis restrito ao administrador.</small></div>}
    </article>)}</div>{!profiles.length && <div className="panel empty-state"><Users size={26} /><p>Nenhum perfil cadastrado além do seu.</p></div>}</>;
}

export default App;
