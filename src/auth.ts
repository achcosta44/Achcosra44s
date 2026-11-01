// Autenticação via Cloudflare Access.
// O Access fica na frente do app e exige login (código por e-mail, Google etc.).
// Mesmo assim, o Worker valida o JWT assinado pelo Access em toda chamada à API,
// para que ninguém consiga chamar a API contornando o Access (ex.: pelo domínio workers.dev).

import type { Env } from "./types";

interface Jwk extends JsonWebKey {
  kid: string;
}

let jwksCache: { keys: Jwk[]; expira: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function obterChaves(teamDomain: string, forcar = false): Promise<Jwk[]> {
  if (!forcar && jwksCache && jwksCache.expira > Date.now()) return jwksCache.keys;
  const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error(`Falha ao obter chaves do Access: ${resp.status}`);
  const corpo = (await resp.json()) as { keys: Jwk[] };
  jwksCache = { keys: corpo.keys, expira: Date.now() + 60 * 60 * 1000 };
  return corpo.keys;
}

async function verificarJwt(token: string, env: Env): Promise<Record<string, unknown>> {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("JWT malformado");
  const [h, p, s] = partes;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h))) as { alg: string; kid: string };
  if (header.alg !== "RS256") throw new Error("Algoritmo não suportado");

  let chaves = await obterChaves(env.ACCESS_TEAM_DOMAIN);
  let jwk = chaves.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Chaves do Access são rotacionadas periodicamente.
    chaves = await obterChaves(env.ACCESS_TEAM_DOMAIN, true);
    jwk = chaves.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Chave de assinatura desconhecida");

  const chave = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valido = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valido) throw new Error("Assinatura inválida");

  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Record<string, unknown>;
  const agora = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < agora) throw new Error("Sessão expirada");
  if (typeof payload.nbf === "number" && payload.nbf > agora + 60) throw new Error("Token ainda não válido");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error("Audiência inválida");
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error("Emissor inválido");
  return payload;
}

function lerCookie(req: Request, nome: string): string | null {
  const cookies = req.headers.get("Cookie") ?? "";
  for (const parte of cookies.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return v.join("=");
  }
  return null;
}

/** Retorna o e-mail do usuário autenticado ou lança erro. */
export async function autenticar(req: Request, env: Env): Promise<string> {
  const url = new URL(req.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (env.DEV_AUTH_BYPASS === "true") {
    if (local) return "dev@localhost";
    throw new Error("DEV_AUTH_BYPASS só pode ser usado em ambiente local");
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new Error("Cloudflare Access não configurado (ACCESS_TEAM_DOMAIN / ACCESS_AUD)");
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion") ?? lerCookie(req, "CF_Authorization");
  if (!token) throw new Error("Não autenticado");

  const payload = await verificarJwt(token, env);
  const email = String(payload.email ?? "").toLowerCase();
  if (!email) throw new Error("Token sem e-mail");

  const permitidos = env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (permitidos.length === 0 || !permitidos.includes(email)) {
    throw new Error("Usuário não autorizado");
  }
  return email;
}
