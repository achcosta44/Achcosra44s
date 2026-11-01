// Servidor de sincronização "cego": recebe, guarda e devolve dados criptografados.
// Não tem a senha nem a chave; não consegue ler nenhum dado de paciente.
//
// Rotas (todas exigem "Authorization: Bearer <cofre>:<token>", exceto a criação):
//   POST /v1/cofres                 { cofre, token }          cria o cofre
//   GET  /v1/cofres/eu                                         valida credenciais
//   POST /v1/mudancas               { dispositivo, itens: [dado, ...] }
//   GET  /v1/mudancas?desde=N&limite=M
//   PUT  /v1/arquivos/:id           (corpo binário criptografado)
//   GET  /v1/arquivos/:id

export interface Env {
  DB: D1Database;
  ARQUIVOS: R2Bucket;
  MAX_COFRES: string;
}

const RE_COFRE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const RE_TOKEN = /^[0-9a-f]{64}$/;
const RE_ID = /^[0-9]{1,20}$/;
const MAX_ITEM = 1_000_000; // 1 MB por registro criptografado
const MAX_ITENS = 200;
const MAX_ARQUIVO = 25 * 1024 * 1024;

const CORS = {
  // O app roda a partir de um arquivo local (origem "null"); a proteção é o token, não a origem.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

class ErroHttp extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function autenticar(req: Request, env: Env): Promise<string> {
  const m = (req.headers.get("Authorization") ?? "").match(/^Bearer ([A-Z2-9-]{14}):([0-9a-f]{64})$/);
  if (!m || !RE_COFRE.test(m[1])) throw new ErroHttp(401, "Credenciais ausentes");
  const linha = await env.DB.prepare("SELECT token_hash FROM cofres WHERE id = ?").bind(m[1]).first<{ token_hash: string }>();
  if (!linha || !iguais(linha.token_hash, await sha256(m[2]))) throw new ErroHttp(401, "Código do cofre ou senha incorretos");
  return m[1];
}

async function corpoJson(req: Request, max: number): Promise<Record<string, unknown>> {
  const tam = Number(req.headers.get("Content-Length") ?? 0);
  if (tam > max) throw new ErroHttp(413, "Envio grande demais");
  const texto = await req.text();
  if (texto.length > max) throw new ErroHttp(413, "Envio grande demais");
  try {
    const o = JSON.parse(texto);
    if (o && typeof o === "object" && !Array.isArray(o)) return o;
  } catch {}
  throw new ErroHttp(400, "JSON inválido");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const caminho = url.pathname.replace(/\/+$/, "");

    try {
      if (caminho === "" || caminho === "/") return json({ servico: "consultorio-sync", ok: true });

      if (req.method === "POST" && caminho === "/v1/cofres") {
        const b = await corpoJson(req, 10_000);
        const cofre = String(b.cofre ?? "");
        const token = String(b.token ?? "");
        if (!RE_COFRE.test(cofre) || !RE_TOKEN.test(token)) throw new ErroHttp(400, "Dados inválidos");
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cofres").first<{ n: number }>();
        if ((n?.n ?? 0) >= Number(env.MAX_COFRES || "2")) {
          throw new ErroHttp(403, "Limite de cofres deste servidor atingido");
        }
        try {
          await env.DB.prepare("INSERT INTO cofres (id, token_hash) VALUES (?, ?)").bind(cofre, await sha256(token)).run();
        } catch {
          throw new ErroHttp(409, "Cofre já existe");
        }
        return json({ ok: true }, 201);
      }

      const cofre = await autenticar(req, env);

      if (req.method === "GET" && caminho === "/v1/cofres/eu") return json({ cofre });

      if (req.method === "POST" && caminho === "/v1/mudancas") {
        const b = await corpoJson(req, MAX_ITENS * MAX_ITEM);
        const disp = String(b.dispositivo ?? "").slice(0, 64);
        const itens = b.itens;
        if (!disp || !Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS) {
          throw new ErroHttp(400, "Lote inválido");
        }
        for (const it of itens) {
          if (typeof it !== "string" || it.length > MAX_ITEM || !/^[A-Za-z0-9+/=]+$/.test(it)) throw new ErroHttp(400, "Item inválido");
        }
        const stmt = env.DB.prepare("INSERT INTO mudancas (cofre, dispositivo, dado) VALUES (?, ?, ?)");
        await env.DB.batch(itens.map((it) => stmt.bind(cofre, disp, it)));
        const ult = await env.DB.prepare("SELECT MAX(seq) AS s FROM mudancas WHERE cofre = ?").bind(cofre).first<{ s: number }>();
        return json({ ok: true, ultimo_seq: ult?.s ?? 0 });
      }

      if (req.method === "GET" && caminho === "/v1/mudancas") {
        const desde = Math.max(0, Number(url.searchParams.get("desde")) || 0);
        const limite = Math.min(Math.max(1, Number(url.searchParams.get("limite")) || 500), 1000);
        const { results } = await env.DB.prepare(
          "SELECT seq, dado FROM mudancas WHERE cofre = ? AND seq > ? ORDER BY seq LIMIT ?",
        )
          .bind(cofre, desde, limite + 1)
          .all<{ seq: number; dado: string }>();
        const mais = results.length > limite;
        const itens = results.slice(0, limite);
        return json({ itens, mais, ultimo_seq: itens.length ? itens[itens.length - 1].seq : desde });
      }

      const mArq = caminho.match(/^\/v1\/arquivos\/([^/]+)$/);
      if (mArq) {
        if (!RE_ID.test(mArq[1])) throw new ErroHttp(400, "Identificador inválido");
        const chave = `${cofre}/${mArq[1]}`;
        if (req.method === "PUT") {
          const tam = Number(req.headers.get("Content-Length") ?? 0);
          if (!tam || tam > MAX_ARQUIVO) throw new ErroHttp(413, "Arquivo grande demais");
          await env.ARQUIVOS.put(chave, req.body, { httpMetadata: { contentType: "application/octet-stream" } });
          return json({ ok: true });
        }
        if (req.method === "GET") {
          const obj = await env.ARQUIVOS.get(chave);
          if (!obj) throw new ErroHttp(404, "Arquivo não encontrado");
          return new Response(obj.body, { headers: { ...CORS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
        }
      }

      throw new ErroHttp(404, "Rota não encontrada");
    } catch (e) {
      if (e instanceof ErroHttp) return json({ erro: e.message }, e.status);
      console.error(e);
      return json({ erro: "Erro interno" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
