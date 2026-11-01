import { ErroHttp, type Ctx } from "./types";
import {
  centavos,
  data,
  dataHora,
  FORMAS_PAGAMENTO,
  inteiro,
  opcao,
  STATUS_AGENDAMENTO,
  STATUS_PAGAMENTO,
  texto,
  TIPOS_REGISTRO,
} from "./validacao";

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- utilidades

export function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function corpo(ctx: Ctx): Promise<Obj> {
  try {
    const b = await ctx.req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b as Obj;
  } catch {
    throw new ErroHttp(400, "Corpo da requisição inválido (JSON esperado)");
  }
}

function idParam(ctx: Ctx, nome = "id"): number {
  const n = Number(ctx.params[nome]);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, "Identificador inválido");
  return n;
}

function auditoria(ctx: Ctx, acao: string, entidade: string, entidadeId: number | null, detalhe?: string) {
  return ctx.env.DB.prepare(
    "INSERT INTO auditoria (usuario, acao, entidade, entidade_id, detalhe, ip) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(ctx.usuario, acao, entidade, entidadeId, detalhe ?? null, ctx.req.headers.get("CF-Connecting-IP"));
}

/** Registra leituras sem atrasar a resposta. */
function auditarLeitura(ctx: Ctx, entidade: string, entidadeId: number | null, detalhe?: string) {
  ctx.exec.waitUntil(auditoria(ctx, "leitura", entidade, entidadeId, detalhe).run());
}

async function pacienteExiste(ctx: Ctx, id: number) {
  const r = await ctx.env.DB.prepare("SELECT id FROM pacientes WHERE id = ?").bind(id).first();
  if (!r) throw new ErroHttp(404, "Paciente não encontrado");
}

function minutos(inicio: string): number {
  const [hh, mm] = inicio.slice(11, 16).split(":").map(Number);
  return hh * 60 + mm;
}

function somarDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10) + dataIso.slice(10);
}

// ---------------------------------------------------------------- sessão

export async function eu(ctx: Ctx) {
  return json({ usuario: ctx.usuario });
}

// ---------------------------------------------------------------- pacientes

function camposPaciente(b: Obj) {
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
      b.valor_sessao !== undefined
        ? centavos({ valor: b.valor_sessao })
        : inteiro(b, "valor_sessao_centavos", { min: 0 }),
    observacoes: texto(b, "observacoes", { max: 5000 }),
    ativo: b.ativo === undefined ? 1 : b.ativo === false || b.ativo === 0 || b.ativo === "0" ? 0 : 1,
  };
}

export async function listarPacientes(ctx: Ctx) {
  const busca = ctx.url.searchParams.get("busca")?.trim();
  const inativos = ctx.url.searchParams.get("inativos") === "1";
  let sql = "SELECT * FROM pacientes WHERE 1=1";
  const args: unknown[] = [];
  if (!inativos) sql += " AND ativo = 1";
  if (busca) {
    sql += " AND (nome LIKE ? OR cpf LIKE ? OR telefone LIKE ?)";
    const t = `%${busca}%`;
    args.push(t, `%${busca.replace(/\D/g, "") || busca}%`, t);
  }
  sql += " ORDER BY nome COLLATE NOCASE";
  const { results } = await ctx.env.DB.prepare(sql).bind(...args).all();
  return json(results);
}

export async function obterPaciente(ctx: Ctx) {
  const id = idParam(ctx);
  const p = await ctx.env.DB.prepare("SELECT * FROM pacientes WHERE id = ?").bind(id).first();
  if (!p) throw new ErroHttp(404, "Paciente não encontrado");
  auditarLeitura(ctx, "paciente", id);
  return json(p);
}

