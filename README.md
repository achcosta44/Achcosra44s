# Consultório – pacientes, agenda, pagamentos e prontuário

O app tem duas formas de uso, com as mesmas telas:

1. **Celular, sem nuvem**: um único arquivo `dist/consultorio.html`. Os dados ficam só no navegador do aparelho.
2. **Cloudflare** (opcional): servidor com banco D1. Descrito mais abaixo.

## Sincronização entre notebook e celular (criptografia ponta a ponta)

O mesmo `dist/consultorio.html` pode sincronizar vários aparelhos. Cada aparelho continua com todos os dados localmente e funciona sem internet. As alterações são enviadas e recebidas automaticamente: alguns segundos depois de cada mudança, a cada 30 s, ao voltar a internet e ao reabrir o app.

**Privacidade:** antes de sair do aparelho, cada registro é criptografado com AES-256-GCM. A chave é derivada da senha do usuário (PBKDF2-SHA256, 600 mil iterações). O servidor (`sync/`) recebe apenas o código do cofre, um token derivado da senha (guardado só como hash) e dados cifrados. Sem a senha, ninguém lê os dados: nem a Cloudflare, nem o administrador do servidor.
- **Esqueceu a senha?** Os dados do servidor ficam irrecuperáveis. Mantenha as cópias de segurança em dia.

**Conflitos:** se o mesmo cadastro, sessão ou pagamento for alterado nos dois aparelhos, prevalece a alteração mais recente. Registros de prontuário e de auditoria nunca são alterados, só acrescentados, então nunca se perdem.

**Anexos:** vão cifrados para o servidor. No outro aparelho, o arquivo só é baixado quando aberto (economiza espaço no celular). Para isso, é preciso internet na primeira abertura.

### Publicar o servidor de sincronização (uma vez)

```bash
npm install
cd sync
npx wrangler login
npx wrangler d1 create consultorio-sync              # copie o database_id para sync/wrangler.jsonc
npx wrangler r2 bucket create consultorio-sync-arquivos
npx wrangler d1 migrations apply consultorio-sync --remote
npx wrangler deploy                                  # mostra o endereço, ex.: https://consultorio-sync.<conta>.workers.dev
cd ..
SYNC_URL=https://consultorio-sync.<conta>.workers.dev npm run build:celular   # embute o endereço no app
```

`MAX_COFRES` (em `sync/wrangler.jsonc`) limita quantos cofres podem ser criados no servidor. O padrão é 2, o que impede o uso por terceiros.

### Ativar nos aparelhos

1. **No notebook**, que tem os dados: *Backup → Ativar neste aparelho*. Crie uma senha forte e **anote o código do cofre** que aparecer.
2. **No celular:** *Backup → Conectar a uma sincronização existente*. Informe o código e a senha. Os dados do celular são substituídos pelos do cofre; antes disso, uma cópia é baixada automaticamente.

## Versão celular (sem nuvem)

`dist/consultorio.html` tem tudo embutido: telas, biblioteca de Excel e banco local (IndexedDB do navegador). Funciona sem internet e não envia dados a lugar nenhum.

**Gerar o arquivo** (só depois de mudar o código):

```bash
npm install
npm run build:celular     # gera dist/consultorio.html
```

**Levar ao celular:** copie `dist/consultorio.html` para o aparelho (cabo USB, Google Drive, e-mail para si mesmo etc.) e abra no navegador.

- **Android:** abra o arquivo no Chrome. Os dados ficam ligados ao endereço pelo qual o arquivo foi aberto. Sempre abra pelo mesmo caminho (de preferência salve como favorito). Antes de usar com pacientes reais, faça o teste: cadastre um paciente fictício, feche o navegador, reabra o arquivo e confira se ele continua lá.
- **iPhone:** o iOS não executa um HTML aberto pelo app Arquivos de forma que guarde dados. É preciso abrir o arquivo a partir de um endereço web (ver "Próximos passos").

**Cópia de segurança — indispensável.** Os dados existem só naquele navegador. Se o celular for perdido, trocado, resetado, ou se os dados do navegador forem limpos, tudo se perde. Na tela **Excel → Cópia de segurança completa**:

- *Gerar cópia* baixa um `.json` com tudo, inclusive prontuário e anexos. Guarde no computador ou num pen drive.
- *Restaurar cópia* substitui todos os dados do aparelho pelos da cópia. Serve também para passar os dados a um celular novo.
- O app mostra um aviso quando a última cópia tem mais de 7 dias.

**Segurança:** o arquivo de cópia e a planilha com prontuário contêm dados sensíveis de saúde, sem criptografia. Use bloqueio de tela no celular e guarde as cópias em local protegido.

| Peça | Serviço Cloudflare | Onde está no projeto |
|---|---|---|
| Telas (HTML/JS/CSS) | Workers Static Assets | `public/` |
| API | Workers | `src/` |
| Banco de dados (SQLite) | D1 | `migrations/` |
| Anexos do prontuário | R2 | — |
| Login | Zero Trust Access | — |

## Funcionalidades (versão padrão)

