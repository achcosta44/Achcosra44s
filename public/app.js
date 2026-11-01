// Interface do consultório: JavaScript puro, sem build.
// Rotas por hash: #/agenda, #/pacientes, #/paciente/:id, #/financeiro, #/excel, #/auditoria

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const conteudo = $("#conteudo");

// ------------------------------------------------------------ utilidades

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");
const isoData = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => isoData(new Date());
const somarDias = (iso, n) => {
  const [a, m, d] = iso.split("-").map(Number);
  return isoData(new Date(a, m - 1, d + n));
};
const segundaDaSemana = (iso) => {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  const dia = (dt.getDay() + 6) % 7; // segunda = 0
  return somarDias(iso, -dia);
};
const fmtData = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const fmtDataHora = (iso) => (iso ? `${fmtData(iso)} ${iso.slice(11, 16)}` : "");
const fmtUtc = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("pt-BR") : "");
const moeda = (centavos) =>
  centavos == null ? "" : (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const reaisInput = (centavos) => (centavos == null ? "" : (centavos / 100).toFixed(2).replace(".", ","));
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const STATUS_AG = { agendado: "Agendado", confirmado: "Confirmado", realizado: "Realizado", faltou: "Faltou", cancelado: "Cancelado" };
const FORMAS = {
  pix: "PIX", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito",
  transferencia: "Transferência", convenio: "Convênio", outro: "Outro",
};
const STATUS_PAG = { pago: "Pago", pendente: "Pendente", cancelado: "Cancelado" };

function avisar(msg, falha = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = "aviso visivel" + (falha ? " falha" : "");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.className = "aviso"), falha ? 6000 : 2500);
}

async function api(metodo, caminho, corpo) {
  const opts = { method: metodo, headers: {}, credentials: "same-origin" };
  if (corpo instanceof FormData) opts.body = corpo;
  else if (corpo !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(corpo);
  }
  const r = await fetch(caminho, opts);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(dados.erro || `Erro ${r.status}`);
    e.status = r.status;
    e.dados = dados;
    throw e;
  }
  return dados;
}

let cachePacientes = null;
async function pacientesAtivos(forcar = false) {
  if (!cachePacientes || forcar) cachePacientes = await api("GET", "/api/pacientes");
  return cachePacientes;
}
const opcoesPacientes = (lista) => Object.fromEntries(lista.map((p) => [p.id, p.nome]));

// ------------------------------------------------------------ formulário em diálogo

/**
 * campos: [{ nome, rotulo, tipo: text|date|datetime-local|number|textarea|select|money|file, opcoes, obrigatorio, largo }]
 * aoSalvar(valores) -> Promise; se lançar erro, ele aparece no diálogo.
 */
