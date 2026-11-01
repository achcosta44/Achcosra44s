# Consultório – pacientes, agenda, pagamentos e prontuário

Aplicativo web hospedado na Cloudflare, com importação/exportação de planilhas Excel.

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
```

## Próximos passos (a definir)

- Ajustar campos e importação ao modelo da planilha atual.
- Campos do prontuário conforme a profissão (anamnese, hipótese diagnóstica, plano terapêutico etc.).
- Perfis de acesso (ex.: secretária sem acesso ao prontuário).
- Lembretes por WhatsApp/e-mail; integração com Google Agenda; recibos em PDF.