export async function criarPaciente(ctx: Ctx) {
  const c = camposPaciente(await corpo(ctx));
  const r = await ctx.env.DB.prepare(
    `INSERT INTO pacientes (nome, cpf, data_nascimento, telefone, email, endereco, contato_emergencia,
       convenio, valor_sessao_centavos, observacoes, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(c.nome, c.cpf, c.data_nascimento, c.telefone, c.email, c.endereco, c.contato_emergencia,
      c.convenio, c.valor_sessao_centavos, c.observacoes, c.ativo)
    .first<Obj>();
  await auditoria(ctx, "criar", "paciente", r!.id as number).run();
  return json(r, 201);
}

export async function atualizarPaciente(ctx: Ctx) {
  const id = idParam(ctx);
  const atual = await ctx.env.DB.prepare("SELECT * FROM pacientes WHERE id = ?").bind(id).first<Obj>();
  if (!atual) throw new ErroHttp(404, "Paciente não encontrado");
  const c = camposPaciente({ ...atual, ...(await corpo(ctx)) });
  const [r] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE pacientes SET nome=?, cpf=?, data_nascimento=?, telefone=?, email=?, endereco=?,
         contato_emergencia=?, convenio=?, valor_sessao_centavos=?, observacoes=?, ativo=?,
         atualizado_em=datetime('now')
       WHERE id=? RETURNING *`,
    ).bind(c.nome, c.cpf, c.data_nascimento, c.telefone, c.email, c.endereco, c.contato_emergencia,
      c.convenio, c.valor_sessao_centavos, c.observacoes, c.ativo, id),
    auditoria(ctx, "atualizar", "paciente", id),
  ]);
  return json(r.results[0]);
}

// ---------------------------------------------------------------- agenda

const SQL_AGENDA = `SELECT a.*, p.nome AS paciente_nome
  FROM agendamentos a JOIN pacientes p ON p.id = a.paciente_id`;

export async function listarAgendamentos(ctx: Ctx) {
  const q = ctx.url.searchParams;
  let sql = SQL_AGENDA + " WHERE 1=1";
  const args: unknown[] = [];
  const de = q.get("de");
  const ate = q.get("ate");
  if (de) {
    sql += " AND a.inicio >= ?";
    args.push(data({ de }, "de"));
  }
  if (ate) {
    sql += " AND a.inicio < ?";
    args.push(somarDias(data({ ate }, "ate")!, 1));
  }
  const pid = q.get("paciente_id");
  if (pid) {
    sql += " AND a.paciente_id = ?";
    args.push(Number(pid));
  }
  sql += " ORDER BY a.inicio";
  const { results } = await ctx.env.DB.prepare(sql).bind(...args).all();
  return json(results);
}

async function conflitos(ctx: Ctx, inicio: string, duracao: number, ignorarId?: number) {
  const { results } = await ctx.env.DB.prepare(
    `${SQL_AGENDA} WHERE substr(a.inicio, 1, 10) = ? AND a.status NOT IN ('cancelado', 'faltou') AND a.id != ?`,
  )
    .bind(inicio.slice(0, 10), ignorarId ?? 0)
    .all<Obj>();
  const ini = minutos(inicio);
  const fim = ini + duracao;
  return results.filter((a) => {
    const i = minutos(a.inicio as string);
    return i < fim && ini < i + (a.duracao_min as number);
  });
}

export async function criarAgendamento(ctx: Ctx) {
  const b = await corpo(ctx);
  const pacienteId = inteiro(b, "paciente_id", { obrigatorio: true, min: 1 })!;
  const inicio = dataHora(b, "inicio", true)!;
  const duracao = inteiro(b, "duracao_min", { min: 5 }) ?? 50;
  const obs = texto(b, "observacoes", { max: 2000 });
  const semanas = Math.min(inteiro(b, "repetir_semanas", { min: 1 }) ?? 1, 52);
  await pacienteExiste(ctx, pacienteId);

  const datas = Array.from({ length: semanas }, (_, i) => somarDias(inicio, i * 7));
  if (!b.ignorar_conflitos) {
    for (const d of datas) {
      const c = await conflitos(ctx, d, duracao);
      if (c.length) {
        return json(
          {
            erro: `Conflito de horário em ${d.replace("T", " ")} com ${c.map((x) => x.paciente_nome).join(", ")}`,
            conflito: true,
          },
          409,
        );
      }
    }
  }

  const stmts = datas.map((d) =>
    ctx.env.DB.prepare(
      "INSERT INTO agendamentos (paciente_id, inicio, duracao_min, observacoes) VALUES (?, ?, ?, ?) RETURNING *",
    ).bind(pacienteId, d, duracao, obs),
  );
  stmts.push(auditoria(ctx, "criar", "agendamento", pacienteId, `${semanas} sessão(ões) a partir de ${inicio}`));
  const res = await ctx.env.DB.batch(stmts);
  return json(res.slice(0, -1).map((r) => r.results[0]), 201);
}