function formulario(titulo, campos, valores, aoSalvar) {
  const dlg = $("#dialogo");
  $("#dialogo-titulo").textContent = titulo;
  const erro = $("#dialogo-erro");
  erro.hidden = true;
  $("#dialogo-campos").innerHTML = `<div class="campos">${campos
    .map((c) => {
      const v = valores[c.nome] ?? "";
      const req = c.obrigatorio ? "required" : "";
      const id = `f-${c.nome}`;
      if (c.tipo === "hidden") return `<input type="hidden" name="${c.nome}" value="${esc(v)}">`;
      let input;
      if (c.tipo === "textarea") input = `<textarea id="${id}" name="${c.nome}" ${req}>${esc(v)}</textarea>`;
      else if (c.tipo === "select")
        input = `<select id="${id}" name="${c.nome}" ${req}>${c.obrigatorio ? "" : '<option value=""></option>'}${Object.entries(c.opcoes)
          .map(([k, r]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(r)}</option>`)
          .join("")}</select>`;
      else if (c.tipo === "money")
        input = `<input id="${id}" name="${c.nome}" inputmode="decimal" placeholder="0,00" value="${esc(v)}" ${req}>`;
      else if (c.tipo === "file") input = `<input id="${id}" name="${c.nome}" type="file" ${req}>`;
      else input = `<input id="${id}" name="${c.nome}" type="${c.tipo || "text"}" value="${esc(v)}" ${req} ${c.extra || ""}>`;
      return `<div class="campo ${c.largo || c.tipo === "textarea" ? "largo" : ""}"><label for="${id}">${esc(c.rotulo)}${c.obrigatorio ? " *" : ""}</label>${input}</div>`;
    })
    .join("")}</div>`;

  const form = $("#dialogo-form");
  const salvar = $("#dialogo-salvar");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const temArquivo = campos.some((c) => c.tipo === "file");
    const dados = temArquivo ? fd : Object.fromEntries(campos.map((c) => [c.nome, fd.get(c.nome)]));
    salvar.disabled = true;
    try {
      await aoSalvar(dados);
      dlg.close();
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    } finally {
      salvar.disabled = false;
    }
  };
  $("#dialogo-cancelar").onclick = () => dlg.close();
  dlg.showModal();
  $("input, select, textarea", dlg)?.focus();
}

/** Cria agendamento; em caso de conflito pergunta se quer manter mesmo assim. */
async function salvarComConflito(metodo, caminho, dados) {
  try {
    return await api(metodo, caminho, dados);
  } catch (e) {
    if (e.status === 409 && e.dados?.conflito && confirm(`${e.message}.\n\nAgendar mesmo assim?`)) {
      return api(metodo, caminho, { ...dados, ignorar_conflitos: true });
    }
    throw e;
  }
}

// ------------------------------------------------------------ formulários reutilizáveis

const CAMPOS_PACIENTE = [
  { nome: "nome", rotulo: "Nome completo", obrigatorio: true, largo: true },
  { nome: "cpf", rotulo: "CPF" },
  { nome: "data_nascimento", rotulo: "Nascimento", tipo: "date" },
  { nome: "telefone", rotulo: "Telefone" },
  { nome: "email", rotulo: "E-mail", tipo: "email" },
  { nome: "convenio", rotulo: "Convênio" },
  { nome: "valor_sessao", rotulo: "Valor da sessão (R$)", tipo: "money" },
  { nome: "endereco", rotulo: "Endereço", largo: true },
  { nome: "contato_emergencia", rotulo: "Contato de emergência", largo: true },
  { nome: "observacoes", rotulo: "Observações administrativas", tipo: "textarea" },
];

function novoPaciente(aoCriar) {
  formulario("Novo paciente", CAMPOS_PACIENTE, {}, async (d) => {
    const p = await api("POST", "/api/pacientes", d);
    cachePacientes = null;
    avisar("Paciente cadastrado");
    aoCriar?.(p);
  });
}

async function novoAgendamento(valores = {}, aoSalvar) {
  const lista = await pacientesAtivos();
  if (!lista.length) return avisar("Cadastre um paciente primeiro", true);
  formulario(
    "Novo agendamento",
    [
      { nome: "paciente_id", rotulo: "Paciente", tipo: "select", opcoes: opcoesPacientes(lista), obrigatorio: true, largo: true },
      { nome: "inicio", rotulo: "Data e hora", tipo: "datetime-local", obrigatorio: true },
      { nome: "duracao_min", rotulo: "Duração (min)", tipo: "number", extra: 'min="5" step="5"' },
      { nome: "repetir_semanas", rotulo: "Repetir semanalmente (nº de sessões)", tipo: "number", extra: 'min="1" max="52"' },
      { nome: "observacoes", rotulo: "Observações", largo: true },
    ],
    { duracao_min: 50, repetir_semanas: 1, inicio: `${hoje()}T08:00`, ...valores },
    async (d) => {
      const criados = await salvarComConflito("POST", "/api/agendamentos", d);
      avisar(criados.length > 1 ? `${criados.length} sessões agendadas` : "Sessão agendada");
      aoSalvar?.();
    },
  );
}

async function novoPagamento(valores = {}, aoSalvar) {
  const lista = await pacientesAtivos();
  if (!lista.length) return avisar("Cadastre um paciente primeiro", true);
  formulario(
    "Registrar pagamento",
    [
      { nome: "paciente_id", rotulo: "Paciente", tipo: "select", opcoes: opcoesPacientes(lista), obrigatorio: true, largo: true },
      { nome: "data", rotulo: "Data", tipo: "date", obrigatorio: true },
      { nome: "valor", rotulo: "Valor (R$)", tipo: "money", obrigatorio: true },
      { nome: "forma", rotulo: "Forma", tipo: "select", opcoes: FORMAS, obrigatorio: true },
      { nome: "status", rotulo: "Situação", tipo: "select", opcoes: STATUS_PAG, obrigatorio: true },
      { nome: "referencia", rotulo: "Referência (ex.: sessões de maio, nº recibo)", largo: true },
      { nome: "observacoes", rotulo: "Observações", largo: true },
      { nome: "agendamento_id", rotulo: "", tipo: "hidden" },
    ],
    { data: hoje(), forma: "pix", status: "pago", ...valores },
    async (d) => {
      await api("POST", "/api/pagamentos", d);
      avisar("Pagamento registrado");
      aoSalvar?.();
    },
  );
}

function editarPagamento(p, aoSalvar) {
  formulario(
    "Editar pagamento",
    [
      { nome: "data", rotulo: "Data", tipo: "date", obrigatorio: true },
      { nome: "valor", rotulo: "Valor (R$)", tipo: "money", obrigatorio: true },
      { nome: "forma", rotulo: "Forma", tipo: "select", opcoes: FORMAS, obrigatorio: true },
      { nome: "status", rotulo: "Situação", tipo: "select", opcoes: STATUS_PAG, obrigatorio: true },
      { nome: "referencia", rotulo: "Referência", largo: true },
      { nome: "observacoes", rotulo: "Observações", largo: true },
    ],
    { ...p, valor: reaisInput(p.valor_centavos) },
    async (d) => {
      await api("PUT", `/api/pagamentos/${p.id}`, d);
      avisar("Pagamento atualizado");
      aoSalvar?.();
    },
  );
}

function novaEvolucao(pacienteId, valores = {}, aoSalvar) {
  const retificacao = !!valores.retifica_id;
  formulario(
    retificacao ? "Retificar evolução" : "Nova evolução",
    [
      { nome: "data_atendimento", rotulo: "Data do atendimento", tipo: "date", obrigatorio: true },
      { nome: "texto", rotulo: retificacao ? "Texto da retificação" : "Evolução", tipo: "textarea", obrigatorio: true },
      { nome: "agendamento_id", rotulo: "", tipo: "hidden" },
      { nome: "retifica_id", rotulo: "", tipo: "hidden" },
    ],
    { data_atendimento: hoje(), ...valores },
    async (d) => {
      if (!confirm("Após salvar, a evolução não poderá ser alterada nem excluída (apenas retificada). Confirmar?")) {
        throw new Error("Gravação cancelada.");
      }
      await api("POST", `/api/pacientes/${pacienteId}/evolucoes`, d);
      avisar(retificacao ? "Retificação registrada" : "Evolução registrada");
      aoSalvar?.();
    },
  );
}

// ------------------------------------------------------------ Agenda (semana)

let semanaAtual = segundaDaSemana(hoje());

async function telaAgenda() {
  const de = semanaAtual;
  const ate = somarDias(de, 5);
  conteudo.innerHTML = `
    <div class="barra">
      <h1 style="margin:0">Agenda</h1>
      <span class="espaco"></span>
      <button class="secundario" id="ant">‹ Semana anterior</button>
      <button class="secundario" id="hj">Hoje</button>
      <button class="secundario" id="prox">Próxima semana ›</button>
      <button id="novo">+ Agendar</button>
    </div>
    <p class="suave">${fmtData(de)} a ${fmtData(ate)}</p>
    <div class="semana" id="semana"><p class="carregando">Carregando…</p></div>`;
  $("#ant").onclick = () => ((semanaAtual = somarDias(semanaAtual, -7)), telaAgenda());
  $("#prox").onclick = () => ((semanaAtual = somarDias(semanaAtual, 7)), telaAgenda());
  $("#hj").onclick = () => ((semanaAtual = segundaDaSemana(hoje())), telaAgenda());
  $("#novo").onclick = () => novoAgendamento({}, telaAgenda);

  const sessoes = await api("GET", `/api/agendamentos?de=${de}&ate=${ate}`);
  const porDia = {};
  for (const s of sessoes) (porDia[s.inicio.slice(0, 10)] ??= []).push(s);

  $("#semana").innerHTML = Array.from({ length: 6 }, (_, i) => {
    const dia = somarDias(de, i);
    const lista = porDia[dia] || [];
    return `<section class="dia ${dia === hoje() ? "hoje" : ""}">
      <h3>${DIAS[i]} ${fmtData(dia).slice(0, 5)}
        <button class="pequeno secundario" data-novo="${dia}" title="Agendar neste dia">+</button></h3>
      ${lista
        .map(
          (s) => `<div class="sessao ${esc(s.status)}">
            <div><span class="hora">${s.inicio.slice(11, 16)}</span> · ${s.duracao_min} min</div>
            <div><a href="#/paciente/${s.paciente_id}">${esc(s.paciente_nome)}</a></div>
            ${s.observacoes ? `<div class="suave">${esc(s.observacoes)}</div>` : ""}
            <select data-status="${s.id}">${Object.entries(STATUS_AG)
              .map(([k, r]) => `<option value="${k}" ${k === s.status ? "selected" : ""}>${r}</option>`)
              .join("")}</select>
            <div class="acoes-sessao">
              <button class="pequeno secundario" data-evol="${s.id}">Evolução</button>
              <button class="pequeno secundario" data-pag="${s.id}">Pagamento</button>
              <button class="pequeno secundario" data-remarcar="${s.id}">Remarcar</button>
            </div>
          </div>`,
        )
        .join("") || '<p class="suave" style="font-size:13px">Livre</p>'}
    </section>`;
  }).join("");

  const achar = (id) => sessoes.find((s) => s.id === Number(id));
  $("#semana").onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.novo) return novoAgendamento({ inicio: `${b.dataset.novo}T08:00` }, telaAgenda);
    const s = achar(b.dataset.evol || b.dataset.pag || b.dataset.remarcar);
    if (b.dataset.evol) novaEvolucao(s.paciente_id, { data_atendimento: s.inicio.slice(0, 10), agendamento_id: s.id }, telaAgenda);
    if (b.dataset.pag) {
      const p = (await pacientesAtivos()).find((x) => x.id === s.paciente_id);
      novoPagamento(
        { paciente_id: s.paciente_id, agendamento_id: s.id, data: s.inicio.slice(0, 10), valor: reaisInput(p?.valor_sessao_centavos) },
        telaAgenda,
      );
    }
    if (b.dataset.remarcar) {
      formulario(
        `Remarcar – ${s.paciente_nome}`,
        [
          { nome: "inicio", rotulo: "Nova data e hora", tipo: "datetime-local", obrigatorio: true },
          { nome: "duracao_min", rotulo: "Duração (min)", tipo: "number", extra: 'min="5" step="5"' },
          { nome: "observacoes", rotulo: "Observações", largo: true },
        ],
        s,
        async (d) => {
          await salvarComConflito("PUT", `/api/agendamentos/${s.id}`, d);
          avisar("Sessão remarcada");
          telaAgenda();
        },
      );
    }
  };
  $("#semana").onchange = async (ev) => {
    const id = ev.target.dataset.status;
    if (!id) return;
    try {
      await api("PUT", `/api/agendamentos/${id}`, { status: ev.target.value });
      avisar("Situação atualizada");
      telaAgenda();
    } catch (e) {
      avisar(e.message, true);
    }
  };
}

// ------------------------------------------------------------ Pacientes

async function telaPacientes() {
  conteudo.innerHTML = `
    <div class="barra">
      <h1 style="margin:0">Pacientes</h1>
      <span class="espaco"></span>
      <input id="busca" type="search" placeholder="Buscar por nome, CPF ou telefone">
      <label class="suave"><input type="checkbox" id="inativos" style="width:auto"> inativos</label>
      <button id="novo">+ Novo paciente</button>
    </div>
    <div class="tabela-rolagem" id="lista"><p class="carregando">Carregando…</p></div>`;

  const carregar = async () => {
    const q = new URLSearchParams({ busca: $("#busca").value, inativos: $("#inativos").checked ? "1" : "0" });
    const lista = await api("GET", `/api/pacientes?${q}`);
    $("#lista").innerHTML = lista.length
      ? `<table><thead><tr><th>Nome</th><th>Telefone</th><th>Convênio</th><th class="num">Valor sessão</th><th></th></tr></thead><tbody>
        ${lista
          .map(
            (p) => `<tr><td><a href="#/paciente/${p.id}">${esc(p.nome)}</a>${p.ativo ? "" : ' <span class="selo cancelado">inativo</span>'}</td>
              <td>${esc(p.telefone)}</td><td>${esc(p.convenio)}</td><td class="num">${moeda(p.valor_sessao_centavos)}</td>
              <td><a href="#/paciente/${p.id}">abrir</a></td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="suave">Nenhum paciente encontrado.</p>';
  };
  let t;
  $("#busca").oninput = () => (clearTimeout(t), (t = setTimeout(carregar, 250)));
  $("#inativos").onchange = carregar;
  $("#novo").onclick = () => novoPaciente((p) => (location.hash = `#/paciente/${p.id}`));
  await carregar();
}

// ------------------------------------------------------------ Ficha do paciente

async function telaPaciente(id, abaInicial = "dados") {
  const p = await api("GET", `/api/pacientes/${id}`);
  conteudo.innerHTML = `
    <div class="barra">
      <h1 style="margin:0">${esc(p.nome)}</h1>
      ${p.ativo ? "" : '<span class="selo cancelado">inativo</span>'}
      <span class="espaco"></span>
      <button class="secundario" onclick="window.print()">Imprimir</button>
    </div>
    <div class="abas" id="abas">
      <button data-aba="dados">Cadastro</button>
      <button data-aba="prontuario">Prontuário</button>
      <button data-aba="sessoes">Sessões</button>
      <button data-aba="pagamentos">Pagamentos</button>
    </div>
    <div id="aba"></div>`;

  const abas = {
    dados: () => abaDados(p),
    prontuario: () => abaProntuario(p),
    sessoes: () => abaSessoes(p),
    pagamentos: () => abaPagamentos(p),
  };
  const abrir = async (nome) => {
    document.querySelectorAll("#abas button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === nome));
    $("#aba").innerHTML = '<p class="carregando">Carregando…</p>';
    try {
      await abas[nome]();
    } catch (e) {
      $("#aba").innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    }
  };
  $("#abas").onclick = (ev) => ev.target.dataset.aba && abrir(ev.target.dataset.aba);
  abrir(abaInicial);
}

function abaDados(p) {
  const linha = (r, v) => `<tr><th style="width:220px">${r}</th><td>${v || '<span class="suave">—</span>'}</td></tr>`;
  $("#aba").innerHTML = `
    <div class="barra"><span class="espaco"></span>
      <button class="secundario" id="ativar">${p.ativo ? "Inativar" : "Reativar"}</button>
      <button id="editar">Editar cadastro</button></div>
    <table>
      ${linha("CPF", esc(p.cpf))}
      ${linha("Nascimento", fmtData(p.data_nascimento))}
      ${linha("Telefone", esc(p.telefone))}
      ${linha("E-mail", esc(p.email))}
      ${linha("Endereço", esc(p.endereco))}
      ${linha("Contato de emergência", esc(p.contato_emergencia))}
      ${linha("Convênio", esc(p.convenio))}
      ${linha("Valor da sessão", moeda(p.valor_sessao_centavos))}
      ${linha("Observações", esc(p.observacoes).replace(/\n/g, "<br>"))}
      ${linha("Cadastrado em", fmtUtc(p.criado_em))}
    </table>`;
  $("#editar").onclick = () =>
    formulario("Editar cadastro", CAMPOS_PACIENTE, { ...p, valor_sessao: reaisInput(p.valor_sessao_centavos) }, async (d) => {
      await api("PUT", `/api/pacientes/${p.id}`, d);
      cachePacientes = null;
      avisar("Cadastro atualizado");
      telaPaciente(p.id, "dados");
    });
  $("#ativar").onclick = async () => {
    if (!confirm(p.ativo ? "Inativar paciente? O prontuário continua guardado." : "Reativar paciente?")) return;
    await api("PUT", `/api/pacientes/${p.id}`, { ativo: p.ativo ? 0 : 1 });
    cachePacientes = null;
    telaPaciente(p.id, "dados");
  };
}

async function abaProntuario(p) {
  const [evolucoes, anexos] = await Promise.all([
    api("GET", `/api/pacientes/${p.id}/evolucoes`),
    api("GET", `/api/pacientes/${p.id}/anexos`),
  ]);
  const retificadas = new Set(evolucoes.filter((e) => e.retifica_id).map((e) => e.retifica_id));
  $("#aba").innerHTML = `
    <div class="barra"><h2 style="margin:0">Evoluções</h2><span class="espaco"></span><button id="nova">+ Nova evolução</button></div>
    ${
      evolucoes
        .map(
          (e) => `<article class="evolucao ${retificadas.has(e.id) ? "retificada" : ""} ${e.retifica_id ? "retificacao" : ""}">
            <div class="meta">
              <strong>${fmtData(e.data_atendimento)}</strong>
              <span>#${e.id}</span>
              ${e.retifica_id ? `<span class="selo pendente">retifica #${e.retifica_id}</span>` : ""}
              ${retificadas.has(e.id) ? '<span class="selo cancelado">retificada</span>' : ""}
              <span>registrado por ${esc(e.autor_email)} em ${fmtUtc(e.criado_em)}</span>
              <span class="espaco"></span>
              <button class="pequeno secundario" data-retificar="${e.id}">Retificar</button>
            </div>
            <div class="texto">${esc(e.texto)}</div>
          </article>`,
        )
        .join("") || '<p class="suave">Nenhuma evolução registrada.</p>'
    }
    <div class="barra" style="margin-top:28px"><h2 style="margin:0">Anexos</h2><span class="espaco"></span><button id="anexar">+ Anexar arquivo</button></div>
    ${
      anexos.length
        ? `<table><thead><tr><th>Arquivo</th><th>Descrição</th><th class="num">Tamanho</th><th>Enviado</th></tr></thead><tbody>
        ${anexos
          .map(
            (a) => `<tr><td><a href="/api/anexos/${a.id}">${esc(a.nome_arquivo)}</a></td><td>${esc(a.descricao)}</td>
              <td class="num">${(a.tamanho_bytes / 1024).toFixed(0)} KB</td>
              <td>${fmtUtc(a.criado_em)}<br><span class="suave">${esc(a.autor_email)}</span></td></tr>`,
          )
          .join("")}</tbody></table>`
        : '<p class="suave">Nenhum anexo.</p>'
    }`;
  const recarregar = () => abaProntuario(p);
  $("#nova").onclick = () => novaEvolucao(p.id, {}, recarregar);
  $("#aba").onclick = (ev) => {
    const id = ev.target.dataset?.retificar;
    if (id) {
      const orig = evolucoes.find((e) => e.id === Number(id));
      novaEvolucao(p.id, { retifica_id: id, data_atendimento: orig.data_atendimento }, recarregar);
    }
  };
  $("#anexar").onclick = () =>
    formulario(
      "Anexar arquivo ao prontuário",
      [
        { nome: "arquivo", rotulo: "Arquivo (até 20 MB)", tipo: "file", obrigatorio: true, largo: true },
        { nome: "descricao", rotulo: "Descrição", largo: true },
      ],
      {},
      async (fd) => {
        await api("POST", `/api/pacientes/${p.id}/anexos`, fd);
        avisar("Arquivo anexado");
        recarregar();
      },
    );
}

async function abaSessoes(p) {
  const sessoes = await api("GET", `/api/agendamentos?paciente_id=${p.id}`);
  const contagem = sessoes.reduce((acc, s) => ((acc[s.status] = (acc[s.status] || 0) + 1), acc), {});
  $("#aba").innerHTML = `
    <div class="barra">
      <span class="suave">${Object.entries(contagem).map(([k, n]) => `${STATUS_AG[k]}: ${n}`).join(" · ") || "Sem sessões"}</span>
      <span class="espaco"></span><button id="novo">+ Agendar</button></div>
    ${
      sessoes.length
        ? `<table><thead><tr><th>Data</th><th>Duração</th><th>Situação</th><th>Observações</th></tr></thead><tbody>
      ${sessoes
        .slice()
        .reverse()
        .map(
          (s) => `<tr><td>${fmtDataHora(s.inicio)}</td><td>${s.duracao_min} min</td>
            <td><span class="selo ${esc(s.status)}">${STATUS_AG[s.status]}</span></td><td>${esc(s.observacoes)}</td></tr>`,
        )
        .join("")}</tbody></table>`
        : ""
    }`;
  $("#novo").onclick = () => novoAgendamento({ paciente_id: p.id }, () => abaSessoes(p));
}

async function abaPagamentos(p) {
  const pags = await api("GET", `/api/pagamentos?paciente_id=${p.id}`);
  const soma = (st) => pags.filter((x) => x.status === st).reduce((a, x) => a + x.valor_centavos, 0);
  $("#aba").innerHTML = `
    <div class="barra">
      <span>Pago: <strong>${moeda(soma("pago"))}</strong> · Pendente: <strong>${moeda(soma("pendente"))}</strong></span>
      <span class="espaco"></span><button id="novo">+ Registrar pagamento</button></div>
    ${tabelaPagamentos(pags, false)}`;
  const recarregar = () => abaPagamentos(p);
  $("#novo").onclick = () => novoPagamento({ paciente_id: p.id, valor: reaisInput(p.valor_sessao_centavos) }, recarregar);
  ligarEdicaoPagamentos(pags, recarregar);
}

function tabelaPagamentos(pags, comPaciente = true) {
  if (!pags.length) return '<p class="suave">Nenhum pagamento.</p>';
  return `<div class="tabela-rolagem"><table><thead><tr><th>Data</th>${comPaciente ? "<th>Paciente</th>" : ""}
    <th class="num">Valor</th><th>Forma</th><th>Situação</th><th>Referência</th><th></th></tr></thead><tbody>
    ${pags
      .map(
        (g) => `<tr><td>${fmtData(g.data)}</td>
          ${comPaciente ? `<td><a href="#/paciente/${g.paciente_id}">${esc(g.paciente_nome)}</a></td>` : ""}
          <td class="num">${moeda(g.valor_centavos)}</td><td>${FORMAS[g.forma] || esc(g.forma)}</td>
          <td><span class="selo ${esc(g.status)}">${STATUS_PAG[g.status]}</span></td><td>${esc(g.referencia)}</td>
          <td><button class="pequeno secundario" data-editar-pag="${g.id}">Editar</button></td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

function ligarEdicaoPagamentos(pags, recarregar) {
  conteudo.addEventListener(
    "click",
    function h(ev) {
      const id = ev.target.dataset?.editarPag;
      if (!id) return;
      editarPagamento(pags.find((g) => g.id === Number(id)), recarregar);
    },
    { once: false, signal: sinalTela() },
  );
}

// Cancela ouvintes registrados ao trocar de tela/aba.
let controladorTela = new AbortController();
const sinalTela = () => {
  controladorTela.abort();
  controladorTela = new AbortController();
  return controladorTela.signal;
};

// ------------------------------------------------------------ Financeiro

let mesAtual = hoje().slice(0, 7);

async function telaFinanceiro() {
  const [a, m] = mesAtual.split("-").map(Number);
  const ultimoDia = new Date(a, m, 0).getDate();
  const [resumo, pags] = await Promise.all([
    api("GET", `/api/resumo?mes=${mesAtual}`),
    api("GET", `/api/pagamentos?de=${mesAtual}-01&ate=${mesAtual}-${pad(ultimoDia)}`),
  ]);
  const tot = (st) => resumo.pagamentos.find((x) => x.status === st)?.total ?? 0;
  const ses = (st) => resumo.sessoes.find((x) => x.status === st)?.qtd ?? 0;
  const aReceber = resumo.realizadas_sem_pagamento.reduce((acc, s) => acc + (s.valor_sessao_centavos || 0), 0);

  conteudo.innerHTML = `
    <div class="barra">
      <h1 style="margin:0">Financeiro</h1><span class="espaco"></span>
      <input type="month" id="mes" value="${mesAtual}">
      <button id="novo">+ Registrar pagamento</button>
    </div>
    <div class="indicadores">
      <div class="cartao indicador"><div class="rotulo">Recebido no mês</div><div class="valor">${moeda(tot("pago"))}</div></div>
      <div class="cartao indicador"><div class="rotulo">Pendente</div><div class="valor">${moeda(tot("pendente"))}</div></div>
      <div class="cartao indicador"><div class="rotulo">Sessões realizadas sem pagamento</div>
        <div class="valor">${resumo.realizadas_sem_pagamento.length}</div><div class="suave">≈ ${moeda(aReceber)} pelo valor de tabela</div></div>
      <div class="cartao indicador"><div class="rotulo">Sessões no mês</div>
        <div class="valor">${ses("realizado")}</div><div class="suave">realizadas · ${ses("faltou")} faltas · ${ses("cancelado")} canceladas</div></div>
    </div>
    ${
      resumo.realizadas_sem_pagamento.length
        ? `<h2>Sessões realizadas sem pagamento vinculado</h2>
      <table><thead><tr><th>Data</th><th>Paciente</th><th class="num">Valor de tabela</th><th></th></tr></thead><tbody>
      ${resumo.realizadas_sem_pagamento
        .map(
          (s) => `<tr><td>${fmtDataHora(s.inicio)}</td><td><a href="#/paciente/${s.paciente_id}">${esc(s.paciente_nome)}</a></td>
            <td class="num">${moeda(s.valor_sessao_centavos)}</td>
            <td><button class="pequeno" data-receber="${s.id}">Registrar</button></td></tr>`,
        )
        .join("")}</tbody></table>`
        : ""
    }
    <h2>Pagamentos do mês</h2>
    ${tabelaPagamentos(pags)}`;

  $("#mes").onchange = (ev) => ((mesAtual = ev.target.value || mesAtual), telaFinanceiro());
  $("#novo").onclick = () => novoPagamento({}, telaFinanceiro);
  const sinal = sinalTela();
  conteudo.addEventListener(
    "click",
    (ev) => {
      const ds = ev.target.dataset || {};
      if (ds.editarPag) editarPagamento(pags.find((g) => g.id === Number(ds.editarPag)), telaFinanceiro);
      if (ds.receber) {
        const s = resumo.realizadas_sem_pagamento.find((x) => x.id === Number(ds.receber));
        novoPagamento(
          { paciente_id: s.paciente_id, agendamento_id: s.id, data: s.inicio.slice(0, 10), valor: reaisInput(s.valor_sessao_centavos) },
          telaFinanceiro,
        );
      }
    },
    { signal: sinal },
  );
}

// ------------------------------------------------------------ Excel

const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = SHEETJS;
    s.onload = () => ok(window.XLSX);
    s.onerror = () => falha(new Error("Não foi possível carregar o leitor de Excel"));
    document.head.appendChild(s);
  });
}

