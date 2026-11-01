# Consultório — guia do projeto para o Claude

Leia este arquivo inteiro antes de mexer no código. Ele resume o que o app faz, para quem é, as decisões já tomadas com o usuário, a arquitetura e as regras que não podem ser quebradas.

---

## 1. Para quem é e o que o usuário espera

- **Usuário:** psicólogo clínico, consultório particular. Não é programador. Usa o app num **notebook** e num **celular**.
- **Idioma:** tudo em **português do Brasil**: interface, mensagens, comentários e commits.
- **Estilo pedido:** "intuitivo e esteticamente limpo, sem muita frescura". Interface sóbria, poucas cores, sem animações ou enfeites, botões claros, termos do dia a dia do consultório.
- **Funções:** pacientes, prontuário (registro documental do psicólogo), agenda/horários, pagamentos, importação e exportação em Excel, cópia de segurança e sincronização entre os dois aparelhos.
- **Dados sensíveis:** são dados de saúde, sensíveis pela LGPD (art. 5º, II, e art. 11). Privacidade e integridade do prontuário são requisitos, não opcionais.

## 2. Histórico de decisões (não refazer sem o usuário pedir)

1. Começou como app na Cloudflare, com servidor, banco D1 e login por Cloudflare Access (pastas `src/`, `migrations/`, `wrangler.jsonc` da raiz).
2. O usuário pediu para **não depender de nuvem**. O app virou um **arquivo HTML único** (`dist/consultorio.html`), que roda no navegador e guarda tudo no **IndexedDB** do próprio aparelho. **Este é o app em uso.**
3. O prontuário foi adaptado à psicologia: tipos de registro conforme a **Resolução CFP nº 001/2009**, que trata do registro documental.
4. Interface ajustada para celular: telas com menos de 700 px de largura. O notebook continua igual.
5. O usuário quer os dois aparelhos **sempre sincronizados**. Entre as opções apresentadas, escolheu a **A: sincronização pela internet com criptografia ponta a ponta**. O servidor (`sync/`) só guarda dados cifrados.
6. **Pendente:** publicar o servidor `sync/` na conta Cloudflare do usuário. Isso exige um API Token com permissão de edição para Workers, D1 e R2. O usuário questionou se publicar era necessário; foi explicado que sim, como ponto de encontro entre os aparelhos. A alternativa sem publicar seria sincronizar pelo Wi-Fi local, com o notebook como servidor (opção B, não implementada).

> A versão Cloudflare "completa" (`src/`) **não é usada hoje** e está defasada: não tem sincronização, mas já tem o tipo de registro do prontuário. Não confundir com `sync/`. Só mexa nela se o usuário pedir.

## 3. Arquitetura

```
 ┌──────────────── dist/consultorio.html (arquivo único, gerado) ────────────────┐
 │  public/index.html + public/style.css + public/app.js   ← telas (JS puro)      │
 │  celular/backend-local.js  ← "servidor" local: mesmas rotas /api/* sobre        │
 │                              IndexedDB + módulo de sincronização               │
 │  SheetJS (xlsx.mini) embutido, avaliado só quando a tela de Backup usa         │
 └───────────────────────────────────────────────────────────────────────────────┘
          │ (opcional) dados JÁ CRIPTOGRAFADOS, via HTTPS
          ▼
 sync/ — Cloudflare Worker "cego" + D1 (fila de mudanças) + R2 (anexos cifrados)
```

- As telas (`public/app.js`) chamam `api(metodo, caminho, corpo)`. Se existe `window.consultorioBackend`, que é o modo arquivo único, a chamada é atendida localmente por `celular/backend-local.js`. Caso contrário, vira `fetch` para o servidor de `src/`. **As duas implementações expõem as mesmas rotas e formatos de resposta.**
- Não há framework nem etapa de build para o JS. `scripts/build-celular.mjs` só junta os arquivos num HTML.

## 4. Mapa de arquivos

