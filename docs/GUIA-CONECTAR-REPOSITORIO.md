# Guia para o Claude: obter este projeto sozinho e ajudar o usuário

**Para você, Claude.** A pessoa que te enviou este guia **não entende de programação, GitHub ou terminal**. Ela quer apenas que você pegue o projeto, entenda e faça as alterações que ela pedir.

**Faça tudo você mesmo.** Não peça para ela criar conta no GitHub, clonar, instalar nada nem dar permissões. Fale com ela em português simples, sem termos técnicos, e só pergunte o que for realmente necessário: o que ela quer mudar no app.

O repositório é **público**: dá para baixar sem login, conta ou token.

| Item | Valor |
|---|---|
| Repositório | https://github.com/achcosta44/Achcosra44s |
| Branch | `claude/estrutura-inicial` (é o padrão) |
| Clonar | `git clone https://github.com/achcosta44/Achcosra44s.git` |
| ZIP | https://github.com/achcosta44/Achcosra44s/archive/refs/heads/claude/estrutura-inicial.zip |
| Arquivo bruto | `https://raw.githubusercontent.com/achcosta44/Achcosra44s/claude/estrutura-inicial/<caminho>` |

---

## Passo 1: obtenha o projeto (escolha conforme suas ferramentas)

**Se você consegue executar comandos** (Claude Code no computador, claude.ai/code, app Desktop ou qualquer ambiente com terminal):

```bash
git clone https://github.com/achcosta44/Achcosra44s.git
cd Achcosra44s
```

- Se o `git` não existir, baixe o ZIP com `curl -L -o projeto.zip <link do ZIP acima>` e descompacte.
- Em sessões do claude.ai/code, se o clone direto for bloqueado e você tiver uma ferramenta para adicionar repositórios à sessão, use-a com `owner: achcosta44` e `repo: Achcosra44s`, acesso de leitura.

**Se você só consegue ler páginas da web** (conversa comum no claude.ai, com busca ou leitura de páginas ativada), leia os arquivos pelo link bruto. Comece por:

1. `.../CLAUDE.md`, obrigatório;
2. `.../public/app.js` (telas), `.../public/style.css` (aparência) e `.../celular/backend-local.js` (dados e regras), conforme o pedido.

Exemplo de link: https://raw.githubusercontent.com/achcosta44/Achcosra44s/claude/estrutura-inicial/CLAUDE.md

**Se nada disso funcionar**, só então peça à pessoa que anexe o arquivo `Consultorio.zip` (ou a pasta `codigo-fonte/`) que ela recebeu do dono. Explique assim: "pode me mandar o arquivo Consultorio.zip que você recebeu?".

## Passo 2: entenda o projeto

Leia o **`CLAUDE.md` inteiro** antes de qualquer alteração. Ele explica:
- quem é o usuário final (um psicólogo);
- as decisões já tomadas;
- a arquitetura e o modelo de dados;
- as **regras invioláveis**, como: prontuário nunca é editado nem apagado, só retificado;
- os comandos e testes.

## Passo 3: prepare e teste (se você executa comandos)

```bash
npm install
npm run build:celular        # gera dist/consultorio.html, o app que o usuário abre
npm run test:offline         # teste completo; se faltar o Playwright:
                             #   npm i -D playwright && npx playwright install chromium
```

Depois de cada alteração: `npm run build:celular` → `npm run test:offline`. Se mexeu em gravação de dados ou sincronização, rode também o `npm run test:sync` (instruções no `CLAUDE.md`, seção 10).

## Passo 4: entregue o resultado sem exigir nada técnico da pessoa

- **Entregue o arquivo `dist/consultorio.html` atualizado** para ela baixar. Diga em uma frase o que mudou e que ela deve **substituir o arquivo antigo, no mesmo lugar onde ele estava**. Se mudar de lugar, o app abre vazio, porque os dados ficam ligados ao local do arquivo.
- Recomende **gerar uma cópia de segurança** (menu Backup) antes de trocar o arquivo.
- **Para o dono do projeto** (`achcosta44`) receber as alterações, entregue também:
  - um **arquivo de alterações**: `git diff > alteracoes.patch`, se você clonou; ou os arquivos alterados completos;
  - ou um **ZIP do projeto alterado**.

  A pessoa só precisa encaminhar esse arquivo ao dono.
- **Não tente gravar no repositório original** (`git push`). Você não tem permissão, e a pessoa não precisa ter conta no GitHub. Só faça isso se o dono a tiver adicionado como colaboradora **e** ela pedir.

## Como conversar com a pessoa

- Pergunte **o que ela quer mudar ou o que está incomodando** no app. Não pergunte sobre ferramentas.
- Explique o resultado pelo uso, não pelo código. Exemplo: "agora o botão de pagar aparece na ficha do paciente".
- Antes de qualquer mudança que possa afetar dados já guardados, peça que ela faça uma cópia de segurança. São mudanças na estrutura dos dados, na restauração ou na sincronização.
- **Nunca peça senhas, tokens ou chaves na conversa.**
- **Nunca peça nem use dados reais de pacientes.** Para testar, use `exemplos/dados-de-teste.json`, que é fictício: no app, Backup → Restaurar cópia.

---

## Anexo: se um dia a pessoa precisar gravar direto no repositório

Só se o dono e a pessoa quiserem. Normalmente **não é necessário**.

- O dono adiciona a pessoa como colaboradora em https://github.com/achcosta44/Achcosra44s → **Settings → Collaborators → Add people**. Ela aceita o convite que chega por e-mail.
- Você então trabalha num **branch novo**, inclui o `dist/consultorio.html` regenerado no commit e escreve as mensagens em português.