// Cabeçalhos das abas <-> campos da API
const COLUNAS = {
  Pacientes: [
    ["id", "ID"], ["nome", "Nome"], ["cpf", "CPF"], ["data_nascimento", "Nascimento"], ["telefone", "Telefone"],
    ["email", "E-mail"], ["endereco", "Endereço"], ["contato_emergencia", "Contato de emergência"],
    ["convenio", "Convênio"], ["valor_sessao", "Valor da sessão"], ["observacoes", "Observações"], ["ativo", "Ativo"],
  ],
  Agenda: [
    ["id", "ID"], ["paciente_id", "ID paciente"], ["paciente_nome", "Paciente"], ["data", "Data"], ["hora", "Hora"],
    ["duracao_min", "Duração (min)"], ["status", "Situação"], ["observacoes", "Observações"],
  ],
  Pagamentos: [
    ["id", "ID"], ["paciente_id", "ID paciente"], ["paciente_nome", "Paciente"], ["agendamento_id", "ID agendamento"],
    ["data", "Data"], ["valor", "Valor"], ["forma", "Forma"], ["status", "Situação"], ["referencia", "Referência"],
    ["observacoes", "Observações"],
  ],
  "Prontuário": [
    ["id", "ID"], ["paciente_id", "ID paciente"], ["paciente_nome", "Paciente"], ["data_atendimento", "Data"],
    ["texto", "Evolução"], ["retifica_id", "Retifica ID"], ["autor_email", "Registrado por"], ["criado_em", "Registrado em (UTC)"],
  ],
};