| Caminho | Papel |
|---|---|
| `public/index.html` | Esqueleto: topo, menu (Agenda, Pacientes, Financeiro, Backup), `<dialog>` de formulários, aviso. |
| `public/style.css` | Estilo único, com claro/escuro por `prefers-color-scheme`. Bloco `@media (max-width: 700px)` = celular: menu fixo embaixo, formulário em tela cheia, campos de 16 px, tabelas viram cartões, agenda de um dia por vez. |
| `public/app.js` | Todas as telas, o roteador por hash (`#/agenda`, `#/pacientes`, `#/paciente/:id`, `#/financeiro`, `#/excel`, `#/auditoria`), formulários, Excel e a interface de sincronização. |
| `celular/backend-local.js` | Banco local (IndexedDB), validação, regras de negócio, rotas `/api/*`, cópia de segurança e restauração, **sincronização criptografada**. Expõe `window.consultorioBackend`. |
| `scripts/build-celular.mjs` | Gera `dist/consultorio.html`. Com `SYNC_URL=...`, embute o endereço padrão do servidor de sincronização. |
| `dist/consultorio.html` | **Artefato entregue ao usuário.** Fica versionado. Regenerar após qualquer mudança em `public/` ou `celular/`. |
| `sync/src/index.ts`, `sync/migrations/`, `sync/wrangler.jsonc` | Servidor de sincronização (Worker + D1 + R2). |
| `scripts/gerar-dados-teste.mjs` → `exemplos/dados-de-teste.json` | Dados fictícios no formato de cópia de segurança: 11 pacientes a R$ 100 e R$ 80, 87 sessões, prontuário e pagamentos. Carregar em Backup → Restaurar cópia. |
| `tests/fluxo-offline.cjs`, `tests/sincronizacao.cjs` | Testes ponta a ponta com Playwright (seção 10). |
| `src/`, `migrations/`, `wrangler.jsonc` (raiz) | Versão servidor completa, com login Cloudflare Access. **Não está em uso** (ver seção 2). |
| `README.md` | Instruções para humanos: rodar, publicar, LGPD. |
| `docs/GUIA-CONECTAR-REPOSITORIO.md` | Como ajudar uma nova pessoa a acessar o repositório (claude.ai/code, Claude Code local ou chat) e obter permissão de gravação. |

## 5. Modelo de dados (IndexedDB `consultorio`, versão 2)

Stores de dados (`keyPath: "id"`): `pacientes`, `agendamentos`, `pagamentos`, `evolucoes` (prontuário), `anexos`, `auditoria`. Stores internas: `config` (`keyPath: "chave"`) e `pendentes` (fila de sincronização, `keyPath: "chave"` = `"<store>:<id>"`).

- **IDs:** inteiros únicos entre aparelhos, gerados por `novoId()` como segundos × 10⁶ + aleatório, sempre abaixo de 2⁵³. Dados antigos podem ter IDs pequenos (1, 2, 3…). Nunca voltar ao `autoIncrement` puro, porque dois aparelhos colidiriam.
- **`_rev`:** carimbo de versão em milissegundos, gravado em toda inclusão ou alteração. Decide conflitos de sincronização.
- **Datas:**
  - de atendimento: `AAAA-MM-DD`;
  - de sessão: `AAAA-MM-DDTHH:MM`, horário local;
  - carimbos `criado_em` e `atualizado_em`: UTC no formato `AAAA-MM-DD HH:MM:SS`.
- **Dinheiro:** sempre em **centavos** (`valor_centavos`, `valor_sessao_centavos`). A entrada aceita "150", "150,00" e "1.500,50".
- **Campos principais:**
  - `pacientes`: nome, cpf (só dígitos, único), data_nascimento, telefone, email, endereco, contato_emergencia, convenio, valor_sessao_centavos, observacoes, ativo (0/1).
  - `agendamentos`: paciente_id, inicio, duracao_min (padrão 50), status (`agendado | confirmado | realizado | faltou | cancelado`), observacoes.
  - `pagamentos`: paciente_id, agendamento_id (opcional), data, valor_centavos, forma (`pix | dinheiro | cartao_credito | cartao_debito | transferencia | convenio | outro`), status (`pago | pendente | cancelado`), referencia, observacoes.
  - `evolucoes`: paciente_id, agendamento_id, **tipo** (`evolucao | demanda | encaminhamento | encerramento | documento | outro`), data_atendimento, texto, retifica_id, autor_email, criado_em.
  - `anexos`: metadados + `conteudo` (Blob) + sha256. O limite é 20 MB por arquivo.
  - `auditoria`: quando, usuario, acao, entidade, entidade_id, detalhe.