- **Agenda semanal**: agendar (inclusive recorrente semanal), remarcar, marcar como confirmado/realizado/faltou/cancelado, aviso de conflito de horário.
- **Pacientes**: cadastro, busca, inativação (paciente nunca é excluído).
- **Prontuário**: evoluções imutáveis — não podem ser editadas nem apagadas, apenas *retificadas* por nova anotação vinculada; anexos (até 20 MB) com hash SHA-256.
- **Financeiro**: pagamentos (PIX, dinheiro, cartão etc.), situação pago/pendente/cancelado, resumo mensal e lista de sessões realizadas sem pagamento.
- **Excel**: exporta tudo em `.xlsx` (opcionalmente com o prontuário) e importa Pacientes/Agenda/Pagamentos de uma planilha no mesmo modelo.
- **Auditoria**: toda leitura de prontuário e toda alteração ficam registradas (usuário, data, IP), sem possibilidade de exclusão.

As travas de imutabilidade estão no próprio banco (triggers em `migrations/0001_estrutura_inicial.sql`), não só na tela.

## Rodar localmente

```bash
npm install
cp .dev.vars.example .dev.vars          # libera login só em localhost
npm run db:migrate:local
npm run dev                              # http://localhost:8787
```

## Publicar na Cloudflare

Pré-requisito: conta Cloudflare (o plano gratuito atende para começar).

1. **Login no wrangler**
   ```bash
   npx wrangler login
   ```
2. **Criar o banco** e copiar o `database_id` retornado para `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create consultorio-db
   ```
   Ao criar, é possível escolher a região (`--location`). Veja a seção LGPD abaixo.
3. **Criar o bucket de anexos**
   ```bash
   npx wrangler r2 bucket create consultorio-anexos
   ```
4. **Criar as tabelas**
   ```bash
   npm run db:migrate:remote
   ```
5. **Publicar**
   ```bash
   npm run deploy
   ```
6. **Proteger com Cloudflare Access** (obrigatório — sem isso a API recusa todas as chamadas):
   - Painel Cloudflare → *Zero Trust* → *Access* → *Applications* → *Add an application* → *Self-hosted*.
   - Domínio: o endereço do Worker (`consultorio.<sua-conta>.workers.dev`) ou um domínio próprio.
   - Política: *Allow*, regra *Emails* com o(s) e-mail(s) autorizado(s). Método de login: *One-time PIN* (código por e-mail).
   - Copie o **Application Audience (AUD) Tag** e o **team domain** (`<time>.cloudflareaccess.com`).
7. **Configurar as variáveis** em `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`) e publicar de novo (`npm run deploy`).

A API valida a assinatura do token do Access em cada requisição e confere o e-mail com `ALLOWED_EMAILS`. Assim, mesmo quem descobrir o endereço não consegue acessar os dados.

## Backup

```bash
npm run db:backup     # gera backup-AAAAMMDD-HHMM.sql com o banco inteiro
```

O D1 também mantém *Time Travel* (restauração para qualquer ponto dos últimos 30 dias nos planos pagos; 7 dias no gratuito).
A exportação para Excel pela tela também serve como cópia de segurança legível.
Arquivos `.xlsx` e `backup-*.sql` são ignorados pelo git para evitar que dados de pacientes acabem no repositório.

## LGPD e guarda do prontuário — pontos de atenção

- Dados de saúde são **dados pessoais sensíveis** (LGPD, art. 5º, II, e art. 11). O app já aplica: acesso restrito por login, trilha de auditoria, registros imutáveis e transmissão apenas por HTTPS.
- **Localização dos dados**: o D1 e o R2 ficam em data centers escolhidos por região, e a Cloudflare não oferece região no Brasil para eles. Isso caracteriza transferência internacional (arts. 33 a 36 da LGPD), que precisa de base adequada (por exemplo, as cláusulas-padrão contratuais aprovadas pela ANPD) e deve ser informada ao paciente.
- **Prazo de guarda** e regras de registro dependem do conselho profissional (CFM, CFP, CFO, COFFITO etc.). Pacientes não podem ser excluídos pelo sistema justamente por isso.
- Recomenda-se termo de ciência/consentimento do paciente sobre o tratamento dos dados.

## Estrutura

```
migrations/0001_estrutura_inicial.sql   tabelas, índices e travas
src/index.ts                            roteamento, autenticação, tratamento de erros
src/auth.ts                             validação do token do Cloudflare Access
src/api.ts                              regras de negócio de cada rota
src/validacao.ts                        validação de campos (datas, valores em R$, opções)
public/                                 telas (index.html, app.js, style.css)
celular/backend-local.js                versão celular: mesmas rotas, gravando no IndexedDB
scripts/build-celular.mjs               gera dist/consultorio.html (arquivo único)
dist/consultorio.html                   app pronto para o celular
```

## Próximos passos (a definir)

- iPhone / ícone na tela inicial: hospedar apenas o arquivo HTML (ex.: GitHub Pages) com funcionamento offline. Os dados continuariam só no aparelho; a hospedagem serve apenas para entregar o arquivo.
- Senha para abrir o app e cópia de segurança criptografada.

- Ajustar campos e importação ao modelo da planilha atual.
- Campos do prontuário conforme a profissão (anamnese, hipótese diagnóstica, plano terapêutico etc.).
- Perfis de acesso (ex.: secretária sem acesso ao prontuário).
- Lembretes por WhatsApp/e-mail; integração com Google Agenda; recibos em PDF.