export async function atualizarAgendamento(ctx: Ctx) {
  const id = idParam(ctx);
  const atual = await ctx.env.DB.prepare("SELECT * FROM agendamentos WHERE id = ?").bind(id).first<Obj>();
  if (!atual) throw new ErroHttp(404, "Agendamento não encontrado");
  const b = { ...atual, ...(await corpo(ctx)) };
  const inicio = dataHora(b, "inicio", true)!;
  const duracao = inteiro(b, "duracao_min", { min: 5 })!;
  const status = opcao(b, "status", STATUS_AGENDAMENTO, "agendado");
  const pacienteId = inteiro(b, "paciente_id", { obrigatorio: true, min: 1 })!;
  await pacienteExiste(ctx, pacienteId);

  const mudouHorario = inicio !== atual.inicio || duracao !== atual.duracao_min;
  if (mudouHorario && !b.ignorar_conflitos && status !== "cancelado") {
    const c = await conflitos(ctx, inicio, duracao, id);
    if (c.length) {
      return json({ erro: `Conflito de horário com ${c.map((x) => x.paciente_nome).join(", ")}`, conflito: true }, 409);
    }
  }
  const [r] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE agendamentos SET paciente_id=?, inicio=?, duracao_min=?, status=?, observacoes=?,
         atualizado_em=datetime('now') WHERE id=? RETURNING *`,
    ).bind(pacienteId, inicio, duracao, status, texto(b, "observacoes", { max: 2000 }), id),
    auditoria(ctx, "atualizar", "agendamento", id, `status=${status}`),
  ]);
  return json(r.results[0]);
}

export async function excluirAgendamento(ctx: Ctx) {
  const id = idParam(ctx);
  const vinculos = await ctx.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM evolucoes WHERE agendamento_id = ?) +
            (SELECT COUNT(*) FROM pagamentos WHERE agendamento_id = ?) AS n`,
  )
    .bind(id, id)
    .first<{ n: number }>();
  if (vinculos && vinculos.n > 0) {
    throw new ErroHttp(409, "Agendamento possui evolução ou pagamento vinculado; marque como cancelado.");
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM agendamentos WHERE id = ?").bind(id),
    auditoria(ctx, "excluir", "agendamento", id),
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------- pagamentos

const SQL_PAG = `SELECT g.*, p.nome AS paciente_nome
  FROM pagamentos g JOIN pacientes p ON p.id = g.paciente_id`;

function camposPagamento(b: Obj) {
  return {
    paciente_id: inteiro(b, "paciente_id", { obrigatorio: true, min: 1 })!,
    agendamento_id: inteiro(b, "agendamento_id", { min: 1 }),
    data: data(b, "data", true)!,
    valor_centavos: centavos(b, true)!,
    forma: opcao(b, "forma", FORMAS_PAGAMENTO, "pix")!,
    status: opcao(b, "status", STATUS_PAGAMENTO, "pago")!,
    referencia: texto(b, "referencia", { max: 200 }),
    observacoes: texto(b, "observacoes", { max: 2000 }),
  };
}

export async function listarPagamentos(ctx: Ctx) {
  const q = ctx.url.searchParams;
  let sql = SQL_PAG + " WHERE 1=1";
  const args: unknown[] = [];
  const de = q.get("de");
  const ate = q.get("ate");
  if (de) {
    sql += " AND g.data >= ?";
    args.push(data({ de }, "de"));
  }
  if (ate) {
    sql += " AND g.data <= ?";
    args.push(data({ ate }, "ate"));
  }
  const pid = q.get("paciente_id");
  if (pid) {
    sql += " AND g.paciente_id = ?";
    args.push(Number(pid));
  }
  const st = q.get("status");
  if (st) {
    sql += " AND g.status = ?";
    args.push(opcao({ st }, "st", STATUS_PAGAMENTO));
  }
  sql += " ORDER BY g.data DESC, g.id DESC";
  const { results } = await ctx.env.DB.prepare(sql).bind(...args).all();
  return json(results);
}

export async function criarPagamento(ctx: Ctx) {
  const c = camposPagamento(await corpo(ctx));
  await pacienteExiste(ctx, c.paciente_id);
  const r = await ctx.env.DB.prepare(
    `INSERT INTO pagamentos (paciente_id, agendamento_id, data, valor_centavos, forma, status, referencia, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(c.paciente_id, c.agendamento_id, c.data, c.valor_centavos, c.forma, c.status, c.referencia, c.observacoes)
    .first<Obj>();
  await auditoria(ctx, "criar", "pagamento", r!.id as number).run();
  return json(r, 201);
}

export async function atualizarPagamento(ctx: Ctx) {
  const id = idParam(ctx);
  const atual = await ctx.env.DB.prepare("SELECT * FROM pagamentos WHERE id = ?").bind(id).first<Obj>();
  if (!atual) throw new ErroHttp(404, "Pagamento não encontrado");
  const b = { ...atual, ...(await corpo(ctx)) };
  if (b.valor !== undefined) delete b.valor_centavos;
  const c = camposPagamento(b);
  const [r] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE pagamentos SET paciente_id=?, agendamento_id=?, data=?, valor_centavos=?, forma=?, status=?,
         referencia=?, observacoes=?, atualizado_em=datetime('now') WHERE id=? RETURNING *`,
    ).bind(c.paciente_id, c.agendamento_id, c.data, c.valor_centavos, c.forma, c.status, c.referencia,
      c.observacoes, id),
    auditoria(ctx, "atualizar", "pagamento", id, `status=${c.status}; valor=${c.valor_centavos}`),
  ]);
  return json(r.results[0]);
}