- **`config`:** `ultimo_backup`, `sync` (servidor, código do cofre, token, **CryptoKey não exportável**, id do dispositivo), `sync_seq` (cursor do servidor) e `sync_ultima`.
- **Formato da cópia de segurança:** `{ formato: "consultorio-backup", versao: 1, gerado_em, dados: { <store>: [...] } }`. Os anexos vão com `conteudo_base64`. Qualquer mudança no formato precisa continuar lendo cópias antigas.

## 6. Regras de negócio que NÃO podem ser quebradas

1. **Prontuário imutável.** Um registro (`evolucoes`) ou anexo nunca é editado nem excluído. Correção = novo registro com `retifica_id` apontando para o original. Os dois continuam visíveis e o original aparece como "retificada". Exigência ética e legal: guarda mínima de 5 anos (Res. CFP 001/2009).
2. **Paciente nunca é excluído**, só inativado (`ativo = 0`), pelo dever de guarda do prontuário.
3. **Auditoria** registra criação, alteração, leitura de prontuário e anexo, exportação, importação, cópia, restauração e ativação da sincronização. Ela não é editada nem apagada.
4. **Conflito de horário:** ao agendar ou remarcar, o sistema avisa sobre sobreposição com sessões que não estejam canceladas ou marcadas como falta. O usuário pode confirmar mesmo assim (`ignorar_conflitos`).
5. **Recorrência semanal:** de 1 a 52 sessões. Domingo não aparece na agenda; num domingo, a agenda abre na semana seguinte.
6. **Restaurar cópia** substitui tudo e é **bloqueado com a sincronização ativa**, pois apagaria dados nos outros aparelhos.
7. **Privacidade:** nenhum dado de paciente sai do aparelho sem criptografia. Nunca adicionar telemetria, CDN obrigatória ou chamada externa com dados. O app precisa funcionar 100% offline.
8. **Nunca versionar dados reais.** O `.gitignore` já exclui `*.xlsx`, `backup-*.sql` e `.dev.vars`. Dados de teste devem ser fictícios.

## 7. Rotas `/api` (iguais em `celular/backend-local.js` e `src/api.ts`)

| Método e rota | Uso |
|---|---|
| `GET /api/pacientes?busca=&inativos=1` · `POST /api/pacientes` | listar e criar |
| `GET` / `PUT /api/pacientes/:id` | ficha e edição (`PUT` mescla com o registro atual) |
| `GET` / `POST /api/pacientes/:id/evolucoes` | prontuário (`POST` com `tipo`, `data_atendimento`, `texto`, `retifica_id?`) |
| `GET` / `POST /api/pacientes/:id/anexos` | anexos (`POST` com `FormData`: `arquivo`, `descricao`) |
| `GET /api/agendamentos?de=&ate=&paciente_id=` · `POST` · `PUT /:id` | agenda (`POST` aceita `repetir_semanas`; responde 409 com `conflito: true`) |
| `GET /api/pagamentos?de=&ate=&paciente_id=&status=` · `POST` · `PUT /:id` | pagamentos |
| `GET /api/resumo?mes=AAAA-MM` | totais do mês e "sessões realizadas sem pagamento" |
| `GET /api/exportar?prontuario=1` · `POST /api/importar` | Excel (a conversão .xlsx acontece no navegador) |
| `GET /api/auditoria?limite=` | histórico |

Fora das rotas, no modo local: `consultorioBackend.baixarAnexo`, `gerarBackup`, `restaurar`, `protegerArmazenamento`, `ultimoBackup` e `sync.{info, criar, conectar, desconectar, agora}`.