const paraDataExcel = (iso) => {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
};

function linhasExportacao(dados) {
  const mapear = (aba, lista, fn) =>
    lista.map((r) => {
      const x = fn(r);
      return Object.fromEntries(COLUNAS[aba].map(([k, rot]) => [rot, x[k] ?? null]));
    });
  const abas = {
    Pacientes: mapear("Pacientes", dados.pacientes, (p) => ({
      ...p, data_nascimento: paraDataExcel(p.data_nascimento),
      valor_sessao: p.valor_sessao_centavos == null ? null : p.valor_sessao_centavos / 100, ativo: p.ativo ? "Sim" : "Não",
    })),
    Agenda: mapear("Agenda", dados.agendamentos, (a) => ({ ...a, data: paraDataExcel(a.inicio), hora: a.inicio.slice(11, 16) })),
    Pagamentos: mapear("Pagamentos", dados.pagamentos, (g) => ({ ...g, data: paraDataExcel(g.data), valor: g.valor_centavos / 100 })),
  };
  if (dados.evolucoes) {
    abas["Prontuário"] = mapear("Prontuário", dados.evolucoes, (e) => ({ ...e, data_atendimento: paraDataExcel(e.data_atendimento) }));
  }
  return abas;
}

function abaInstrucoes(XLSX) {
  return XLSX.utils.aoa_to_sheet([
    ["Como usar esta planilha"],
    ["Linhas com ID preenchido atualizam o registro existente; linhas sem ID criam um novo registro."],
    ["Na Agenda e em Pagamentos, informe o 'ID paciente' ou o nome exato do paciente."],
    ["Datas: DD/MM/AAAA. Hora: HH:MM. Valores em reais (ex.: 150 ou 150,00)."],
    ["Situação da agenda: " + Object.keys(STATUS_AG).join(", ")],
    ["Forma de pagamento: " + Object.keys(FORMAS).join(", ")],
    ["Situação do pagamento: " + Object.keys(STATUS_PAG).join(", ")],
    ["A aba Prontuário (quando exportada) é somente leitura: evoluções não são importadas."],
  ]);
}