export async function resumoFinanceiro(ctx: Ctx) {
  const mes = ctx.url.searchParams.get("mes") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErroHttp(400, "Mês inválido (use AAAA-MM)");
  const pag = await ctx.env.DB.prepare(
    `SELECT status, COUNT(*) AS qtd, COALESCE(SUM(valor_centavos), 0) AS total
     FROM pagamentos WHERE substr(data, 1, 7) = ? GROUP BY status`,
  )
    .bind(mes)
    .all();
  const sessoes = await ctx.env.DB.prepare(
    `SELECT status, COUNT(*) AS qtd FROM agendamentos WHERE substr(inicio, 1, 7) = ? GROUP BY status`,
  )
    .bind(mes)
    .all();
  // Sessões realizadas sem nenhum pagamento vinculado (possível valor a receber).
  const semPagamento = await ctx.env.DB.prepare(
    `SELECT a.id, a.inicio, a.paciente_id, p.nome AS paciente_nome, p.valor_sessao_centavos
     FROM agendamentos a JOIN pacientes p ON p.id = a.paciente_id
     WHERE substr(a.inicio, 1, 7) = ? AND a.status = 'realizado'
       AND NOT EXISTS (SELECT 1 FROM pagamentos g WHERE g.agendamento_id = a.id AND g.status != 'cancelado')
     ORDER BY a.inicio`,
  )
    .bind(mes)
    .all();
  return json({ mes, pagamentos: pag.results, sessoes: sessoes.results, realizadas_sem_pagamento: semPagamento.results });
}

// ---------------------------------------------------------------- prontuário