## 8. Sincronização (opção A, criptografia ponta a ponta)

- **Cofre:** código `XXXX-XXXX-XXXX` (alfabeto sem 0, 1, I e O) mais a **senha do usuário**, com no mínimo 10 caracteres.
- **Derivação:** `PBKDF2-SHA256(senha, sal = "consultorio-sync:" + cofre, 600.000 iterações)` gera 512 bits.
  - Os primeiros 256 bits são a chave **AES-256-GCM**, que nunca sai do aparelho.
  - Os últimos 256 bits são o **token** enviado ao servidor. O servidor guarda só o SHA-256 dele.
- **Cada alteração local** grava o registro e uma entrada em `pendentes` **na mesma transação** (`salvarRegistro`). A sincronização dispara 1,5 s depois, a cada 30 s, ao voltar a conexão e ao reabrir a aba.
- **Envio:** cada registro pendente é cifrado como `{ s: store, r: registro }` (IV de 12 bytes + texto cifrado, em base64), em lotes de 50, para `POST /v1/mudancas`. O conteúdo dos anexos vai cifrado separadamente por `PUT /v1/arquivos/:id`.
- **Recebimento:** `GET /v1/mudancas?desde=<seq>`. O app decifra cada item e aplica se `_rev` recebido for maior que `_rev` local, ou seja, **vence a última alteração**. Prontuário e auditoria só recebem inclusões, então não há perda.
- **Anexos recebidos** chegam só com os metadados. O arquivo é baixado e decifrado quando aberto (`baixarConteudoRemoto`) ou ao gerar uma cópia de segurança.
- **Primeiro aparelho** ("Ativar"): cria o cofre e marca todos os dados existentes como pendentes.
- **Demais aparelhos** ("Conectar"): validam as credenciais, **apagam os dados locais** (antes baixam uma cópia automaticamente, se houver dados) e recebem tudo.
- **Interface:**
  - indicador no topo: Sincronizado, Sincronizando…, Offline ou Erro;
  - seção em Backup, para ativar, conectar, ver o código, sincronizar agora e desconectar;
  - eventos `consultorio:sync` e `consultorio:dados-recebidos` (este último atualiza a tela aberta sem perder a rolagem, exceto com um formulário aberto).
- **Servidor `sync/`:**
  - rotas: `POST /v1/cofres` (cria), `GET /v1/cofres/eu`, `POST` e `GET /v1/mudancas`, `PUT` e `GET /v1/arquivos/:id`;
  - autenticação: `Authorization: Bearer <cofre>:<token>`;
  - CORS `*`, porque o app roda de `file://`, com origem `null`;
  - `MAX_COFRES` (padrão 2) impede terceiros de usarem o servidor;
  - limites: 1 MB por item, 200 itens por lote e 25 MB por arquivo.
- **Limitações conhecidas:**
  - **sem a senha, não há recuperação** dos dados do servidor;
  - a fila `mudancas` só cresce, sem compactação, mas o volume de um consultório é pequeno;
  - não há exclusões a sincronizar, porque o app não exclui registros.

## 9. Interface: convenções

- **Formulários:** sempre via `formulario(titulo, campos, valores, aoSalvar)`. Tipos de campo: text, date, datetime-local, number, money, select, textarea, file, password e hidden. Erros lançados em `aoSalvar` aparecem dentro do diálogo.
- **Mensagens rápidas:** `avisar(msg, falha?)`. Para conflitos de agenda, use `salvarComConflito()`.
- **Navegação:** `rotear()` coloca as trocas de tela **em fila**, para evitar uma tela lenta desenhando por cima de outra. `atualizarTela()` redesenha a tela atual mantendo a rolagem.
- **Desenho das telas:** primeiro busca os dados, depois troca o `innerHTML` de uma vez. "Carregando…" só aparece se passar de 250 ms.
- **Texto do usuário:** sempre escapar com `esc()` antes de inserir no HTML.
- **Tabelas:** viram cartões no celular automaticamente. Um `MutationObserver` copia o cabeçalho para `data-rotulo` de cada célula. Basta usar `<table>` com `<thead>`.
- **Celular:**
  - no `<dialog>`, não focar campo automaticamente em telas de toque;
  - campos com 16 px, para o iPhone não dar zoom;
  - mudar a situação de uma sessão atualiza só o cartão.