async function gerarPlanilha(dados, nome) {
  const XLSX = await carregarSheetJS();
  const wb = XLSX.utils.book_new();
  for (const [aba, linhas] of Object.entries(linhasExportacao(dados))) {
    const ws = linhas.length
      ? XLSX.utils.json_to_sheet(linhas, { cellDates: true, dateNF: "dd/mm/yyyy" })
      : XLSX.utils.aoa_to_sheet([COLUNAS[aba].map(([, r]) => r)]);
    XLSX.utils.book_append_sheet(wb, ws, aba);
  }
  XLSX.utils.book_append_sheet(wb, abaInstrucoes(XLSX), "Instruções");
  XLSX.writeFile(wb, nome, { cellDates: true });
}

// Normaliza valores lidos do Excel
function lerData(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isoData(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s; // a API devolverá erro de validação com a linha
}
function lerHora(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === "number") {
    const min = Math.round((v % 1) * 24 * 60);
    return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[:h](\d{2})?/);
  return m ? `${pad(m[1])}:${m[2] || "00"}` : String(v);
}

function linhasImportacao(XLSX, wb) {
  const ler = (aba) => {
    const ws = wb.Sheets[aba];
    if (!ws) return [];
    const brutas = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const porRotulo = Object.fromEntries(COLUNAS[aba].map(([k, r]) => [r.toLowerCase(), k]));
    return brutas
      .map((linha) => Object.fromEntries(Object.entries(linha).map(([r, v]) => [porRotulo[r.trim().toLowerCase()] ?? r, v])))
      .filter((l) => Object.values(l).some((v) => v !== null && v !== ""));
  };
  return {
    pacientes: ler("Pacientes").map((p) => ({
      ...p, data_nascimento: lerData(p.data_nascimento),
      ativo: p.ativo == null ? 1 : /^(n|não|nao|0|false)$/i.test(String(p.ativo).trim()) ? 0 : 1,
    })),
    agendamentos: ler("Agenda").map((a) => {
      const d = lerData(a.data);
      const h = lerHora(a.hora) ?? "00:00";
      return { ...a, inicio: d ? `${d}T${h}` : null };
    }),
    pagamentos: ler("Pagamentos").map((g) => ({ ...g, data: lerData(g.data) })),
  };
}

