import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, adjustProductStock, approveQuote, authenticateDemo, collection, deleteDoc, deleteRejectedQuote, doc, finalizeQuoteSale, getDemoAdmin, getDoc,
  importStockBatch, isQuoteExpired, listChatContacts, listHistoryActors, listProfiles, onSnapshot, query, resetDemoData,
  rejectQuote, sendChatMessage, where, writeBatch,
  serverTimestamp, setDoc, updateDoc,
} from './data.js';
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, BadgeDollarSign, Boxes,
  Ban, Check, CheckCheck, ChevronDown, CircleDollarSign, ClipboardList, Download, FileText,
  History, LayoutDashboard, LogOut, Mail, MessageCircle, Package, Pencil, Plus, Search, Send, ShieldCheck,
  RotateCcw, ShoppingCart, Tag, Trash2, Upload, Users, X,
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
const dateOnlyValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateOnlyLabel = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return dateLabel(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('pt-BR');
};
const productDraftStorageKey = 'atrativa-new-product-draft';
const emptyProductDraft = () => ({
  name: '', sku: '', stock: '0', description: '', purchaseCost: '0', laborCost: '0',
  packagingCost: '0', otherCost: '0', monthlyVolume: '100', margin: '30', rateioEnabled: true,
});
const readProductDraft = () => {
  const savedDraft = sessionStorage.getItem(productDraftStorageKey);
  return savedDraft ? { ...emptyProductDraft(), ...JSON.parse(savedDraft) } : emptyProductDraft();
};
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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

