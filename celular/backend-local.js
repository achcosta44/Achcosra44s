// "Servidor" local: implementa as mesmas rotas de /api usadas pelas telas,
// guardando tudo no IndexedDB do próprio navegador.
// Opcionalmente sincroniza entre aparelhos, enviando apenas dados criptografados
// com a senha do usuário (ver seção "sincronização" no fim do arquivo).
(() => {
  "use strict";

  const STORES = ["pacientes", "agendamentos", "pagamentos", "evolucoes", "anexos", "auditoria"];
  const USUARIO = "este aparelho";

  // ---------------------------------------------------------- IndexedDB
  let dbPromise;
  function abrirDb() {
    dbPromise ??= new Promise((ok, falha) => {
      const req = indexedDB.open("consultorio", 2);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (ev.oldVersion < 1) {
          for (const s of STORES) db.createObjectStore(s, { keyPath: "id", autoIncrement: true });
          db.createObjectStore("config", { keyPath: "chave" });
        }
        // v2: fila de alterações ainda não enviadas à sincronização
        if (ev.oldVersion < 2) db.createObjectStore("pendentes", { keyPath: "chave" });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(new Error("Não foi possível abrir o armazenamento do navegador: " + req.error));
      req.onblocked = () => falha(new Error("Feche outras abas do app e recarregue a página."));
    });
    return dbPromise;
  }

  const prom = (req) => new Promise((ok, falha) => ((req.onsuccess = () => ok(req.result)), (req.onerror = () => falha(req.error))));

  async function tx(stores, modo, fn) {
    const db = await abrirDb();
    const t = db.transaction(stores, modo);
    const concluida = new Promise((ok, falha) => {
      t.oncomplete = ok;
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error || new Error("Transação abortada"));
    });
    const resultado = await fn((s) => t.objectStore(s));
    await concluida;
    return resultado;
  }
  const todos = (s) => tx([s], "readonly", (os) => prom(os(s).getAll()));
  const um = (s, id) => tx([s], "readonly", (os) => prom(os(s).get(id)));
  const config = (chave) => tx(["config"], "readonly", (os) => prom(os("config").get(chave))).then((r) => r?.valor);
  const salvarConfig = (chave, valor) => tx(["config"], "readwrite", (os) => prom(os("config").put({ chave, valor })));

  // Identificadores únicos entre aparelhos (sem colisão quando dois aparelhos criam registros).
  // Inteiros < 2^53 para continuar compatíveis com as telas.
  let ultimoId = 0;
  function novoId() {
    const base = Math.floor(Date.now() / 1000) * 1e6 + Math.floor(Math.random() * 1e6);
    ultimoId = Math.max(base, ultimoId + 1);
    return ultimoId;
  }
  // Versão do registro: usada para decidir qual alteração vale quando dois aparelhos mexem no mesmo item.
  let ultimaRev = 0;
  const novaRev = () => (ultimaRev = Math.max(Date.now(), ultimaRev + 1));

  // Toda gravação marca o registro como pendente de envio, na mesma transação.
  async function salvarRegistro(s, obj, modo) {
    const reg = { ...obj, _rev: novaRev() };
    if (modo === "inserir" && reg.id == null) reg.id = novoId();
    await tx([s, "pendentes"], "readwrite", (os) => {
      os(s)[modo === "inserir" ? "add" : "put"](reg);
      os("pendentes").put({ chave: `${s}:${reg.id}`, store: s, id: reg.id, rev: reg._rev });
    });
    aoAlterar();
    return reg;
  }
  const inserir = (s, obj) => salvarRegistro(s, obj, "inserir");
  const gravar = (s, obj) => salvarRegistro(s, obj, "gravar");

  let aoAlterar = () => {}; // substituído pela sincronização

  // ---------------------------------------------------------- utilidades
  class ErroHttp extends Error {
    constructor(status, msg, dados) {
      super(msg);
      this.status = status;
      this.dados = { erro: msg, ...(dados || {}) };
    }
  }
  const pad = (n) => String(n).padStart(2, "0");
  const agora = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  const somarDias = (iso, dias) => {
    const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10) + iso.slice(10);
  };
  const minutos = (inicio) => {
    const [hh, mm] = inicio.slice(11, 16).split(":").map(Number);
    return hh * 60 + mm;
  };
  const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });

  function auditar(acao, entidade, entidadeId, detalhe) {
    return inserir("auditoria", {
      quando: agora(), usuario: USUARIO, acao, entidade, entidade_id: entidadeId ?? null, detalhe: detalhe ?? null, ip: null,
    });
  }

  // ---------------------------------------------------------- validação (mesmas regras do servidor)
  function texto(o, campo, { obrigatorio = false, max = 2000 } = {}) {
    const v = o[campo];
    if (v === undefined || v === null || String(v).trim() === "") {
      if (obrigatorio) throw new ErroHttp(400, `Campo obrigatório: ${campo}`);
      return null;
    }
    const s = String(v).trim();
    if (s.length > max) throw new ErroHttp(400, `Campo muito longo: ${campo}`);
    return s;
  }
  function inteiro(o, campo, { obrigatorio = false, min } = {}) {
    const v = o[campo];
    if (v === undefined || v === null || v === "") {
      if (obrigatorio) throw new ErroHttp(400, `Campo obrigatório: ${campo}`);
      return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n)) throw new ErroHttp(400, `Número inteiro inválido: ${campo}`);
    if (min !== undefined && n < min) throw new ErroHttp(400, `Valor mínimo de ${campo}: ${min}`);
    return n;
  }
  function dataValida(s) {
    const [a, m, d] = s.slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function data(o, campo, obrigatorio = false) {
    const s = texto(o, campo, { obrigatorio, max: 10 });
    if (s === null) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !dataValida(s)) throw new ErroHttp(400, `Data inválida em ${campo} (use AAAA-MM-DD)`);
    return s;
  }
  function dataHora(o, campo, obrigatorio = false) {
    const s = texto(o, campo, { obrigatorio, max: 16 });
    if (s === null) return null;
    const [hh, mm] = (s.split("T")[1] ?? "").split(":").map(Number);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) || !dataValida(s) || hh > 23 || mm > 59) {
      throw new ErroHttp(400, `Data/hora inválida em ${campo} (use AAAA-MM-DDTHH:MM)`);
    }
    return s;
  }
  function opcao(o, campo, opcoes, padrao) {
    const s = texto(o, campo, { max: 40 });
    if (s === null) return padrao ?? null;
    if (!opcoes.includes(s)) throw new ErroHttp(400, `Valor inválido em ${campo}: ${s}`);
    return s;
  }
  function centavos(o, obrigatorio = false) {
    if (o.valor_centavos !== undefined && o.valor_centavos !== null && o.valor_centavos !== "") {
      return inteiro(o, "valor_centavos", { min: 0 });
    }
    const v = o.valor;
    if (v === undefined || v === null || v === "") {
      if (obrigatorio) throw new ErroHttp(400, "Campo obrigatório: valor");
      return null;
    }
    let n;
    if (typeof v === "number") n = v;
    else {
      let s = String(v).replace(/[R$\s]/g, "");
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      n = Number(s);
    }
    if (!Number.isFinite(n) || n < 0) throw new ErroHttp(400, "Valor inválido");
    return Math.round(n * 100);
  }
  const STATUS_AG = ["agendado", "confirmado", "realizado", "faltou", "cancelado"];
  const FORMAS = ["pix", "dinheiro", "cartao_credito", "cartao_debito", "transferencia", "convenio", "outro"];
  const STATUS_PAG = ["pago", "pendente", "cancelado"];
  const TIPOS_REGISTRO = ["evolucao", "demanda", "encaminhamento", "encerramento", "documento", "outro"];

  // ---------------------------------------------------------- pacientes
  function camposPaciente(b) {
    return {
      nome: texto(b, "nome", { obrigatorio: true, max: 200 }),
      cpf: texto(b, "cpf", { max: 14 })?.replace(/\D/g, "") || null,
      data_nascimento: data(b, "data_nascimento"),
      telefone: texto(b, "telefone", { max: 40 }),
      email: texto(b, "email", { max: 200 }),
      endereco: texto(b, "endereco", { max: 500 }),
      contato_emergencia: texto(b, "contato_emergencia", { max: 300 }),
      convenio: texto(b, "convenio", { max: 200 }),
      valor_sessao_centavos:
        b.valor_sessao !== undefined ? centavos({ valor: b.valor_sessao }) : inteiro(b, "valor_sessao_centavos", { min: 0 }),
      observacoes: texto(b, "observacoes", { max: 5000 }),
      ativo: b.ativo === undefined ? 1 : b.ativo === false || b.ativo === 0 || b.ativo === "0" ? 0 : 1,
    };
  }
  async function checarCpf(cpf, ignorarId) {
    if (!cpf) return;
    const lista = await todos("pacientes");
    if (lista.some((p) => p.cpf === cpf && p.id !== ignorarId)) throw new ErroHttp(409, "Já existe paciente com este CPF");
  }
  async function pacienteOuErro(id) {
    const p = await um("pacientes", id);
    if (!p) throw new ErroHttp(404, "Paciente não encontrado");
    return p;
  }
  async function criarPaciente(b) {
    const c = camposPaciente(b);
    await checarCpf(c.cpf);
    const p = await inserir("pacientes", { ...c, criado_em: agora(), atualizado_em: agora() });
    await auditar("criar", "paciente", p.id);
    return p;
  }
  async function atualizarPaciente(id, b) {
    const atual = await pacienteOuErro(id);
    const c = camposPaciente({ ...atual, ...b });
    await checarCpf(c.cpf, id);
    const p = await gravar("pacientes", { ...atual, ...c, atualizado_em: agora() });
    await auditar("atualizar", "paciente", id);
    return p;
  }

  // ---------------------------------------------------------- agenda
  async function agendaComNomes() {
    const [ags, pacs] = await Promise.all([todos("agendamentos"), todos("pacientes")]);
    const nomes = new Map(pacs.map((p) => [p.id, p.nome]));
    return ags.map((a) => ({ ...a, paciente_nome: nomes.get(a.paciente_id) })).sort((x, y) => x.inicio.localeCompare(y.inicio));
  }
  async function conflitos(inicio, duracao, ignorarId = 0) {
    const ini = minutos(inicio);
    const fim = ini + duracao;
    return (await agendaComNomes()).filter(
      (a) =>
        a.inicio.slice(0, 10) === inicio.slice(0, 10) && !["cancelado", "faltou"].includes(a.status) && a.id !== ignorarId &&
        minutos(a.inicio) < fim && ini < minutos(a.inicio) + a.duracao_min,
    );
  }
  async function criarAgendamento(b) {
    const pacienteId = inteiro(b, "paciente_id", { obrigatorio: true, min: 1 });
    const inicio = dataHora(b, "inicio", true);
    const duracao = inteiro(b, "duracao_min", { min: 5 }) ?? 50;
    const obs = texto(b, "observacoes", { max: 2000 });
    const semanas = Math.min(inteiro(b, "repetir_semanas", { min: 1 }) ?? 1, 52);
    await pacienteOuErro(pacienteId);
    const datas = Array.from({ length: semanas }, (_, i) => somarDias(inicio, i * 7));
    if (!b.ignorar_conflitos) {
      for (const d of datas) {
        const c = await conflitos(d, duracao);
        if (c.length) {
          throw new ErroHttp(409, `Conflito de horário em ${d.replace("T", " ")} com ${c.map((x) => x.paciente_nome).join(", ")}`, { conflito: true });
        }
      }
    }
    const criados = [];
    for (const d of datas) {
      criados.push(await inserir("agendamentos", {
        paciente_id: pacienteId, inicio: d, duracao_min: duracao, status: "agendado", observacoes: obs, criado_em: agora(), atualizado_em: agora(),
      }));
    }
    await auditar("criar", "agendamento", pacienteId, `${semanas} sessão(ões) a partir de ${inicio}`);
    return criados;
  }
  async function atualizarAgendamento(id, corpo) {
    const atual = await um("agendamentos", id);
    if (!atual) throw new ErroHttp(404, "Agendamento não encontrado");
    const b = { ...atual, ...corpo };
    const inicio = dataHora(b, "inicio", true);
    const duracao = inteiro(b, "duracao_min", { min: 5 });
    const status = opcao(b, "status", STATUS_AG, "agendado");
    const pacienteId = inteiro(b, "paciente_id", { obrigatorio: true, min: 1 });
    await pacienteOuErro(pacienteId);
    const mudou = inicio !== atual.inicio || duracao !== atual.duracao_min;
    if (mudou && !b.ignorar_conflitos && status !== "cancelado") {
      const c = await conflitos(inicio, duracao, id);
      if (c.length) throw new ErroHttp(409, `Conflito de horário com ${c.map((x) => x.paciente_nome).join(", ")}`, { conflito: true });
    }
    const r = await gravar("agendamentos", {
      ...atual, paciente_id: pacienteId, inicio, duracao_min: duracao, status, observacoes: texto(b, "observacoes", { max: 2000 }), atualizado_em: agora(),
    });
    await auditar("atualizar", "agendamento", id, `status=${status}`);
    return r;
  }

  // ---------------------------------------------------------- pagamentos
  function camposPagamento(b) {
    return {
      paciente_id: inteiro(b, "paciente_id", { obrigatorio: true, min: 1 }),
      agendamento_id: inteiro(b, "agendamento_id", { min: 1 }),
      data: data(b, "data", true),
      valor_centavos: centavos(b, true),
      forma: opcao(b, "forma", FORMAS, "pix"),
      status: opcao(b, "status", STATUS_PAG, "pago"),
      referencia: texto(b, "referencia", { max: 200 }),
      observacoes: texto(b, "observacoes", { max: 2000 }),
    };
  }
  async function pagamentosComNomes() {
    const [pgs, pacs] = await Promise.all([todos("pagamentos"), todos("pacientes")]);
    const nomes = new Map(pacs.map((p) => [p.id, p.nome]));
    return pgs.map((g) => ({ ...g, paciente_nome: nomes.get(g.paciente_id) }));
  }
  async function criarPagamento(b) {
    const c = camposPagamento(b);
    await pacienteOuErro(c.paciente_id);
    const r = await inserir("pagamentos", { ...c, criado_em: agora(), atualizado_em: agora() });
    await auditar("criar", "pagamento", r.id);
    return r;
  }
  async function atualizarPagamento(id, corpo) {
    const atual = await um("pagamentos", id);
    if (!atual) throw new ErroHttp(404, "Pagamento não encontrado");
    const b = { ...atual, ...corpo };
    if (corpo.valor !== undefined) delete b.valor_centavos;
    const c = camposPagamento(b);
    const r = await gravar("pagamentos", { ...atual, ...c, atualizado_em: agora() });
    await auditar("atualizar", "pagamento", id, `status=${c.status}; valor=${c.valor_centavos}`);
    return r;
  }

  // ---------------------------------------------------------- prontuário (somente inclusão)
  async function criarEvolucao(pid, b) {
    await pacienteOuErro(pid);
    const textoEv = texto(b, "texto", { obrigatorio: true, max: 50000 });
    const tipo = opcao(b, "tipo", TIPOS_REGISTRO, "evolucao");
    const dataAt = data(b, "data_atendimento", true);
    const agId = inteiro(b, "agendamento_id", { min: 1 });
    const retifica = inteiro(b, "retifica_id", { min: 1 });
    if (retifica) {
      const orig = await um("evolucoes", retifica);
      if (!orig || orig.paciente_id !== pid) throw new ErroHttp(400, "Evolução a retificar não encontrada para este paciente");
    }
    const r = await inserir("evolucoes", {
      paciente_id: pid, agendamento_id: agId, tipo, data_atendimento: dataAt, texto: textoEv, retifica_id: retifica, autor_email: USUARIO, criado_em: agora(),
    });
    await auditar(retifica ? "retificar" : "criar", "registro do prontuário", pid, tipo);
    return r;
  }

  const MAX_ANEXO = 20 * 1024 * 1024;
  async function enviarAnexo(pid, fd) {
    await pacienteOuErro(pid);
    const arquivo = fd.get("arquivo");
    if (!arquivo || typeof arquivo === "string" || !arquivo.size) throw new ErroHttp(400, "Arquivo não enviado");
    if (arquivo.size > MAX_ANEXO) throw new ErroHttp(413, "Arquivo maior que 20 MB");
    const bytes = await arquivo.arrayBuffer();
    let hash = "";
    if (crypto.subtle) {
      hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    const nome = (arquivo.name || "arquivo").slice(0, 255);
    const r = await inserir("anexos", {
      paciente_id: pid, nome_arquivo: nome, tipo_mime: arquivo.type || "application/octet-stream", tamanho_bytes: bytes.byteLength,
      sha256: hash, descricao: String(fd.get("descricao") ?? "").slice(0, 500) || null, autor_email: USUARIO, criado_em: agora(),
      conteudo: new Blob([bytes], { type: arquivo.type || "application/octet-stream" }),
    });
    await auditar("criar", "anexo", pid, nome);
    const { conteudo, ...meta } = r;
    return meta;
  }

  // ---------------------------------------------------------- Excel
  async function exportar(comProntuario) {
    const [pacientes, agendamentos, pagamentos] = await Promise.all([todos("pacientes"), agendaComNomes(), pagamentosComNomes()]);
    const out = {
      gerado_em: new Date().toISOString(),
      pacientes: pacientes.sort(porNome),
      agendamentos,
      pagamentos: pagamentos.sort((a, b) => a.data.localeCompare(b.data)),
    };
    if (comProntuario) {
      const nomes = new Map(pacientes.map((p) => [p.id, p.nome]));
      out.evolucoes = (await todos("evolucoes"))
        .map((e) => ({ ...e, paciente_nome: nomes.get(e.paciente_id) }))
        .sort((a, b) => a.paciente_id - b.paciente_id || a.data_atendimento.localeCompare(b.data_atendimento) || a.id - b.id);
    }
    await auditar("exportar", "sistema", null, comProntuario ? "com prontuário" : "sem prontuário");
    return out;
  }

  async function importar(b) {
    const out = { inseridos: 0, atualizados: 0, erros: [] };
    const linhas = (k) => (Array.isArray(b[k]) ? b[k] : []);

    for (const [i, row] of linhas("pacientes").entries()) {
      try {
        const id = inteiro(row, "id", { min: 1 });
        if (id && (await um("pacientes", id))) {
          await atualizarPaciente(id, camposPaciente(row));
          out.atualizados++;
        } else {
          await criarPaciente(row);
          out.inseridos++;
        }
      } catch (e) {
        out.erros.push({ aba: "Pacientes", linha: i + 2, erro: e.message });
      }
    }

    const pacs = await todos("pacientes");
    const ids = new Set(pacs.map((p) => p.id));
    const mapa = new Map();
    for (const p of pacs) {
      const k = p.nome.trim().toLowerCase();
      mapa.set(k, [...(mapa.get(k) ?? []), p.id]);
    }
    const resolver = (row) => {
      const id = inteiro(row, "paciente_id", { min: 1 });
      if (id) {
        if (!ids.has(id)) throw new Error(`paciente_id ${id} inexistente`);
        return id;
      }
      const nome = texto(row, "paciente_nome", { obrigatorio: true });
      const achados = mapa.get(nome.toLowerCase()) ?? [];
      if (achados.length !== 1) {
        throw new Error(achados.length ? `Mais de um paciente chamado "${nome}"; informe o ID paciente` : `Paciente "${nome}" não encontrado`);
      }
      return achados[0];
    };

    for (const [i, row] of linhas("agendamentos").entries()) {
      try {
        const reg = {
          paciente_id: resolver(row),
          inicio: dataHora(row, "inicio", true),
          duracao_min: inteiro(row, "duracao_min", { min: 5 }) ?? 50,
          status: opcao(row, "status", STATUS_AG, "agendado"),
          observacoes: texto(row, "observacoes", { max: 2000 }),
        };
        const id = inteiro(row, "id", { min: 1 });
        const atual = id ? await um("agendamentos", id) : null;
        if (atual) {
          await gravar("agendamentos", { ...atual, ...reg, atualizado_em: agora() });
          out.atualizados++;
        } else {
          await inserir("agendamentos", { ...reg, criado_em: agora(), atualizado_em: agora() });
          out.inseridos++;
        }
      } catch (e) {
        out.erros.push({ aba: "Agenda", linha: i + 2, erro: e.message });
      }
    }

    for (const [i, row] of linhas("pagamentos").entries()) {
      try {
        const c = camposPagamento({ ...row, paciente_id: resolver(row) });
        const id = inteiro(row, "id", { min: 1 });
        const atual = id ? await um("pagamentos", id) : null;
        if (atual) {
          await gravar("pagamentos", { ...atual, ...c, atualizado_em: agora() });
          out.atualizados++;
        } else {
          await inserir("pagamentos", { ...c, criado_em: agora(), atualizado_em: agora() });
          out.inseridos++;
        }
      } catch (e) {
        out.erros.push({ aba: "Pagamentos", linha: i + 2, erro: e.message });
      }
    }
    await auditar("importar", "sistema", null, `inseridos=${out.inseridos}; atualizados=${out.atualizados}; erros=${out.erros.length}`);
    return out;
  }

  // ---------------------------------------------------------- backup completo (inclui anexos)
  const blobParaB64 = (blob) =>
    new Promise((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1] ?? "");
      r.onerror = () => falha(r.error);
      r.readAsDataURL(blob);
    });
  const b64ParaBlob = (b64, tipo) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  };

  async function gerarBackup() {
    const dados = {};
    for (const s of STORES) dados[s] = await todos(s);
    for (const a of dados.anexos) {
      if (!a.conteudo) a.conteudo = await baixarConteudoRemoto(a).catch(() => null);
      a.conteudo_base64 = a.conteudo ? await blobParaB64(a.conteudo) : null;
      delete a.conteudo;
    }
    await auditar("backup", "sistema", null);
    await salvarConfig("ultimo_backup", new Date().toISOString());
    return { formato: "consultorio-backup", versao: 1, gerado_em: new Date().toISOString(), dados };
  }

  async function restaurar(backup) {
    if (await config("sync")) {
      throw new ErroHttp(409, "A sincronização está ativa. Desconecte este aparelho da sincronização antes de restaurar uma cópia.");
    }
    if (backup?.formato !== "consultorio-backup" || !backup.dados) throw new ErroHttp(400, "Arquivo não é um backup deste aplicativo");
    const d = backup.dados;
    for (const a of d.anexos ?? []) {
      a.conteudo = a.conteudo_base64 ? b64ParaBlob(a.conteudo_base64, a.tipo_mime) : null;
      delete a.conteudo_base64;
    }
    await tx(STORES, "readwrite", async (os) => {
      for (const s of STORES) {
        os(s).clear();
        for (const r of d[s] ?? []) os(s).put(r);
      }
    });
    await auditar("restaurar", "sistema", null, `backup de ${backup.gerado_em}`);
    return { ok: true, pacientes: (d.pacientes ?? []).length };
  }

  // ---------------------------------------------------------- roteador
  const rotas = [];
  const rota = (metodo, padrao, fn) => {
    const nomes = [];
    const re = new RegExp("^" + padrao.replace(/:(\w+)/g, (_, n) => (nomes.push(n), "([^/]+)")) + "/?$");
    rotas.push({ metodo, re, nomes, fn });
  };
  const num = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, "Identificador inválido");
    return n;
  };

  rota("GET", "/api/eu", async () => ({ usuario: "Dados salvos só neste aparelho" }));

  rota("GET", "/api/pacientes", async ({ q }) => {
    const busca = (q.get("busca") || "").trim().toLowerCase();
    const digitos = busca.replace(/\D/g, "");
    return (await todos("pacientes"))
      .filter((p) => q.get("inativos") === "1" || p.ativo)
      .filter((p) => !busca || p.nome.toLowerCase().includes(busca) || (digitos && ((p.cpf || "").includes(digitos) || (p.telefone || "").replace(/\D/g, "").includes(digitos))))
      .sort(porNome);
  });
  rota("POST", "/api/pacientes", ({ corpo }) => criarPaciente(corpo));
  rota("GET", "/api/pacientes/:id", async ({ p }) => {
    const r = await pacienteOuErro(num(p.id));
    await auditar("leitura", "paciente", r.id);
    return r;
  });
  rota("PUT", "/api/pacientes/:id", ({ p, corpo }) => atualizarPaciente(num(p.id), corpo));

  rota("GET", "/api/pacientes/:id/evolucoes", async ({ p }) => {
    const pid = num(p.id);
    await pacienteOuErro(pid);
    await auditar("leitura", "prontuario", pid, "evoluções");
    return (await todos("evolucoes"))
      .filter((e) => e.paciente_id === pid)
      .sort((a, b) => b.data_atendimento.localeCompare(a.data_atendimento) || b.id - a.id);
  });
  rota("POST", "/api/pacientes/:id/evolucoes", ({ p, corpo }) => criarEvolucao(num(p.id), corpo));
  rota("GET", "/api/pacientes/:id/anexos", async ({ p }) => {
    const pid = num(p.id);
    return (await todos("anexos"))
      .filter((a) => a.paciente_id === pid)
      .map(({ conteudo, ...m }) => m)
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  });
  rota("POST", "/api/pacientes/:id/anexos", ({ p, corpo }) => enviarAnexo(num(p.id), corpo));

  rota("GET", "/api/agendamentos", async ({ q }) => {
    const de = q.get("de") ? data({ de: q.get("de") }, "de") : null;
    const ate = q.get("ate") ? somarDias(data({ ate: q.get("ate") }, "ate"), 1) : null;
    const pid = q.get("paciente_id") ? Number(q.get("paciente_id")) : null;
    return (await agendaComNomes()).filter((a) => (!de || a.inicio >= de) && (!ate || a.inicio < ate) && (!pid || a.paciente_id === pid));
  });
  rota("POST", "/api/agendamentos", ({ corpo }) => criarAgendamento(corpo));
  rota("PUT", "/api/agendamentos/:id", ({ p, corpo }) => atualizarAgendamento(num(p.id), corpo));

  rota("GET", "/api/pagamentos", async ({ q }) => {
    const de = q.get("de"), ate = q.get("ate"), st = q.get("status");
    const pid = q.get("paciente_id") ? Number(q.get("paciente_id")) : null;
    return (await pagamentosComNomes())
      .filter((g) => (!de || g.data >= de) && (!ate || g.data <= ate) && (!pid || g.paciente_id === pid) && (!st || g.status === st))
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  });
  rota("POST", "/api/pagamentos", ({ corpo }) => criarPagamento(corpo));
  rota("PUT", "/api/pagamentos/:id", ({ p, corpo }) => atualizarPagamento(num(p.id), corpo));

  rota("GET", "/api/resumo", async ({ q }) => {
    const mes = q.get("mes") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErroHttp(400, "Mês inválido (use AAAA-MM)");
    const [pgs, ags, pacs] = await Promise.all([todos("pagamentos"), todos("agendamentos"), todos("pacientes")]);
    const agrupar = (lista, campoValor) => {
      const m = new Map();
      for (const x of lista) {
        const g = m.get(x.status) ?? { status: x.status, qtd: 0, total: 0 };
        g.qtd++;
        if (campoValor) g.total += x[campoValor];
        m.set(x.status, g);
      }
      return [...m.values()];
    };
    const pagosPorAg = new Set(pgs.filter((g) => g.agendamento_id && g.status !== "cancelado").map((g) => g.agendamento_id));
    const pacMap = new Map(pacs.map((p) => [p.id, p]));
    return {
      mes,
      pagamentos: agrupar(pgs.filter((g) => g.data.slice(0, 7) === mes), "valor_centavos"),
      sessoes: agrupar(ags.filter((a) => a.inicio.slice(0, 7) === mes)).map(({ total, ...r }) => r),
      realizadas_sem_pagamento: ags
        .filter((a) => a.inicio.slice(0, 7) === mes && a.status === "realizado" && !pagosPorAg.has(a.id))
        .sort((a, b) => a.inicio.localeCompare(b.inicio))
        .map((a) => ({
          id: a.id, inicio: a.inicio, paciente_id: a.paciente_id,
          paciente_nome: pacMap.get(a.paciente_id)?.nome, valor_sessao_centavos: pacMap.get(a.paciente_id)?.valor_sessao_centavos ?? null,
        })),
    };
  });

  rota("GET", "/api/exportar", ({ q }) => exportar(q.get("prontuario") === "1"));
  rota("POST", "/api/importar", ({ corpo }) => importar(corpo));
  rota("GET", "/api/auditoria", async ({ q }) => {
    const limite = Math.min(Number(q.get("limite")) || 200, 1000);
    return (await todos("auditoria")).sort((a, b) => b.id - a.id).slice(0, limite);
  });

  async function request(metodo, caminho, corpo) {
    const url = new URL(caminho, "http://local");
    for (const r of rotas) {
      const m = url.pathname.match(r.re);
      if (!m || r.metodo !== metodo) continue;
      const p = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      try {
        return await r.fn({ p, q: url.searchParams, corpo: corpo ?? {} });
      } catch (e) {
        if (e instanceof ErroHttp) throw e;
        console.error(e);
        throw new ErroHttp(500, e?.message || "Erro ao gravar no aparelho");
      }
    }
    throw new ErroHttp(404, "Rota não encontrada");
  }

  async function baixarAnexo(id) {
    const a = await um("anexos", Number(id));
    if (!a) throw new ErroHttp(404, "Anexo não encontrado");
    if (!a.conteudo) {
      try {
        a.conteudo = await baixarConteudoRemoto(a);
      } catch (e) {
        throw new ErroHttp(503, "Este anexo foi enviado por outro aparelho e ainda não foi baixado. Conecte-se à internet e tente de novo.");
      }
      if (!a.conteudo) throw new ErroHttp(404, "Arquivo do anexo não encontrado");
    }
    await auditar("leitura", "anexo", a.id, a.nome_arquivo);
    return { blob: a.conteudo, nome: a.nome_arquivo };
  }

  // Pede ao navegador para não apagar os dados automaticamente quando faltar espaço.
  async function protegerArmazenamento() {
    try {
      const persistente = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.());
      const est = await navigator.storage?.estimate?.();
      return { persistente: !!persistente, usado: est?.usage ?? null, cota: est?.quota ?? null };
    } catch {
      return { persistente: false, usado: null, cota: null };
    }
  }


  // ================================================================ sincronização
  // Modelo: cada aparelho mantém todos os dados localmente e funciona sem internet.
  // Ao alterar um registro, ele entra na fila "pendentes". Quando há conexão:
  //   1) envia os pendentes, cada um criptografado (AES-256-GCM) com a chave derivada da senha;
  //   2) baixa as alterações dos outros aparelhos, decifra e aplica.
  // Conflito (mesmo registro alterado nos dois aparelhos): vale a alteração mais recente (_rev).
  // Prontuário e auditoria só recebem inclusões, então nunca há sobrescrita nesses registros.
  // O servidor só vê textos cifrados; a senha e a chave nunca saem do aparelho.

  const te = new TextEncoder();
  const td = new TextDecoder();
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytesParaB64 = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64ParaBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

  function gerarCodigoCofre() {
    const r = crypto.getRandomValues(new Uint8Array(12));
    const c = [...r].map((b) => ALFABETO[b % ALFABETO.length]).join("");
    return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
  }
  const normalizarCodigo = (c) => {
    const l = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return l.length === 12 ? `${l.slice(0, 4)}-${l.slice(4, 8)}-${l.slice(8, 12)}` : null;
  };

  // Senha -> (chave de criptografia, token de acesso ao servidor). PBKDF2-SHA256, 600 mil iterações.
  async function derivar(senha, cofre) {
    if (!crypto.subtle) throw new ErroHttp(400, "Este navegador não oferece criptografia. Atualize o navegador.");
    const base = await crypto.subtle.importKey("raw", te.encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: te.encode("consultorio-sync:" + cofre), iterations: 600000 }, base, 512),
    );
    const chave = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { chave, token: hex(bits.slice(32)) };
  }

  async function cifrar(chave, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, bytes));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  async function decifrar(chave, bytes) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, chave, bytes.slice(12)));
  }

  const estado = { situacao: "desligada", pendentes: 0, ultima: null, erro: null };
  function publicarEstado(mudou = {}) {
    Object.assign(estado, mudou);
    window.dispatchEvent(new CustomEvent("consultorio:sync", { detail: { ...estado } }));
  }

  async function chamar(cfg, metodo, caminho, corpo, binario = false) {
    const headers = { Authorization: `Bearer ${cfg.cofre}:${cfg.token}` };
    let body;
    if (corpo instanceof Uint8Array) body = corpo;
    else if (corpo !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(corpo);
    }
    let r;
    try {
      r = await fetch(cfg.servidor.replace(/\/+$/, "") + caminho, { method: metodo, headers, body });
    } catch {
      throw Object.assign(new Error("Sem conexão com o servidor de sincronização"), { offline: true });
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw Object.assign(new Error(d.erro || `Erro ${r.status} no servidor`), { status: r.status });
    }
    return binario ? new Uint8Array(await r.arrayBuffer()) : r.json();
  }

  async function baixarConteudoRemoto(a) {
    const cfg = await config("sync");
    if (!cfg) return null;
    const bytes = await decifrar(cfg.chave, await chamar(cfg, "GET", `/v1/arquivos/${a.id}`, undefined, true));
    const blob = new Blob([bytes], { type: a.tipo_mime });
    // guarda localmente (sem gerar nova pendência)
    await tx(["anexos"], "readwrite", async (os) => {
      const atual = await prom(os("anexos").get(a.id));
      if (atual && !atual.conteudo) os("anexos").put({ ...atual, conteudo: blob, _enviado: true });
    });
    return blob;
  }

  // Envia a fila de pendentes
  async function enviar(cfg) {
    const fila = await todos("pendentes");
    publicarEstado({ pendentes: fila.length });
    for (let i = 0; i < fila.length; i += 50) {
      const lote = fila.slice(i, i + 50);
      const itens = [];
      for (const p of lote) {
        const reg = await um(p.store, p.id);
        if (!reg) continue;
        const copia = { ...reg };
        if (p.store === "anexos") {
          if (copia.conteudo && !copia._enviado) {
            const bytes = new Uint8Array(await copia.conteudo.arrayBuffer());
            await chamar(cfg, "PUT", `/v1/arquivos/${copia.id}`, await cifrar(cfg.chave, bytes));
            await tx(["anexos"], "readwrite", (os) => os("anexos").put({ ...reg, _enviado: true }));
          }
          delete copia.conteudo;
          delete copia._enviado;
        }
        const dado = await cifrar(cfg.chave, te.encode(JSON.stringify({ s: p.store, r: copia })));
        itens.push(bytesParaB64(dado));
      }
      if (itens.length) await chamar(cfg, "POST", "/v1/mudancas", { dispositivo: cfg.dispositivo, itens });
      // remove da fila só o que não mudou enquanto enviávamos
      await tx(["pendentes"], "readwrite", async (os) => {
        for (const p of lote) {
          const atual = await prom(os("pendentes").get(p.chave));
          if (atual && atual.rev === p.rev) os("pendentes").delete(p.chave);
        }
      });
    }
  }

  // Baixa e aplica alterações dos outros aparelhos
  async function receber(cfg) {
    let desde = (await config("sync_seq")) || 0;
    let aplicados = 0;
    for (;;) {
      const r = await chamar(cfg, "GET", `/v1/mudancas?desde=${desde}&limite=500`);
      const regs = [];
      for (const it of r.itens) {
        try {
          regs.push(JSON.parse(td.decode(await decifrar(cfg.chave, b64ParaBytes(it.dado)))));
        } catch {
          throw new Error("Não foi possível decifrar dados recebidos. A senha deste aparelho está diferente da usada nos outros?");
        }
      }
      if (regs.length) {
        aplicados += await tx([...STORES, "pendentes"], "readwrite", async (os) => {
          let n = 0;
          for (const { s, r: reg } of regs) {
            if (!STORES.includes(s) || reg?.id == null) continue;
            const local = await prom(os(s).get(reg.id));
            if (local && (local._rev ?? 0) >= (reg._rev ?? 0)) continue; // local é igual ou mais novo
            const novo = { ...reg };
            if (s === "anexos" && local?.conteudo) Object.assign(novo, { conteudo: local.conteudo, _enviado: true });
            if (s === "anexos" && !local) novo._enviado = true; // conteúdo já está no servidor
            os(s).put(novo);
            os("pendentes").delete(`${s}:${reg.id}`); // alteração local mais antiga perdeu
            ultimaRev = Math.max(ultimaRev, reg._rev ?? 0);
            n++;
          }
          return n;
        });
      }
      desde = r.ultimo_seq;
      await salvarConfig("sync_seq", desde);
      if (!r.mais) break;
    }
    return aplicados;
  }

  let rodando = null;
  let deNovo = false;
  async function sincronizar() {
    if (rodando) {
      deNovo = true;
      return rodando;
    }
    rodando = (async () => {
      const cfg = await config("sync");
      if (!cfg) return publicarEstado({ situacao: "desligada" });
      do {
        deNovo = false;
        publicarEstado({ situacao: "sincronizando" });
        try {
          await enviar(cfg);
          const n = await receber(cfg);
          const pend = (await todos("pendentes")).length;
          const ultima = new Date().toISOString();
          await salvarConfig("sync_ultima", ultima);
          publicarEstado({ situacao: "ok", pendentes: pend, ultima, erro: null });
          if (n > 0) window.dispatchEvent(new CustomEvent("consultorio:dados-recebidos", { detail: { n } }));
        } catch (e) {
          const pend = (await todos("pendentes")).length;
          publicarEstado({ situacao: e.offline ? "offline" : "erro", pendentes: pend, erro: e.message });
          break;
        }
      } while (deNovo);
    })().finally(() => (rodando = null));
    return rodando;
  }

  let temporizador = null;
  aoAlterar = () => {
    publicarEstado({ pendentes: estado.pendentes + 1 });
    clearTimeout(temporizador);
    temporizador = setTimeout(sincronizar, 1500);
  };

  async function iniciarSync() {
    const cfg = await config("sync");
    if (!cfg) return publicarEstado({ situacao: "desligada" });
    estado.ultima = await config("sync_ultima");
    estado.pendentes = (await todos("pendentes")).length;
    sincronizar();
    if (iniciarSync.feito) return;
    iniciarSync.feito = true;
    setInterval(sincronizar, 30000);
    window.addEventListener("online", sincronizar);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sincronizar());
  }

  async function quantidadeLocal() {
    return (await todos("pacientes")).length + (await todos("evolucoes")).length + (await todos("agendamentos")).length;
  }

  // Primeiro aparelho: cria o cofre e envia tudo o que já existe.
  async function criarSync(servidor, senha) {
    if (!servidor) throw new ErroHttp(400, "Informe o endereço do servidor de sincronização");
    if (!senha || senha.length < 10) throw new ErroHttp(400, "Use uma senha com pelo menos 10 caracteres");
    const cofre = gerarCodigoCofre();
    const { chave, token } = await derivar(senha, cofre);
    const cfg = { servidor: servidor.trim(), cofre, token, chave, dispositivo: crypto.randomUUID() };
    await fetch(cfg.servidor.replace(/\/+$/, "") + "/v1/cofres", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cofre, token }),
    }).then(async (r) => {
      if (!r.ok) throw new ErroHttp(r.status, (await r.json().catch(() => ({}))).erro || `Erro ${r.status}`);
    }, () => {
      throw new ErroHttp(503, "Não foi possível falar com o servidor. Confira o endereço e a internet.");
    });
    // marca tudo o que já existe para envio
    await tx([...STORES, "pendentes"], "readwrite", async (os) => {
      for (const s of STORES) {
        for (const reg of await prom(os(s).getAll())) {
          const r = { ...reg, _rev: reg._rev ?? novaRev() };
          os(s).put(r);
          os("pendentes").put({ chave: `${s}:${r.id}`, store: s, id: r.id, rev: r._rev });
        }
      }
    });
    await salvarConfig("sync", cfg);
    await salvarConfig("sync_seq", 0);
    await auditar("ativar sincronização", "sistema", null, `cofre ${cofre}`);
    await iniciarSync();
    await sincronizar();
    return { cofre };
  }

  // Outro aparelho: entra no cofre existente. Os dados locais são substituídos pelos do cofre.
  async function conectarSync(servidor, codigo, senha) {
    const cofre = normalizarCodigo(codigo);
    if (!cofre) throw new ErroHttp(400, "Código do cofre inválido (formato XXXX-XXXX-XXXX)");
    if (!servidor) throw new ErroHttp(400, "Informe o endereço do servidor de sincronização");
    const { chave, token } = await derivar(senha, cofre);
    const cfg = { servidor: servidor.trim(), cofre, token, chave, dispositivo: crypto.randomUUID() };
    try {
      await chamar(cfg, "GET", "/v1/cofres/eu");
    } catch (e) {
      throw new ErroHttp(e.status || 503, e.status === 401 ? "Código do cofre ou senha incorretos" : e.message);
    }
    await tx([...STORES, "pendentes"], "readwrite", (os) => {
      for (const s of [...STORES, "pendentes"]) os(s).clear();
    });
    await salvarConfig("sync", cfg);
    await salvarConfig("sync_seq", 0);
    await iniciarSync();
    await sincronizar();
    if (estado.situacao === "erro") throw new ErroHttp(500, estado.erro);
    await auditar("conectar sincronização", "sistema", null, `cofre ${cofre}`);
    return { cofre };
  }

  async function desconectarSync() {
    await tx(["config"], "readwrite", (os) => {
      os("config").delete("sync");
      os("config").delete("sync_seq");
      os("config").delete("sync_ultima");
    });
    await auditar("desconectar sincronização", "sistema", null);
    await tx(["pendentes"], "readwrite", (os) => os("pendentes").clear());
    publicarEstado({ situacao: "desligada", pendentes: 0, erro: null });
  }

  async function infoSync() {
    const cfg = await config("sync");
    return cfg
      ? { ativa: true, cofre: cfg.cofre, servidor: cfg.servidor, ...estado, temDadosLocais: (await quantidadeLocal()) > 0 }
      : { ativa: false, servidorPadrao: window.CONSULTORIO_SYNC_URL || "", temDadosLocais: (await quantidadeLocal()) > 0 };
  }

  window.consultorioBackend = {
    request,
    baixarAnexo,
    gerarBackup,
    restaurar,
    protegerArmazenamento,
    ultimoBackup: () => config("ultimo_backup"),
    sync: { info: infoSync, criar: criarSync, conectar: conectarSync, desconectar: desconectarSync, agora: sincronizar },
  };
  iniciarSync();
})();