- **Mudanças só de celular** vão dentro do `@media (max-width: 700px)`, para **não afetar o notebook**.

## 10. Comandos

```bash
npm install                    # wrangler, typescript, tipos, SheetJS
npm run build:celular          # gera dist/consultorio.html (SYNC_URL=https://... para embutir o servidor)
npm run dados-teste            # regenera exemplos/dados-de-teste.json (datas relativas a hoje)
npm run typecheck              # TypeScript de src/ e sync/src/

npm run sync:dev               # servidor de sincronização local em http://localhost:8788
npm run sync:deploy            # publica sync/ (exige d1 create, r2 bucket create e migrations --remote antes; ver README)

npm run test:offline           # fluxo completo sem internet, celular simulado
npm run test:sync              # notebook + celular sincronizando (precisa de npm run sync:dev rodando)
```

- Os testes exigem Playwright com Chromium: `npm i -D playwright && npx playwright install chromium`.
- `test:sync` cria um cofre. Com `MAX_COFRES=2`, limpe o banco local entre execuções: `cd sync && npx wrangler d1 execute consultorio-sync --local --command "DELETE FROM mudancas; DELETE FROM cofres;"`.
- **Rotina obrigatória depois de qualquer mudança:** `npm run build:celular` → `npm run test:offline` → `npm run test:sync`, se mexeu em sincronização ou persistência → conferir visualmente em largura de notebook e de celular.

## 11. Receitas de mudanças comuns

- **Novo campo no paciente:**
  - `camposPaciente()` em `celular/backend-local.js` e em `src/api.ts`;
  - `CAMPOS_PACIENTE` e `abaDados()` em `public/app.js`;
  - `COLUNAS.Pacientes` (Excel) em `public/app.js`;
  - nova migração em `migrations/`, para a versão servidor;
  - rebuild.
- **Novo tipo de registro no prontuário:** `TIPOS_REGISTRO` em `public/app.js`, `celular/backend-local.js` e `src/validacao.ts`, mais uma migração atualizando o `CHECK`.
- **Nova store no IndexedDB:** subir a versão em `indexedDB.open("consultorio", N)`, criar a store dentro de `if (ev.oldVersion < N)` e adicioná-la a `STORES`, para entrar na cópia de segurança e na sincronização. **Nunca apagar nem renomear stores existentes**: o usuário tem dados reais nelas.
- **Mudar a cópia de segurança:** manter a leitura de `versao: 1`.
- **Mexer na sincronização:** registros antigos podem não ter `_rev` (trate como 0). Não mude derivação, sal ou formato de cifra sem uma migração, senão aparelhos já conectados deixam de decifrar.

## 12. Pendências e ideias combinadas

- [ ] Publicar `sync/` na Cloudflare do usuário e gerar `dist/consultorio.html` com `SYNC_URL` embutido.
- [ ] iPhone: o iOS não guarda dados de HTML aberto pelo app Arquivos. Solução proposta: hospedar só o arquivo (por exemplo, GitHub Pages) com funcionamento offline.
- [ ] Senha para abrir o app e cópia de segurança criptografada.
- [ ] Ajustar campos e importação ao modelo da planilha antiga do usuário, se ele enviar.
- [ ] Ideias citadas, ainda não pedidas: recibos em PDF, lembretes por WhatsApp e e-mail, perfis (ex.: secretária sem acesso ao prontuário).

## 13. Ao conversar com o usuário

- Explique em linguagem simples, sem jargão técnico. Diga o que muda para ele no uso diário.
- Antes de algo que possa apagar ou substituir dados (restaurar, conectar a sincronização, mudar a estrutura do banco), avise e sugira gerar uma cópia de segurança.
- Entregue sempre o `dist/consultorio.html` atualizado ao final de uma mudança.
- Nunca peça para colar senhas ou tokens no chat.