export async function listarEvolucoes(ctx: Ctx) {
  const pid = idParam(ctx);
  await pacienteExiste(ctx, pid);
  const { results } = await ctx.env.DB.prepare(
    "SELECT * FROM evolucoes WHERE paciente_id = ? ORDER BY data_atendimento DESC, id DESC",
  )
    .bind(pid)
    .all();
  auditarLeitura(ctx, "prontuario", pid, "evoluções");
  return json(results);
}

export async function criarEvolucao(ctx: Ctx) {
  const pid = idParam(ctx);
  await pacienteExiste(ctx, pid);
  const b = await corpo(ctx);
  const textoEv = texto(b, "texto", { obrigatorio: true, max: 50000 })!;
  const tipo = opcao(b, "tipo", TIPOS_REGISTRO, "evolucao");
  const dataAt = data(b, "data_atendimento", true)!;
  const agId = inteiro(b, "agendamento_id", { min: 1 });
  const retifica = inteiro(b, "retifica_id", { min: 1 });
  if (retifica) {
    const orig = await ctx.env.DB.prepare("SELECT paciente_id FROM evolucoes WHERE id = ?").bind(retifica).first<Obj>();
    if (!orig || orig.paciente_id !== pid) throw new ErroHttp(400, "Evolução a retificar não encontrada para este paciente");
  }
  const [r] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO evolucoes (paciente_id, agendamento_id, tipo, data_atendimento, texto, retifica_id, autor_email)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(pid, agId, tipo, dataAt, textoEv, retifica, ctx.usuario),
    auditoria(ctx, retifica ? "retificar" : "criar", "evolucao", pid),
  ]);
  return json(r.results[0], 201);
}

const MAX_ANEXO = 20 * 1024 * 1024; // 20 MB

export async function listarAnexos(ctx: Ctx) {
  const pid = idParam(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, paciente_id, nome_arquivo, tipo_mime, tamanho_bytes, sha256, descricao, autor_email, criado_em
     FROM anexos WHERE paciente_id = ? ORDER BY criado_em DESC`,
  )
    .bind(pid)
    .all();
  auditarLeitura(ctx, "prontuario", pid, "lista de anexos");
  return json(results);
}

export async function enviarAnexo(ctx: Ctx) {
  const pid = idParam(ctx);
  await pacienteExiste(ctx, pid);
  const form = await ctx.req.formData().catch(() => {
    throw new ErroHttp(400, "Envio inválido (multipart/form-data esperado)");
  });
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") throw new ErroHttp(400, "Arquivo não enviado");
  if (arquivo.size > MAX_ANEXO) throw new ErroHttp(413, "Arquivo maior que 20 MB");
  const bytes = await arquivo.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const chave = `pacientes/${pid}/${crypto.randomUUID()}`;
  const tipo = arquivo.type || "application/octet-stream";
  const nome = arquivo.name.slice(0, 255) || "arquivo";
  await ctx.env.ANEXOS.put(chave, bytes, {
    httpMetadata: { contentType: tipo },
    customMetadata: { paciente_id: String(pid), nome, sha256: hash, enviado_por: ctx.usuario },
  });
  const [r] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO anexos (paciente_id, chave_r2, nome_arquivo, tipo_mime, tamanho_bytes, sha256, descricao, autor_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, nome_arquivo, tamanho_bytes, sha256, criado_em`,
    ).bind(pid, chave, nome, tipo, bytes.byteLength, hash, String(form.get("descricao") ?? "").slice(0, 500) || null,
      ctx.usuario),
    auditoria(ctx, "criar", "anexo", pid, nome),
  ]);
  return json(r.results[0], 201);
}

