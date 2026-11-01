# Guia para o Claude: ajudar o usuário a se conectar a este repositório

**Para quem é este arquivo:** para você, Claude, que vai ajudar uma pessoa a acessar e editar o app "Consultório". A pessoa recebeu este guia do dono do projeto. Ela pode **não ser programadora**. Conduza passo a passo, em português simples, **um passo por vez**, e confirme que cada passo deu certo antes de seguir.

---

## Dados do projeto

| Item | Valor |
|---|---|
| Repositório | `achcosta44/Achcosra44s`: https://github.com/achcosta44/Achcosra44s |
| Visibilidade | **Público**: qualquer pessoa pode ler e clonar. Para **gravar** é preciso ser colaborador (ou usar fork + pull request). |
| Branch principal | `claude/estrutura-inicial` (é o branch padrão do repositório) |
| Dono | usuário do GitHub `achcosta44` |
| Documento técnico | `CLAUDE.md`, na raiz. **Leia-o inteiro antes de alterar qualquer coisa.** |

O repositório **não contém dados de pacientes nem senhas**. Os dados do app ficam no navegador de cada aparelho.

---

## Passo 0: descubra a situação da pessoa (pergunte antes de tudo)

Faça estas perguntas, de forma simples:

1. **Onde você está falando comigo?**
   - (a) em claude.ai/code ou na aba **Code** do app Claude;
   - (b) no Claude Code instalado no computador (terminal, app Desktop ou editor);
   - (c) numa conversa comum do claude.ai.
2. **Você tem conta no GitHub?** Se tiver, qual é o nome de usuário?
3. **Você vai só olhar e testar, ou vai fazer alterações para devolver ao dono?**

Com as respostas, siga o caminho A, B ou C. Se a pessoa for fazer alterações, siga também a seção "Permissão para gravar".

---

## Caminho A: Claude Code na web (claude.ai/code ou aba Code do app)

Exige plano **Pro, Max, Ultra, Team** ou **Enterprise** com acesso a sessões na nuvem.

1. A pessoa cria uma conta gratuita no GitHub (github.com), se ainda não tiver.
2. Em **claude.ai/code**, ela conecta o GitHub quando o Claude pedir. Na primeira vez, aparece a autorização do **Claude GitHub App** (https://github.com/apps/claude). Ela autoriza.
3. Ela inicia uma sessão escolhendo o repositório **`achcosta44/Achcosra44s`**. Por ser público, ele é acessível mesmo sem o app instalado nele. Se não aparecer na lista, ela pode colar o endereço https://github.com/achcosta44/Achcosra44s na conversa e pedir para o Claude adicioná-lo.
4. Pronto: a sessão já tem o código clonado. **Leia o `CLAUDE.md`.**

O ambiente padrão dessas sessões (com acesso à rede "Trusted") permite `npm install`. O Chromium e o Playwright costumam vir pré-instalados, então `npm run test:offline` deve funcionar direto.

Documentação oficial: https://code.claude.com/docs/en/claude-code-on-the-web

---

## Caminho B: Claude Code no computador da pessoa

Pré-requisitos (ajude a instalar se faltar):
- **Git**: https://git-scm.com
- **Node.js 20 ou superior**, versão LTS: https://nodejs.org

Comandos (rode você mesmo, se tiver acesso ao terminal, ou passe à pessoa um de cada vez):

```bash
git clone https://github.com/achcosta44/Achcosra44s.git
cd Achcosra44s
npm install
npm run build:celular          # gera dist/consultorio.html
```

Para os testes automáticos:

```bash
npm i -D playwright && npx playwright install chromium
npm run test:offline
```

Depois, abra o Claude Code dentro da pasta `Achcosra44s`. O `CLAUDE.md` é carregado automaticamente.

---

## Caminho C: conversa comum no claude.ai (sem Claude Code)

Neste modo você **não executa comandos, não roda testes e não grava no GitHub**. Você só lê os arquivos e devolve versões editadas.

1. A pessoa baixa o código: em https://github.com/achcosta44/Achcosra44s, botão **Code → Download ZIP**. Outra opção é usar a pasta `codigo-fonte/` do `Consultorio.zip`, se recebeu do dono.
2. Ela anexa na conversa:
   - `CLAUDE.md`, sempre;
   - os arquivos que vão mudar: na maioria das vezes `public/app.js`, `public/style.css` e `celular/backend-local.js`.
   - Se o claude.ai dela tiver integração com o GitHub, ela também pode adicionar o repositório por ali.
3. Você devolve os arquivos completos alterados. Lembre a pessoa: depois de trocar os arquivos, alguém precisa rodar `npm run build:celular` para gerar o novo `dist/consultorio.html`. Sem isso, o app que o usuário abre não muda.

Recomende o Caminho A ou B se a pessoa for fazer mais do que ajustes pequenos.

---

## Permissão para gravar (enviar alterações ao repositório)

Ler é livre. Para **gravar**, há duas opções:

1. **Colaborador (mais simples):** o dono (`achcosta44`) entra em https://github.com/achcosta44/Achcosra44s → **Settings → Collaborators → Add people** e informa o usuário do GitHub da pessoa. Ela recebe um convite por e-mail e precisa **aceitá-lo**. Depois disso, o Claude dela pode fazer `push` para um branch novo.
2. **Fork + pull request (sem depender do dono para começar):** a pessoa cria uma cópia (**Fork**) no GitHub dela, trabalha nela e, no fim, abre um **pull request** para `achcosta44/Achcosra44s`, que o dono aprova.

**Regras ao gravar:**
- Trabalhe num **branch novo**, por exemplo `ajuste-agenda`. Não grave direto em `claude/estrutura-inicial` sem o dono pedir.
- Antes de enviar, siga a rotina: `npm run build:celular`, depois `npm run test:offline`, depois `npm run test:sync` se mexeu em sincronização ou em gravação de dados (ver `CLAUDE.md`, seção 10).
- Inclua o `dist/consultorio.html` regenerado no commit. É o arquivo que o usuário final usa.
- Mensagens de commit em português.

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| O repositório não aparece na lista do claude.ai/code | Cole o endereço https://github.com/achcosta44/Achcosra44s na conversa e peça para adicioná-lo. Ou instale o Claude GitHub App em https://github.com/apps/claude. |
| `push` recusado (403 / permission denied) | A pessoa ainda não é colaboradora, ou não aceitou o convite. Use a seção "Permissão para gravar" ou trabalhe com fork. |
| `npm install` falha por rede | Na nuvem: verifique o acesso à rede do ambiente. No computador: verifique a internet e o proxy. |
| `npm run test:sync` falha com "Limite de cofres" | Limpe o banco local do servidor de teste (comando no `CLAUDE.md`, seção 10). |
| O app abre vazio depois de atualizar | Isso não é erro do código: os dados ficam no navegador e no caminho do arquivo. Mova o novo `consultorio.html` para o mesmo local do anterior, ou restaure a cópia de segurança. |

---

## Cuidados que você deve manter

- **Nunca peça para colar senhas, tokens ou chaves na conversa.** Credenciais (por exemplo, o token da Cloudflare) vão nas configurações do ambiente ou do sistema, nunca no chat.
- **Nunca coloque dados reais de pacientes** no repositório, em commits ou em mensagens. Para testar, use `exemplos/dados-de-teste.json`, que é fictício.
- Antes de qualquer alteração que possa apagar ou substituir dados do app (estrutura do banco, restauração, sincronização), avise e recomende uma cópia de segurança.
- Respeite as regras invioláveis do `CLAUDE.md` (seção 6), especialmente: **prontuário não se edita nem se apaga, só se retifica.**