function telaExcel() {
  conteudo.innerHTML = `
    <h1>Excel</h1>
    <div class="cartao">
      <h2 style="margin-top:0">Exportar</h2>
      <p>Gera uma planilha .xlsx com pacientes, agenda e pagamentos. Serve como backup e para trabalhar no Excel.</p>
      <label><input type="checkbox" id="comProntuario" style="width:auto"> incluir prontuário (evoluções)</label>
      <p class="suave">Atenção: a planilha com prontuário contém dados sensíveis de saúde. Guarde-a em local protegido.</p>
      <div class="barra"><button id="exportar">Baixar planilha</button><button class="secundario" id="modelo">Baixar modelo vazio</button></div>
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2 style="margin-top:0">Importar</h2>
      <p>Use o modelo (ou uma planilha exportada daqui). Abas lidas: <strong>Pacientes</strong>, <strong>Agenda</strong> e <strong>Pagamentos</strong>.</p>
      <input type="file" id="arquivo" accept=".xlsx,.xls,.csv" style="width:auto">
      <div id="previa"></div>
    </div>`;

  $("#exportar").onclick = async () => {
    try {
      const pront = $("#comProntuario").checked;
      const dados = await api("GET", `/api/exportar${pront ? "?prontuario=1" : ""}`);
      await gerarPlanilha(dados, `consultorio-${hoje()}${pront ? "-com-prontuario" : ""}.xlsx`);
    } catch (e) {
      avisar(e.message, true);
    }
  };
  $("#modelo").onclick = () =>
    gerarPlanilha({ pacientes: [], agendamentos: [], pagamentos: [] }, "modelo-consultorio.xlsx").catch((e) => avisar(e.message, true));

  $("#arquivo").onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const XLSX = await carregarSheetJS();
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const dados = linhasImportacao(XLSX, wb);
      $("#previa").innerHTML = `
        <p>Encontrado: <strong>${dados.pacientes.length}</strong> pacientes, <strong>${dados.agendamentos.length}</strong> sessões,
        <strong>${dados.pagamentos.length}</strong> pagamentos.</p>
        <button id="confirmar">Importar</button>`;
      $("#confirmar").onclick = async () => {
        $("#confirmar").disabled = true;
        try {
          const r = await api("POST", "/api/importar", dados);
          cachePacientes = null;
          $("#previa").innerHTML = `<p>${r.inseridos} registros criados, ${r.atualizados} atualizados.</p>
            ${
              r.erros.length
                ? `<p class="erro">${r.erros.length} linha(s) com erro (não importadas):</p>
              <table><thead><tr><th>Aba</th><th>Linha</th><th>Erro</th></tr></thead><tbody>
              ${r.erros.map((e) => `<tr><td>${esc(e.aba)}</td><td>${e.linha}</td><td>${esc(e.erro)}</td></tr>`).join("")}</tbody></table>`
                : ""
            }`;
        } catch (e) {
          avisar(e.message, true);
          $("#confirmar").disabled = false;
        }
      };
    } catch (e) {
      avisar(e.message, true);
    }
  };
}