export async function baixarAnexo(ctx: Ctx) {
  const id = idParam(ctx);
  const a = await ctx.env.DB.prepare("SELECT * FROM anexos WHERE id = ?").bind(id).first<Obj>();
  if (!a) throw new ErroHttp(404, "Anexo não encontrado");
  const obj = await ctx.env.ANEXOS.get(a.chave_r2 as string);
  if (!obj) throw new ErroHttp(404, "Arquivo não encontrado no armazenamento");
  auditarLeitura(ctx, "anexo", id, a.nome_arquivo as string);
  const nome = encodeURIComponent(a.nome_arquivo as string);
  return new Response(obj.body, {
    headers: {
      "Content-Type": a.tipo_mime as string,
      "Content-Disposition": `attachment; filename*=UTF-8''${nome}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------- auditoria

export async function listarAuditoria(ctx: Ctx) {
  const limite = Math.min(Number(ctx.url.searchParams.get("limite")) || 200, 1000);
  const { results } = await ctx.env.DB.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT ?").bind(limite).all();
  return json(results);
}

// ---------------------------------------------------------------- Excel (exportação / importação)
// A conversão de/para .xlsx é feita no navegador; aqui trafega JSON.

export async function exportar(ctx: Ctx) {
  const comProntuario = ctx.url.searchParams.get("prontuario") === "1";
  const db = ctx.env.DB;
  const consultas = [
    db.prepare("SELECT * FROM pacientes ORDER BY nome COLLATE NOCASE"),
    db.prepare(SQL_AGENDA + " ORDER BY a.inicio"),
    db.prepare(SQL_PAG + " ORDER BY g.data"),
  ];
  if (comProntuario) {
    consultas.push(
      db.prepare(
        `SELECT e.*, p.nome AS paciente_nome FROM evolucoes e JOIN pacientes p ON p.id = e.paciente_id
         ORDER BY e.paciente_id, e.data_atendimento, e.id`,
      ),
    );
  }
  consultas.push(auditoria(ctx, "exportar", "sistema", null, comProntuario ? "com prontuário" : "sem prontuário"));
  const res = await db.batch(consultas);
  return json({
    gerado_em: new Date().toISOString(),
    pacientes: res[0].results,
    agendamentos: res[1].results,
    pagamentos: res[2].results,
    ...(comProntuario ? { evolucoes: res[3].results } : {}),
  });
}

interface ResultadoImportacao {
  inseridos: number;
  atualizados: number;
  erros: { aba: string; linha: number; erro: string }[];
}

async function executarEmLotes(ctx: Ctx, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 50) await ctx.env.DB.batch(stmts.slice(i, i + 50));
}

export async function importar(ctx: Ctx) {
  const b = await corpo(ctx);
  const out: ResultadoImportacao = { inseridos: 0, atualizados: 0, erros: [] };
  const linhas = (k: string) => (Array.isArray(b[k]) ? (b[k] as Obj[]) : []);
  const db = ctx.env.DB;

  // 1) Pacientes
  const stmtsPac: D1PreparedStatement[] = [];
  linhas("pacientes").forEach((row, i) => {
    try {
      const c = camposPaciente(row);
      const id = inteiro(row, "id", { min: 1 });
      if (id) {
        stmtsPac.push(
          db.prepare(
            `UPDATE pacientes SET nome=?, cpf=?, data_nascimento=?, telefone=?, email=?, endereco=?,
               contato_emergencia=?, convenio=?, valor_sessao_centavos=?, observacoes=?, ativo=?,
               atualizado_em=datetime('now') WHERE id=?`,
          ).bind(c.nome, c.cpf, c.data_nascimento, c.telefone, c.email, c.endereco, c.contato_emergencia,
            c.convenio, c.valor_sessao_centavos, c.observacoes, c.ativo, id),
        );
        out.atualizados++;
      } else {
        stmtsPac.push(
          db.prepare(
            `INSERT INTO pacientes (nome, cpf, data_nascimento, telefone, email, endereco, contato_emergencia,
               convenio, valor_sessao_centavos, observacoes, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(c.nome, c.cpf, c.data_nascimento, c.telefone, c.email, c.endereco, c.contato_emergencia,
            c.convenio, c.valor_sessao_centavos, c.observacoes, c.ativo),
        );
        out.inseridos++;
      }
    } catch (e) {
      out.erros.push({ aba: "Pacientes", linha: i + 2, erro: (e as Error).message });
    }
  });
  try {
    await executarEmLotes(ctx, stmtsPac);
  } catch (e) {
    throw new ErroHttp(400, `Erro ao gravar pacientes (CPF duplicado?): ${(e as Error).message}`);
  }

  // Mapa nome -> id, para planilhas que identificam o paciente pelo nome.
  const { results: todos } = await db.prepare("SELECT id, nome FROM pacientes").all<{ id: number; nome: string }>();
  const porNome = new Map<string, number[]>();
  for (const p of todos) {
    const k = p.nome.trim().toLowerCase();
    porNome.set(k, [...(porNome.get(k) ?? []), p.id]);
  }
  const ids = new Set(todos.map((p) => p.id));
  const resolverPaciente = (row: Obj): number => {
    const id = inteiro(row, "paciente_id", { min: 1 });
    if (id) {
      if (!ids.has(id)) throw new Error(`paciente_id ${id} inexistente`);
      return id;
    }
    const nome = texto(row, "paciente_nome", { obrigatorio: true });
    const achados = porNome.get(nome!.toLowerCase()) ?? [];
    if (achados.length !== 1) {
      throw new Error(achados.length ? `Mais de um paciente chamado "${nome}"; informe paciente_id` : `Paciente "${nome}" não encontrado`);
    }
    return achados[0];
  };

  // 2) Agendamentos
  const stmtsAg: D1PreparedStatement[] = [];
  linhas("agendamentos").forEach((row, i) => {
    try {
      const pid = resolverPaciente(row);
      const inicio = dataHora(row, "inicio", true);
      const dur = inteiro(row, "duracao_min", { min: 5 }) ?? 50;
      const st = opcao(row, "status", STATUS_AGENDAMENTO, "agendado");
      const obs = texto(row, "observacoes", { max: 2000 });
      const id = inteiro(row, "id", { min: 1 });
      if (id) {
        stmtsAg.push(
          db.prepare(
            `UPDATE agendamentos SET paciente_id=?, inicio=?, duracao_min=?, status=?, observacoes=?,
               atualizado_em=datetime('now') WHERE id=?`,
          ).bind(pid, inicio, dur, st, obs, id),
        );
        out.atualizados++;
      } else {
        stmtsAg.push(
          db.prepare("INSERT INTO agendamentos (paciente_id, inicio, duracao_min, status, observacoes) VALUES (?, ?, ?, ?, ?)")
            .bind(pid, inicio, dur, st, obs),
        );
        out.inseridos++;
      }
    } catch (e) {
      out.erros.push({ aba: "Agenda", linha: i + 2, erro: (e as Error).message });
    }
  });
  await executarEmLotes(ctx, stmtsAg);

  // 3) Pagamentos
  const stmtsPg: D1PreparedStatement[] = [];
  linhas("pagamentos").forEach((row, i) => {
    try {
      const c = camposPagamento({ ...row, paciente_id: resolverPaciente(row) });
      const id = inteiro(row, "id", { min: 1 });
      if (id) {
        stmtsPg.push(
          db.prepare(
            `UPDATE pagamentos SET paciente_id=?, agendamento_id=?, data=?, valor_centavos=?, forma=?, status=?,
               referencia=?, observacoes=?, atualizado_em=datetime('now') WHERE id=?`,
          ).bind(c.paciente_id, c.agendamento_id, c.data, c.valor_centavos, c.forma, c.status, c.referencia,
            c.observacoes, id),
        );
        out.atualizados++;
      } else {
        stmtsPg.push(
          db.prepare(
            `INSERT INTO pagamentos (paciente_id, agendamento_id, data, valor_centavos, forma, status, referencia, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(c.paciente_id, c.agendamento_id, c.data, c.valor_centavos, c.forma, c.status, c.referencia,
            c.observacoes),
        );
        out.inseridos++;
      }
    } catch (e) {
      out.erros.push({ aba: "Pagamentos", linha: i + 2, erro: (e as Error).message });
    }
  });
  await executarEmLotes(ctx, stmtsPg);

  await auditoria(ctx, "importar", "sistema", null, `inseridos=${out.inseridos}; atualizados=${out.atualizados}; erros=${out.erros.length}`).run();
  return json(out);
}
