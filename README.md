# Atrativa — Gestão e precificação

Aplicação de controle de estoque, composição e rateio de custos, simulação de orçamentos, vendas, despesas, histórico, chat e permissões por perfil. O backend usa Supabase (Auth, Postgres/RLS, Storage e Edge Functions); o modo demonstração continua disponível sem conexão externa.

Baixe o [guia de configuração do Supabase e WhatsApp Cloud API](./guia-conexao-supabase-whatsapp.pdf).

## Executar localmente

Para usar o sistema conectado ao Supabase, configure o arquivo `.env` conforme a seção **Conectar um projeto Supabase** e rode:

```sh
npm install
npm run dev
```

Para servir uma compilação estática pelo Live Server, gere a versão conectada com `npm run build` e sirva a pasta `dist` (o workspace já está configurado para isso). Após alterar o código, compile novamente e recarregue a página.

### Modo demonstração (opcional)

Use `npm run build:demo` somente para testar sem conexão com o Supabase. A demonstração entra como administrador, carrega registros de exemplo e guarda as alterações no `localStorage` do navegador. Use **Restaurar dados de exemplo** para recomeçar. Os acessos locais são `admin@prisma.local` e `darlan@prisma.local`; qualquer senha com pelo menos seis caracteres é aceita. A demonstração não envia WhatsApp e seus dados não são transferidos para o sistema conectado.

## Conectar um projeto Supabase

### 1. Criar e configurar o projeto