function Modal({ title, onClose, children, className = '', closeDisabled = false, closeOnBackdrop = true, hideCloseButton = false }) {
  return <div className="modal-backdrop" onMouseDown={(event) => !closeDisabled && closeOnBackdrop && event.target === event.currentTarget && onClose()}>
    <section className={`modal ${className}`}><header><h2>{title}</h2>{!hideCloseButton && <button className="icon-button" onClick={onClose} aria-label="Fechar" disabled={closeDisabled}><X size={19} /></button>}</header>{children}</section>
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
    <p className="muted">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no ambiente de build: use <code>.env</code> no desenvolvimento ou as variáveis/secrets do GitHub Actions na publicação. Configure o banco, Authentication, Storage e as Edge Functions conforme o README.</p>
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
  const [unreadMessages, setUnreadMessages] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
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

  useEffect(() => {
    const canUseChat = profile?.role === 'admin' || profile?.permissions?.includes('chat');
    if (!user || !profile?.active || !canUseChat) {
      setUnreadMessages([]);
      return undefined;
    }
    return onSnapshot(
      query(collection(db, 'chatMessages'), where('recipientId', '==', user.uid)),
      (snapshot) => setUnreadMessages(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((message) => !message.readAt)),
      (issue) => setError(userError(issue)),
    );
  }, [user?.uid, profile?.active, profile?.role, profile?.permissions]);

  useEffect(() => {
    const canUseChat = profile?.role === 'admin' || profile?.permissions?.includes('chat');
    if (!user || !profile?.active || !canUseChat || !supabase || demoMode) {
      setOnlineUserIds([]);
      return undefined;
    }

    let active = true;
    const channel = supabase.channel('app-presence', {
      config: { presence: { key: user.uid } },
    });
    const updateOnlineUsers = () => {
      const onlineIds = new Set();
      Object.values(channel.presenceState()).forEach((presences) => {
        presences.forEach((presence) => {
          if (typeof presence.userId === 'string') onlineIds.add(presence.userId);
        });
      });
      if (active) setOnlineUserIds(Array.from(onlineIds));
    };

    channel
      .on('presence', { event: 'sync' }, updateOnlineUsers)
      .subscribe((status, issue) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          channel.track({ userId: user.uid }).then((trackingStatus) => {
            if (active && trackingStatus !== 'ok') {
              setError(userError(new Error(`Não foi possível registrar sua presença (${trackingStatus}).`)));
            }
          }).catch((trackingError) => {
            if (active) setError(userError(trackingError));
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError(userError(issue || new Error(`Não foi possível sincronizar a presença (${status}).`)));
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.uid, profile?.active, profile?.role, profile?.permissions]);

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
  const sharedProps = { products, expenses, quotes, sales, movements, profiles, auditLogs, profile, user, onRun: run, dreReports, activeDreReport, activeDreReportId, unreadMessages, onlineUserIds };
  return <div className="app-shell">
    <aside className="sidebar">
    
      <div className="nav-caption">MENU PRINCIPAL</div>
      <nav>{visibleScreens.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${screen === id ? 'selected' : ''}`} onClick={() => setScreen(id)}><Icon size={18} /><span>{label}</span>{id === 'orcamentos' && quotes.filter((quote) => quote.status !== 'effective').length > 0 && <span className="nav-count">{quotes.filter((quote) => quote.status !== 'effective').length}</span>}{id === 'chat' && unreadMessages.length > 0 && <span className="chat-nav-unread-dot" role="img" aria-label="Mensagens não lidas" title="Mensagens não lidas" />}</button>)}</nav>
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
  const pending = quotes.filter((quote) => ['pending', 'approved'].includes(quote.status)).length;
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
      summary: `Orçamento criado para ${item.customer} · ${item.quantity} un. de ${item.productName} · ${item.status === 'effective' ? 'venda registrada' : item.status === 'approved' ? 'aprovado' : item.status === 'rejected' ? 'recusado' : 'em aberto'}`,
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

function ChatPage({ profiles, profile, user, onRun, unreadMessages, onlineUserIds }) {
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [draft, setDraft] = useState('');
  const [contactError, setContactError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null;
  const selectedContactOnline = selectedContact ? onlineUserIds.includes(selectedContact.id) : false;
  const currentConversationId = selectedContact ? chatConversationId(user.uid, selectedContact.id) : '';

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

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedContact || !text || sending) return;
    setSending(true);
    setMessageError('');
    const messageRef = doc(collection(db, 'chatMessages'));
    const conversationId = chatConversationId(user.uid, selectedContact.id);
    const succeeded = await onRun(async () => {
      await sendChatMessage({
        senderId: user.uid,
        senderName: profile.name || user.email,
        recipientId: selectedContact.id,
        text,
        messageId: messageRef.id,
      });
    }, undefined, {
      action: 'send', entity: 'chat', entityId: conversationId, sourceScreen: 'chat',
      summary: `Enviou uma mensagem para ${selectedContact.name}.`,
    });
    if (succeeded) {
      setDraft('');
    }
    setSending(false);
  }

  const selectedConversation = conversations.find((item) => item.id === currentConversationId);
  return <>
    <div className="action-row"><div><h2>Chat da equipe</h2><p className="muted">Converse individualmente com os usuários autorizados ao chat.</p></div></div>
    <div className="quote-info chat-internal-note"><MessageCircle size={18} /><span>{demoMode
      ? 'Modo demonstração: as mensagens ficam salvas somente neste navegador.'
      : 'As mensagens são gravadas no banco de dados e sincronizadas com os usuários autorizados ao chat.'}</span></div>
    {contactError && <p className="error-text chat-error">{contactError}</p>}
    {messageError && <p className="error-text chat-error" role="alert">{messageError}</p>}
    <section className="chat-layout">
      <aside className="panel chat-contact-panel"><div className="panel-heading"><div><h2>Usuários</h2><p className="muted">{contacts.length} disponíveis</p></div></div>
        <div className="chat-contact-list">{contacts.map((contact) => {
          const conversationId = chatConversationId(user.uid, contact.id);
          const conversation = conversations.find((item) => item.id === conversationId);
          const hasUnread = unreadMessages.some((message) => message.senderId === contact.id);
          const isOnline = onlineUserIds.includes(contact.id);
          return <button key={contact.id} className={`chat-contact ${selectedContactId === contact.id ? 'selected' : ''}`} onClick={() => setSelectedContactId(contact.id)}>
            <span className="chat-contact-avatar"><span className="avatar">{contact.name.charAt(0).toUpperCase()}</span>{isOnline && <span className="chat-presence-dot" role="img" aria-label="Online" title="Online" />}</span>
            <span className="chat-contact-text"><strong>{contact.name}</strong><small>{conversation?.lastMessage || 'Iniciar conversa'}</small></span>
            {hasUnread && <span className="chat-unread-dot" role="img" aria-label="Mensagem não lida" title="Mensagem não lida" />}
          </button>;
        })}{!contacts.length && <div className="empty-state"><Users size={24} /><p>Nenhum usuário autorizado ao chat.</p></div>}</div>
      </aside>
      <section className="panel chat-thread">
        {selectedContact ? <>
          <header className="chat-thread-header"><span className="chat-thread-avatar"><span className="avatar">{selectedContact.name.charAt(0).toUpperCase()}</span>{selectedContactOnline && <span className="chat-presence-dot" role="img" aria-label="Online" title="Online" />}</span><div><strong>{selectedContact.name}</strong><small className={selectedContactOnline ? 'chat-online-label' : ''}>{selectedContactOnline ? 'Online' : selectedConversation ? 'Conversa individual' : 'Nova conversa'}</small></div></header>
          <div className="chat-message-list">{messages.map((message) => {
            const ownMessage = message.senderId === user.uid;
            return <article className={`chat-message ${ownMessage ? 'own' : ''}`} key={message.id}>
              <p>{message.text}</p><div className="chat-message-meta"><time>{dateTimeLabel(message.createdAt)}</time>{ownMessage && message.readAt && <CheckCheck size={14} aria-label="Lida no sistema" />}</div>
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
  const [newProductDraft, setNewProductDraft] = useState(readProductDraft);
  const [modal, setModal] = useState(() => sessionStorage.getItem(productDraftStorageKey) !== null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const dreAccounts = activeDreReport?.accounts || [];
  const allocatedExpenses = expenses.filter((item) => item.includedInAllocation).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    + dreAccounts.filter((item) => item.type === 'indirect' && item.includedInAllocation).reduce((sum, item) => sum + Number(item.monthlyAverage || 0), 0);
  function openNewProductModal() {
    setEditingProduct(null);
    sessionStorage.setItem(productDraftStorageKey, JSON.stringify(newProductDraft));
    setModal(true);
  }
  function closeProductModal() {
    if (!editingProduct) {
      sessionStorage.removeItem(productDraftStorageKey);
      setNewProductDraft(emptyProductDraft());
    }
    setModal(false);
    setEditingProduct(null);
  }
  function persistNewProductDraft(event) {
    const data = new FormData(event.currentTarget);
    const draft = Object.fromEntries(data.entries());
    draft.rateioEnabled = data.get('rateioEnabled') === 'on';
    sessionStorage.setItem(productDraftStorageKey, JSON.stringify(draft));
    setNewProductDraft(draft);
  }
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
      sessionStorage.removeItem(productDraftStorageKey);
      setNewProductDraft(emptyProductDraft());
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
  return <><div className="action-row"><div><h2>Produtos cadastrados</h2><p className="muted">Composição do custo unitário e despesas rateadas.</p></div><div className="button-group"><button className="secondary-button" onClick={() => { setEditingExpense(null); setExpenseModal(true); }}><CircleDollarSign size={16} /> Despesas indiretas</button><button className="primary-button" onClick={openNewProductModal}><Plus size={17} /> Novo produto</button></div></div>
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
    {modal && <Modal title={editingProduct ? 'Editar produto e custos' : 'Cadastrar produto'} onClose={closeProductModal} closeOnBackdrop={Boolean(editingProduct)} hideCloseButton={!editingProduct}><form className="modal-form" onSubmit={saveProduct} onChange={!editingProduct ? persistNewProductDraft : undefined}>
      <Field label="Nome do produto"><input name="name" required defaultValue={editingProduct ? editingProduct.name || '' : newProductDraft.name} /></Field><div className="field-grid"><Field label="Código / SKU"><input name="sku" defaultValue={editingProduct ? editingProduct.sku || '' : newProductDraft.sku} /></Field>{!editingProduct && <Field label="Estoque inicial (un.)"><input name="stock" type="number" min="0" step="1" defaultValue={newProductDraft.stock} required /></Field>}</div>
      <Field label="Descrição"><input name="description" defaultValue={editingProduct ? editingProduct.description || '' : newProductDraft.description} /></Field><div className="form-section-label">Composição do custo unitário</div>
      <div className="field-grid two"><Field label="Matéria-prima / compra (R$)"><input name="purchaseCost" type="number" min="0" step="0.01" defaultValue={editingProduct ? editingProduct.purchaseCost ?? 0 : newProductDraft.purchaseCost} /></Field><Field label="Mão de obra (R$)"><input name="laborCost" type="number" min="0" step="0.01" defaultValue={editingProduct ? editingProduct.laborCost ?? 0 : newProductDraft.laborCost} /></Field><Field label="Embalagem (R$)"><input name="packagingCost" type="number" min="0" step="0.01" defaultValue={editingProduct ? editingProduct.packagingCost ?? 0 : newProductDraft.packagingCost} /></Field><Field label="Outros custos diretos (R$)"><input name="otherCost" type="number" min="0" step="0.01" defaultValue={editingProduct ? editingProduct.otherCost ?? 0 : newProductDraft.otherCost} /></Field></div>
      <div className="field-grid"><Field label="Volume mensal estimado (un.)"><input name="monthlyVolume" type="number" min="1" step="1" defaultValue={editingProduct ? editingProduct.monthlyVolume ?? 100 : newProductDraft.monthlyVolume} required /></Field><Field label="Margem desejada (%)"><input name="margin" type="number" min="0" step="0.1" defaultValue={editingProduct ? editingProduct.margin ?? 30 : newProductDraft.margin} /></Field></div>
      <label className="check-label"><input name="rateioEnabled" type="checkbox" defaultChecked={editingProduct ? editingProduct.rateioEnabled : newProductDraft.rateioEnabled} /> Incluir despesas rateadas no custo</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={closeProductModal}>Cancelar</button><button className="primary-button"><Plus size={16} /> {editingProduct ? 'Salvar alterações' : 'Salvar produto'}</button></div>
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

function QuotesPage({ products, expenses, quotes, profiles, onRun, user, profile, activeDreReport }) {
  const [modal, setModal] = useState(false);
  const [revisionQuote, setRevisionQuote] = useState(null);
  const [quoteDraft, setQuoteDraft] = useState({
    customer: '', customerEmail: '', productId: '', quantity: '1', margin: '30',
    unitPrice: '', discountPercent: '0', validityDays: '30', paymentMethod: 'Pix', installments: '1',
  });
  const [belowCostQuote, setBelowCostQuote] = useState(null);
  const [shareQuote, setShareQuote] = useState(null);
  const [shareContacts, setShareContacts] = useState([]);
  const [shareRecipientId, setShareRecipientId] = useState('');
  const [shareText, setShareText] = useState('');
  const [shareError, setShareError] = useState('');
  const [contactsLoading, setContactsLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const profileNames = new Map((profiles || []).map((person) => [person.id, person.name || person.email || '']));
  const quoteCreatorName = (quote) => quote.createdByName || profileNames.get(quote.createdBy) || '—';
  const quoteApproverName = (quote) => quote.approvedByName || profileNames.get(quote.approvedBy) || '—';

  function openQuoteForm(quote = null) {
    setRevisionQuote(quote);
    if (quote) {
      const installments = Number(quote.installmentCount)
        || Number(String(quote.paymentTerms || '').match(/\d+/)?.[0])
        || 1;
      setQuoteDraft({
        customer: quote.customer || '',
        customerEmail: quote.customerEmail || '',
        productId: quote.productId || '',
        quantity: String(quote.quantity || 1),
        margin: String(quote.margin ?? 30),
        unitPrice: String(quote.listUnitPrice ?? quote.unitPrice ?? ''),
        discountPercent: String(quote.discountPercent || 0),
        validityDays: String(quote.validityDays || 30),
        paymentMethod: ['Pix', 'Cartão', 'Boleto'].includes(quote.paymentMethod) ? quote.paymentMethod : 'Pix',
        installments: String(Math.min(12, Math.max(1, installments))),
      });
    } else {
      setQuoteDraft({
        customer: '', customerEmail: '', productId: '', quantity: '1', margin: '30',
        unitPrice: '', discountPercent: '0', validityDays: '30', paymentMethod: 'Pix', installments: '1',
      });
    }
    setModal(true);
  }

  function updateQuoteDraft(field, value) {
    setQuoteDraft((current) => {
      if (field === 'productId' || field === 'margin') {
        const productId = field === 'productId' ? value : current.productId;
        const margin = field === 'margin' ? asNumber(value) : asNumber(current.margin);
        const product = products.find((item) => item.id === productId);
        const unitCost = product ? productCost(product, products, expenses, activeDreReport) : 0;
        return {
          ...current,
          [field]: value,
          unitPrice: product ? String(roundMoney(unitCost * (1 + margin / 100))) : '',
        };
      }
      return { ...current, [field]: value };
    });
  }

  async function saveQuote(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const product = products.find((item) => item.id === data.get('productId'));
    if (!product) return;

    const quantity = asNumber(data.get('quantity'));
    const margin = asNumber(data.get('margin'));
    const discountPercent = asNumber(data.get('discountPercent'));
    const validityDays = asNumber(data.get('validityDays'));
    const unitCost = productCost(product, products, expenses, activeDreReport);
    const suggestedPrice = unitCost * (1 + margin / 100);
    const customPrice = String(data.get('unitPrice') || '').trim();
    const listUnitPrice = roundMoney(customPrice === '' ? suggestedPrice : asNumber(customPrice));
    const unitPrice = roundMoney(listUnitPrice * (1 - discountPercent / 100));
    const subtotal = roundMoney(quantity * listUnitPrice);
    const total = roundMoney(quantity * unitPrice);
    const createdAt = new Date();
    const validUntilDate = new Date(createdAt);
    validUntilDate.setDate(validUntilDate.getDate() + validityDays);
    const paymentMethod = String(data.get('paymentMethod') || '');
    const installmentCount = paymentMethod === 'Pix' ? 1 : asNumber(data.get('installments'));
    const quote = {
      customer: String(data.get('customer')).trim(),
      customerEmail: String(data.get('customerEmail') || '').trim(),
      productId: product.id,
      productName: product.name,
      quantity,
      unitCost,
      listUnitPrice,
      unitPrice,
      margin,
      discountPercent,
      discountAmount: roundMoney(subtotal - total),
      subtotal,
      total,
      suggestedUnitPrice: roundMoney(suggestedPrice),
      paymentMethod,
      installmentCount,
      paymentTerms: paymentMethod === 'Pix'
        ? 'À vista'
        : `${installmentCount} ${installmentCount === 1 ? 'parcela' : 'parcelas'}`,
      validityDays,
      validUntil: dateOnlyValue(validUntilDate),
      status: 'pending',
      createdBy: user.uid,
      createdByName: profile?.name || user.email,
      createdAt: createdAt.toISOString(),
      ...(revisionQuote
        ? { revisionOf: revisionQuote.id, revisionNumber: (Number(revisionQuote.revisionNumber) || 1) + 1 }
        : { revisionNumber: 1 }),
    };
    await onRun(async () => {
      await addDoc(collection(db, 'quotes'), quote);
      setModal(false);
      setRevisionQuote(null);
    });
  }

  async function approveQuoteItem(quote) {
    await onRun(() => approveQuote(
      quote,
      user.uid,
      profile?.name || user.email,
    ), undefined, {
      action: 'approve',
      entity: 'quote',
      entityId: quote.id,
      sourceScreen: 'orcamentos',
      summary: `Aprovou o orçamento de ${quote.customer} para ${quote.productName}.`,
    });
  }

  async function rejectQuoteItem(quote) {
    if (!window.confirm(`Recusar o orçamento de ${quote.customer}? Ele continuará no histórico e poderá ser revisado depois.`)) return;
    await onRun(() => rejectQuote(quote, user.uid, profile?.name || user.email), undefined, {
      action: 'reject',
      entity: 'quote',
      entityId: quote.id,
      sourceScreen: 'orcamentos',
      summary: `Recusou o orçamento de ${quote.customer} para ${quote.productName}.`,
    });
  }

  async function removeRejectedQuote(quote) {
    if (!window.confirm(`Excluir permanentemente o orçamento recusado de ${quote.customer}?`)) return;
    await onRun(() => deleteRejectedQuote(quote.id), undefined, {
      action: 'delete',
      entity: 'quote',
      entityId: quote.id,
      sourceScreen: 'orcamentos',
      summary: `Excluiu o orçamento recusado de ${quote.customer} para ${quote.productName}.`,
    });
  }

  async function concludeQuote(quote) {
    if (isQuoteExpired(quote)) {
      await onRun(async () => { throw new Error('O orçamento venceu e não pode ser registrado como venda.'); });
      return;
    }
    if (Number(quote.unitPrice) < Number(quote.unitCost)) {
      setBelowCostQuote(quote);
      return;
    }
    await finalizeQuote(quote, '');
  }

  async function authorizeBelowCost(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await finalizeQuote(belowCostQuote, String(data.get('justification')).trim())) setBelowCostQuote(null);
  }

  async function finalizeQuote(quote, justification) {
    if (!quote) return false;
    if (isQuoteExpired(quote)) {
      return onRun(async () => { throw new Error('O orçamento venceu e não pode ser registrado como venda.'); });
    }
    if (Number(quote.unitPrice) < Number(quote.unitCost) && justification.length < 10) {
      return onRun(async () => { throw new Error('Justificativa obrigatória: informe pelo menos 10 caracteres para liberar esta venda.'); });
    }
    return onRun(() => finalizeQuoteSale(
      quote,
      justification,
      user.uid,
      profile?.name || user.email,
    ), undefined, {
      action: 'finalize',
      entity: 'quote',
      entityId: quote.id,
      sourceScreen: 'orcamentos',
      summary: `Registrou a venda do orçamento de ${quote.customer} para ${quote.productName}.`,
    });
  }

  function emailQuote(quote) {
    const body = [
      `Orçamento para ${quote.customer}`,
      `Produto: ${quote.productName}`,
      `Quantidade: ${quote.quantity}`,
      `Preço unitário: ${money(quote.unitPrice)}`,
      `Desconto: ${Number(quote.discountPercent) || 0}% (${money(quote.discountAmount)})`,
      `Total: ${money(quote.total)}`,
      `Forma de pagamento: ${quote.paymentMethod || 'A combinar'}`,
      `Condição de pagamento: ${quote.paymentTerms || 'A combinar'}`,
      `Data do orçamento: ${dateLabel(quote.createdAt)}`,
      `Válido até: ${dateOnlyLabel(quote.validUntil)}`,
    ].join('\n');
    const subject = `Orçamento para ${quote.customer}`;
    window.location.href = `mailto:${encodeURIComponent(quote.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function exportQuotePdf(quote) {
    await onRun(async () => {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const contentWidth = pageWidth - margin * 2;
      let y = 24;

      pdf.setProperties({ title: `Orçamento - ${quote.customer}`, author: 'Atrativa' });
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.text('ATRATIVA', margin, y);
      pdf.setFontSize(12);
      pdf.text('ORÇAMENTO', pageWidth - margin, y, { align: 'right' });
      y += 7;
      pdf.setDrawColor(220, 226, 236);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 12;

      const addField = (label, value) => {
        const labelText = `${label}:`;
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        const valueX = margin + pdf.getTextWidth(labelText) + 4;
        const valueLines = pdf.splitTextToSize(String(value || '—'), pageWidth - margin - valueX);
        pdf.text(labelText, margin, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(valueLines, valueX, y);
        y += Math.max(5, valueLines.length * 5) + 3;
        if (y > pageHeight - margin - 10) {
          pdf.addPage();
          y = margin;
        }
      };

      addField('Cliente', quote.customer);
      if (quote.customerEmail) addField('E-mail', quote.customerEmail);
      addField('Data do orçamento', dateLabel(quote.createdAt));
      addField('Válido até', dateOnlyLabel(quote.validUntil));
      addField('Forma de pagamento', quote.paymentMethod || 'A combinar');
      addField('Condição de pagamento', quote.paymentTerms || 'A combinar');

      y += 3;
      const columns = [
        { label: 'Produto', width: 64 },
        { label: 'Qtd.', width: 16 },
        { label: 'Preço unit.', width: 30 },
        { label: 'Desconto', width: 33 },
        { label: 'Total', width: 31 },
      ];
      const rowValues = [
        quote.productName,
        String(quote.quantity),
        money(quote.unitPrice).replace(/\u00a0/g, ' '),
        `${Number(quote.discountPercent) || 0}% (${money(quote.discountAmount).replace(/\u00a0/g, ' ')})`,
        money(quote.total).replace(/\u00a0/g, ' '),
      ];
      const rowLines = rowValues.map((value, index) => pdf.splitTextToSize(value, columns[index].width - 4));
      const rowHeight = Math.max(12, ...rowLines.map((lines) => lines.length * 5 + 6));
      const drawRow = (values, lines, height, header = false) => {
        let x = margin;
        columns.forEach((column, index) => {
          if (header) {
            pdf.setFillColor(243, 246, 251);
            pdf.rect(x, y, column.width, height, 'F');
          }
          pdf.setDrawColor(220, 226, 236);
          pdf.rect(x, y, column.width, height);
          pdf.setFont('helvetica', header ? 'bold' : 'normal');
          pdf.setFontSize(header ? 8 : 9);
          pdf.setTextColor(52, 64, 84);
          pdf.text(lines[index], x + 2, y + 5);
          x += column.width;
        });
        y += height;
      };

      drawRow(columns.map((column) => column.label), columns.map((column) => [column.label]), 9, true);
      if (y + rowHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      drawRow(rowValues, rowLines, rowHeight);
      y += 12;
      if (y + 16 > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(`Total do orçamento: ${money(quote.total).replace(/\u00a0/g, ' ')}`, pageWidth - margin, y, { align: 'right' });
      y += 9;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(`Status: ${quote.status === 'effective' ? 'Venda registrada' : 'Aprovado'}`, margin, y);
      if (Number(quote.revisionNumber) > 1) {
        pdf.text(`Revisão ${quote.revisionNumber}`, pageWidth - margin, y, { align: 'right' });
      }
      y += 9;

      const additionalFields = [
        ['Criado por', quoteCreatorName(quote)],
        ['Aprovado por', quoteApproverName(quote)],
      ].map(([label, value]) => {
        const labelText = `${label}:`;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        const valueX = margin + pdf.getTextWidth(labelText) + 4;
        return {
          labelText,
          valueX,
          valueLines: pdf.splitTextToSize(String(value || '—'), pageWidth - margin - valueX),
        };
      });
      const additionalInfoHeight = 8 + additionalFields.reduce(
        (height, field) => height + Math.max(5, field.valueLines.length * 5) + 3,
        0,
      );
      if (y + additionalInfoHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text('Informações Adicionais', margin, y);
      y += 7;
      additionalFields.forEach((field) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text(field.labelText, margin, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(field.valueLines, field.valueX, y);
        y += Math.max(5, field.valueLines.length * 5) + 3;
      });

      const safeCustomer = String(quote.customer || 'cliente')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'cliente';
      pdf.save(`orcamento-${safeCustomer}.pdf`);
    }, undefined, {
      action: 'export',
      entity: 'quote',
      entityId: quote.id,
      sourceScreen: 'orcamentos',
      summary: `Exportou em PDF o orçamento de ${quote.customer}.`,
    });
  }

  function quoteSummary(quote) {
    return [
      `Orçamento para ${quote.customer}`,
      `Produto: ${quote.productName}`,
      `Quantidade: ${quote.quantity}`,
      `Preço unitário líquido: ${money(quote.unitPrice)}`,
      `Desconto: ${Number(quote.discountPercent) || 0}% (${money(quote.discountAmount)})`,
      `Total: ${money(quote.total)}`,
      `Forma de pagamento: ${quote.paymentMethod || 'A combinar'}`,
      `Condição de pagamento: ${quote.paymentTerms || 'A combinar'}`,
      `Data: ${dateLabel(quote.createdAt)} · Válido até: ${dateOnlyLabel(quote.validUntil)}`,
    ].join('\n');
  }

  async function openShareDialog(quote) {
    setShareQuote(quote);
    setShareRecipientId('');
    setShareText(quoteSummary(quote));
    setShareError('');
    setContactsLoading(true);
    try {
      const recipients = demoMode
        ? (profiles || []).filter((person) => person.id !== user.uid && canChat(person))
          .map((person) => ({ id: person.id, name: person.name || person.email }))
        : await listChatContacts();
      setShareContacts(recipients);
      if (!recipients.length) setShareError('Não há membros ativos autorizados ao chat para receber este orçamento.');
    } catch (issue) {
      setShareError(userError(issue));
    } finally {
      setContactsLoading(false);
    }
  }

  async function shareQuoteByChat(event) {
    event.preventDefault();
    const text = shareText.trim();
    if (!shareQuote || !shareRecipientId || !text || sharing) return;
    setSharing(true);
    const succeeded = await onRun(() => sendChatMessage({
      senderId: user.uid,
      senderName: profile?.name || user.email,
      recipientId: shareRecipientId,
      text,
      messageId: doc(collection(db, 'chatMessages')).id,
    }), undefined, {
      action: 'share',
      entity: 'quote',
      entityId: shareQuote.id,
      sourceScreen: 'orcamentos',
      summary: `Compartilhou o orçamento de ${shareQuote.customer} com um membro da equipe pelo chat.`,
    });
    if (succeeded) setShareQuote(null);
    setSharing(false);
  }

  const sortedQuotes = quotes.slice().sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  const draftProduct = products.find((item) => item.id === quoteDraft.productId);
  const suggestedUnitPrice = draftProduct
    ? roundMoney(productCost(draftProduct, products, expenses, activeDreReport) * (1 + asNumber(quoteDraft.margin) / 100))
    : 0;
  return <>
    <div className="action-row"><div><h2>Simulação e acompanhamento</h2><p className="muted">Crie, aprove e registre a venda de orçamentos dentro do prazo de validade.</p></div><button className="primary-button" onClick={() => openQuoteForm()}><Plus size={17} /> Novo orçamento</button></div>
    <div className="quote-info"><Tag size={18} /><span>O preço sugerido considera custo + margem e pode ser editado. Pix é à vista; Cartão e Boleto permitem até 12 parcelas. O desconto é aplicado ao preço unitário e ao total. Se o valor líquido ficar abaixo do custo, será necessária uma justificativa ao registrar a venda.</span></div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Produto</th><th>Data</th><th>Validade</th><th>Qtd.</th><th>Pagamento</th><th>Custo unit.</th><th>Preço unit. líquido</th><th>Desconto</th><th>Total</th><th>Status / ações</th><th>Responsáveis</th></tr></thead><tbody>
      {sortedQuotes.map((quote) => {
        const expired = isQuoteExpired(quote) && quote.status !== 'effective';
        const listUnitPrice = Number(quote.listUnitPrice ?? quote.unitPrice);
        return <tr key={quote.id}>
          <td><strong>{quote.customer}</strong>{Number(quote.revisionNumber) > 1 && <small className="table-sub">Revisão {quote.revisionNumber}</small>}{quote.customerEmail && <small className="table-sub">{quote.customerEmail}</small>}</td>
          <td>{quote.productName}</td>
          <td>{dateLabel(quote.createdAt)}</td>
          <td>{dateOnlyLabel(quote.validUntil)}</td>
          <td>{quote.quantity}</td>
          <td className="quote-payment-cell"><strong>{quote.paymentMethod || '—'}</strong><small className="table-sub">{quote.paymentTerms || '—'}</small></td>
          <td>{money(quote.unitCost)}</td>
          <td><strong>{money(quote.unitPrice)}</strong>{listUnitPrice !== Number(quote.unitPrice) && <small className="table-sub">De {money(listUnitPrice)}</small>}{Number(quote.unitPrice) < Number(quote.unitCost) && <small className="table-sub warning-text">Abaixo do custo</small>}</td>
          <td>{Number(quote.discountPercent) || 0}%<small className="table-sub">{money(quote.discountAmount)}</small></td>
          <td><strong>{money(quote.total)}</strong>{quote.subtotal != null && Number(quote.subtotal) !== Number(quote.total) && <small className="table-sub">Subtotal {money(quote.subtotal)}</small>}</td>
          <td><div className="quote-actions">
            <button type="button" className="secondary-button" onClick={() => emailQuote(quote)}><Mail size={14} /> Preparar e-mail</button>
            {canChat(profile) && <button type="button" className="secondary-button" onClick={() => openShareDialog(quote)}><MessageCircle size={14} /> Chat</button>}
            {quote.status === 'effective' && <span className="regular-tag">Venda registrada</span>}
            {quote.status === 'rejected' && <span className="below-tag">Recusado</span>}
            {expired && <span className="below-tag">Vencido</span>}
            {['approved', 'effective'].includes(quote.status) && <button type="button" className="secondary-button" onClick={() => exportQuotePdf(quote)}><Download size={14} /> Exportar PDF</button>}
            {!expired && quote.status === 'pending' && <button type="button" className="small-primary" onClick={() => approveQuoteItem(quote)}>Aprovar orçamento</button>}
            {quote.status === 'pending' && <button type="button" className="secondary-button" onClick={() => rejectQuoteItem(quote)}><Ban size={14} /> Recusar orçamento</button>}
            {!expired && quote.status === 'approved' && <button type="button" className="small-primary" onClick={() => concludeQuote(quote)}>Registrar venda</button>}
            {quote.status === 'rejected' && <><button type="button" className="secondary-button" onClick={() => openQuoteForm(quote)}><RotateCcw size={14} /> Revisar orçamento</button><button type="button" className="secondary-button" onClick={() => removeRejectedQuote(quote)}><Trash2 size={14} /> Excluir orçamento</button></>}
            {!['pending', 'approved', 'effective', 'rejected'].includes(quote.status) && <span className="regular-tag">Em aberto</span>}
          </div></td>
          <td><div className="quote-responsibles"><div><span>Criado por</span><strong>{quoteCreatorName(quote)}</strong></div><div><span>Aprovado por</span><strong>{quoteApproverName(quote)}</strong></div></div></td>
        </tr>;
      })}
    </tbody></table>{!quotes.length && <div className="empty-state"><FileText size={26} /><p>Nenhum orçamento criado.</p></div>}</div></section>
    {belowCostQuote && <Modal title="Autorizar venda abaixo do custo" onClose={() => setBelowCostQuote(null)}><form className="modal-form" onSubmit={authorizeBelowCost}><div className="cost-note"><ShieldCheck size={18} /><p><strong>{belowCostQuote.productName}</strong> será vendido por {money(belowCostQuote.unitPrice)} por unidade, abaixo do custo de {money(belowCostQuote.unitCost)}. Registre a justificativa para liberar a venda.</p></div><Field label="Justificativa (mínimo 10 caracteres)"><textarea name="justification" required minLength="10" rows="4" autoFocus /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setBelowCostQuote(null)}>Cancelar</button><button className="primary-button"><ShieldCheck size={16} /> Registrar venda</button></div></form></Modal>}
    {shareQuote && <Modal title="Compartilhar orçamento pelo chat" onClose={() => !sharing && setShareQuote(null)} closeDisabled={sharing}><form className="modal-form" onSubmit={shareQuoteByChat}>
      {shareError && <p className="error-text" role="alert">{shareError}</p>}
      <Field label="Membro da equipe"><select required value={shareRecipientId} onChange={(event) => setShareRecipientId(event.currentTarget.value)} disabled={contactsLoading || !shareContacts.length}><option value="">{contactsLoading ? 'Carregando membros…' : 'Selecione quem receberá'}</option>{shareContacts.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <Field label="Resumo da mensagem"><textarea value={shareText} onChange={(event) => setShareText(event.currentTarget.value)} required maxLength="2000" rows="8" /></Field>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShareQuote(null)} disabled={sharing}>Cancelar</button><button className="primary-button" disabled={sharing || contactsLoading || !shareRecipientId || !shareText.trim()}><Send size={16} />{sharing ? 'Enviando…' : 'Enviar pelo chat'}</button></div>
    </form></Modal>}
    {modal && <Modal title={revisionQuote ? 'Revisar orçamento' : 'Criar orçamento'} onClose={() => setModal(false)}><form className="modal-form" onSubmit={saveQuote}>
      {revisionQuote && <div className="quote-info"><RotateCcw size={17} /><span>Será criada uma nova versão pendente. O orçamento recusado continuará preservado no histórico.</span></div>}
      <Field label="Cliente"><input name="customer" value={quoteDraft.customer} onChange={(event) => updateQuoteDraft('customer', event.currentTarget.value)} required placeholder="Nome do cliente" /></Field>
      <Field label="E-mail do cliente (opcional)"><input name="customerEmail" type="email" value={quoteDraft.customerEmail} onChange={(event) => updateQuoteDraft('customerEmail', event.currentTarget.value)} placeholder="cliente@empresa.com" /></Field>
      <Field label="Produto"><select name="productId" required value={quoteDraft.productId} onChange={(event) => updateQuoteDraft('productId', event.currentTarget.value)}><option value="" disabled>Selecione um produto</option>{products.map((item) => <option value={item.id} key={item.id}>{item.name} · custo {money(productCost(item, products, expenses, activeDreReport))} · estoque {item.stock}</option>)}</select></Field>
      <div className="field-grid"><Field label="Quantidade"><input name="quantity" type="number" min="1" step="1" required value={quoteDraft.quantity} onChange={(event) => updateQuoteDraft('quantity', event.currentTarget.value)} /></Field><Field label="Margem desejada (%)"><input name="margin" type="number" min="0" step="0.1" value={quoteDraft.margin} onChange={(event) => updateQuoteDraft('margin', event.currentTarget.value)} /></Field></div>
      <Field label="Preço unitário antes do desconto (R$)"><input name="unitPrice" type="number" min="0" step="0.01" required value={quoteDraft.unitPrice} onChange={(event) => updateQuoteDraft('unitPrice', event.currentTarget.value)} /></Field>
      <p className="muted">Preço sugerido (custo + margem): <strong>{money(suggestedUnitPrice)}</strong> <button type="button" className="text-button" onClick={() => updateQuoteDraft('unitPrice', String(suggestedUnitPrice))}>Usar preço sugerido</button></p>
      <div className="field-grid"><Field label="Desconto (%)"><input name="discountPercent" type="number" min="0" max="100" step="0.1" value={quoteDraft.discountPercent} onChange={(event) => updateQuoteDraft('discountPercent', event.currentTarget.value)} /></Field><Field label="Validade"><select name="validityDays" value={quoteDraft.validityDays} onChange={(event) => updateQuoteDraft('validityDays', event.currentTarget.value)}><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option></select></Field></div>
      <div className="quote-payment-fields"><Field label="Forma de pagamento"><select name="paymentMethod" value={quoteDraft.paymentMethod} onChange={(event) => updateQuoteDraft('paymentMethod', event.currentTarget.value)}><option value="Pix">Pix</option><option value="Cartão">Cartão</option><option value="Boleto">Boleto</option></select></Field>{quoteDraft.paymentMethod === 'Pix' ? <Field label="Condição de pagamento"><input value="À vista" readOnly /></Field> : <Field label="Condição de pagamento"><select name="installments" value={quoteDraft.installments} onChange={(event) => updateQuoteDraft('installments', event.currentTarget.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? 'parcela' : 'parcelas'}</option>)}</select></Field>}</div>
      <div className="cost-note"><Tag size={18} /><p>A data do orçamento será preenchida automaticamente; revisões recebem nova data de cadastro e validade. A validade padrão é de 30 dias e o desconto é aplicado ao total líquido.</p></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancelar</button><button className="primary-button"><FileText size={16} /> {revisionQuote ? 'Criar nova versão' : 'Salvar orçamento'}</button></div>
    </form></Modal>}
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