// ------------------------------------------------------------ Auditoria

async function telaAuditoria() {
  const lista = await api("GET", "/api/auditoria?limite=300");
  conteudo.innerHTML = `
    <h1>Auditoria</h1>
    <p class="suave">Registro de acessos e alterações (últimos 300). Não pode ser alterado nem excluído.</p>
    <div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Item</th><th>Detalhe</th><th>IP</th></tr></thead><tbody>
    ${lista
      .map(
        (a) => `<tr><td>${fmtUtc(a.quando)}</td><td>${esc(a.usuario)}</td><td>${esc(a.acao)}</td>
          <td>${esc(a.entidade)}${a.entidade_id ? ` #${a.entidade_id}` : ""}</td><td>${esc(a.detalhe)}</td><td>${esc(a.ip)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

// ------------------------------------------------------------ roteador

async function rotear() {
  const [, rota = "agenda", id] = location.hash.replace(/^#/, "").split("/");
  document.querySelectorAll("#menu a").forEach((a) =>
    a.classList.toggle("ativo", a.dataset.rota === rota || (rota === "paciente" && a.dataset.rota === "pacientes")),
  );
  sinalTela();
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    if (rota === "pacientes") await telaPacientes();
    else if (rota === "paciente" && id) await telaPaciente(Number(id));
    else if (rota === "financeiro") await telaFinanceiro();
    else if (rota === "excel") telaExcel();
    else if (rota === "auditoria") await telaAuditoria();
    else await telaAgenda();
  } catch (e) {
    conteudo.innerHTML = `<p class="erro">${esc(e.message)}</p>${
      e.status === 401 ? '<p><a href="/">Entrar novamente</a></p>' : ""
    }`;
  }
}

window.addEventListener("hashchange", rotear);
api("GET", "/api/eu")
  .then((r) => ($("#usuario").textContent = r.usuario))
  .catch(() => {});
rotear();