1. Crie um projeto no [Supabase](https://supabase.com/dashboard) e guarde a senha do banco em local seguro.
2. Em **Authentication → Providers**, habilite o provedor **Email**. Configure também a URL do site e os redirect URLs de desenvolvimento e produção (por exemplo, `http://localhost:5173` e `http://127.0.0.1:5500`).
3. Copie a **Project URL** e a chave pública **anon / publishable**. Na raiz do projeto, copie `.env.example` para `.env` e preencha:

   ```dotenv
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-publica
   ```

4. Reinicie o servidor ou gere novamente a compilação depois de editar `.env`. Se `VITE_DEMO_MODE=true` estiver definido, remova-o ou defina-o como `false` para usar o Supabase.

As variáveis `VITE_*` são públicas e ficam incluídas no frontend compilado. **Nunca** use a chave `service_role` ou segredos do WhatsApp em `VITE_*`, no navegador ou no repositório.

### Publicar a versão oficial no GitHub Pages

O workflow `.github/workflows/deploy.yml` publica a versão conectada ao Supabase quando há push na branch `main`. No GitHub, em **Settings → Secrets and variables → Actions**, configure:

- variável `VITE_SUPABASE_URL` com a URL raiz do projeto Supabase, sem `/rest/v1/`;
- secret `VITE_SUPABASE_ANON_KEY` com a chave pública `anon`/`publishable`. Ela será incluída no JavaScript do site, portanto nunca use aqui a chave `service_role`.

Em **Settings → Pages**, selecione **GitHub Actions** como origem. No Supabase, em **Authentication → URL Configuration**, cadastre a URL publicada como **Site URL** e em **Redirect URLs**. Para este repositório, o endereço padrão é `https://contabilidade-kdw.github.io/Gestao-Precificacao/` (se estiver usando domínio personalizado, use esse domínio). O workflow força o modo oficial e interrompe a publicação se a URL ou a chave estiverem ausentes; sem configuração, o app não troca silenciosamente para demonstração.

Os registros da demonstração ficam no `localStorage` do navegador e **não são transferidos automaticamente** para o Supabase. Depois da publicação oficial, os novos cadastros e alterações serão gravados no Supabase, respeitando o perfil, as permissões e as políticas RLS.

### 2. Aplicar o banco e as políticas

Instale a [Supabase CLI](https://supabase.com/docs/guides/cli) (no Windows, pode usar `scoop install supabase`), autentique e associe a pasta ao projeto:

```sh
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

`supabase db push` aplica `supabase/migrations/20261125102500_initial_schema.sql`. A migração cria:

- perfis ligados ao Supabase Auth, com cadastro pendente por padrão;
- registros de produtos, despesas, orçamentos, vendas, estoque, DRE, auditoria e chat em Postgres;
- políticas Row Level Security (RLS) baseadas nos perfis e telas autorizadas;
- RPCs transacionais para movimentação/importação de estoque e efetivação de orçamento;
- bucket privado `dre-reports`, com políticas de acesso e limite de 10 MB;
- publicação Realtime para os dados usados pela interface.

Depois de conectar as credenciais, rode `npm run dev` para testar o login, ou `npm run build` para gerar a versão conectada. Para usar o Live Server com Supabase, sirva a pasta `dist` gerada por `npm run build` — não a compilação `build:demo`.

### 3. Liberar o primeiro administrador

O gatilho SQL cria um perfil pendente quando alguém se cadastra. Como ainda não há administrador para aprová-lo, faça o bootstrap inicial no **SQL Editor** do Supabase, substituindo o e-mail pelo da primeira conta:

```sql
update public.profiles p
set role = 'admin',
    active = true,
    permissions = array['painel', 'produtos', 'estoque', 'orcamentos', 'vendas',
      'despesas', 'historico', 'chat', 'perfis']
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('admin@empresa.com');
```

Depois, saia e entre novamente no app. O administrador pode ativar usuários e atribuir telas em **Perfis e acessos**. Faça o bootstrap somente para a conta administrativa correta.

## Importar estoque e DRE

Na tela **Controle de estoque**, importe arquivos `.xls`, `.xlsx`, `.csv`, `.txt` ou `.xml`. Os produtos precisam estar cadastrados e são localizados por SKU ou nome exato; as quantidades são somadas ao saldo. A opção **Importar relatório do ERP** aceita `.xls` e `.xlsx` no formato do relatório de posição: SKU na coluna A, produto na B, quantidade em U e total nas colunas X:Z. Linhas de produto cuja soma de X:Z seja igual ou inferior a zero são ignoradas. Não há limite de 200 linhas por arquivo: cada arquivo pode ter até 10 MB, é agrupado por produto e gravado em lotes atômicos de até 200 produtos. Se um lote falhar, os lotes confirmados ficam identificados para retomar sem duplicá-los. Use **Baixar modelo CSV** para obter um exemplo.

Na tela **Despesas e DRE**, anexe relatórios `.csv` ou `.pdf` com até 10 MB. O CSV aceita UTF-8 ou Windows-1252; o PDF precisa ter texto selecionável. Os meses e contas detalhadas são lidos para revisão, com sugestões de classificação direta/indireta e seleção do rateio.

As despesas indiretas selecionadas do DRE são rateadas junto das despesas manuais. As contas diretas ficam disponíveis para conferência e não são somadas automaticamente aos custos unitários. O arquivo original é guardado no bucket privado `dre-reports`.

## Configurar WhatsApp Cloud API

O app usa duas Supabase Edge Functions:

- `send-chat-message`: exige JWT válido, valida perfil e consentimento, registra a mensagem no chat e tenta o envio pela Meta;
- `whatsapp-webhook`: valida o token de verificação e a assinatura HMAC da Meta, atualiza os status e registra as respostas recebidas.

### 1. Guardar os segredos

No Supabase Dashboard, abra **Edge Functions → Secrets** e configure estes nomes:

- `META_WHATSAPP_TOKEN`: token de acesso da Cloud API;
- `META_PHONE_NUMBER_ID`: ID do número remetente (não é o ID da conta WhatsApp Business);
- `META_APP_SECRET`: App Secret da aplicação Meta;
- `META_VERIFY_TOKEN`: valor aleatório criado por você e repetido na configuração do webhook.

Alternativamente, mantenha os valores em `supabase/.env.local` (arquivo ignorado pelo Git) e envie-os sem colocá-los no histórico do terminal:

```sh
supabase secrets set --env-file supabase/.env.local
```

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são disponibilizadas pelo ambiente das Edge Functions. Não as copie para o frontend.

### 2. Publicar as funções

```sh
supabase functions deploy send-chat-message
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

A função de webhook não usa JWT porque a Meta assina as requisições com `META_APP_SECRET`. A função de envio valida o JWT do usuário e confere no banco se o perfil está ativo e autorizado ao chat.

### 3. Registrar e validar o webhook na Meta

No painel do app Meta/WhatsApp, configure como callback:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook
```

Informe o mesmo `META_VERIFY_TOKEN` e assine o evento/campo `messages`. Depois:

1. Publique as duas funções e confirme que os quatro segredos foram salvos.
2. Ative o acesso ao chat para os usuários em **Perfis e acessos**.
3. Cada destinatário deve informar telefone válido com DDI e marcar explicitamente o consentimento para receber mensagens pelo WhatsApp.
4. Envie uma mensagem pelo chat e responda pelo WhatsApp; confira os status no chat e a entrada no histórico.

A integração envia texto. A Meta pode exigir um modelo aprovado fora da janela de atendimento de 24 horas; esta versão ainda não envia modelos. Erros de entrega permanecem visíveis no status da mensagem. A resposta recebida é associada à conversa ativa mais recente do contato identificado pelo telefone.

Consulte os logs das Edge Functions em **Supabase Dashboard → Edge Functions → Logs**.

## Migração de dados existentes

O app anterior estava em modo de demonstração e não havia um projeto Firebase configurado neste workspace. A mudança cria um banco Supabase novo; não converte automaticamente dados de uma instalação Firebase já existente. Se houver dados reais no Firebase, exporte-os e planeje uma migração separada antes de desativar o projeto anterior.

## Regras de negócio mantidas

- O custo direto soma compra/matéria-prima, mão de obra, embalagem e outros custos diretos.
- Despesas indiretas mensais habilitadas são rateadas proporcionalmente ao custo direto multiplicado pelo volume mensal.
- O preço sugerido é o custo completo multiplicado por `1 + margem / 100`.
- Um orçamento só aparece como venda quando efetivado; essa ação verifica e baixa o estoque numa transação no Postgres.
- Venda abaixo do custo exige justificativa com pelo menos 10 caracteres, consultável no painel de gestão.
- O administrador acessa todas as telas; os demais perfis acessam apenas as telas autorizadas.
