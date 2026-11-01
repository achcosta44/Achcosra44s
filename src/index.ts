import * as api from "./api";
import { autenticar } from "./auth";
import { ErroHttp, type Ctx, type Env } from "./types";

type Handler = (ctx: Ctx) => Promise<Response>;

const rotas: [string, string, Handler][] = [
  ["GET", "/api/eu", api.eu],

  ["GET", "/api/pacientes", api.listarPacientes],
  ["POST", "/api/pacientes", api.criarPaciente],
  ["GET", "/api/pacientes/:id", api.obterPaciente],
  ["PUT", "/api/pacientes/:id", api.atualizarPaciente],

  ["GET", "/api/pacientes/:id/evolucoes", api.listarEvolucoes],
  ["POST", "/api/pacientes/:id/evolucoes", api.criarEvolucao],
  ["GET", "/api/pacientes/:id/anexos", api.listarAnexos],
  ["POST", "/api/pacientes/:id/anexos", api.enviarAnexo],
  ["GET", "/api/anexos/:id", api.baixarAnexo],

  ["GET", "/api/agendamentos", api.listarAgendamentos],
  ["POST", "/api/agendamentos", api.criarAgendamento],
  ["PUT", "/api/agendamentos/:id", api.atualizarAgendamento],
  ["DELETE", "/api/agendamentos/:id", api.excluirAgendamento],

  ["GET", "/api/pagamentos", api.listarPagamentos],
  ["POST", "/api/pagamentos", api.criarPagamento],
  ["PUT", "/api/pagamentos/:id", api.atualizarPagamento],
  ["GET", "/api/resumo", api.resumoFinanceiro],

  ["GET", "/api/exportar", api.exportar],
  ["POST", "/api/importar", api.importar],
  ["GET", "/api/auditoria", api.listarAuditoria],
];

const compiladas = rotas.map(([metodo, padrao, handler]) => {
  const nomes: string[] = [];
  const re = new RegExp(
    "^" +
      padrao.replace(/:(\w+)/g, (_, n) => {
        nomes.push(n);
        return "([^/]+)";
      }) +
      "/?$",
  );
  return { metodo, re, nomes, handler };
});

function seguranca(resp: Response): Response {
  const r = new Response(resp.body, resp);
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Frame-Options", "DENY");
  return r;
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    try {
      // Proteção simples contra CSRF: escrita só a partir da própria origem.
      if (req.method !== "GET") {
        const origem = req.headers.get("Origin");
        if (origem && origem !== url.origin) throw new ErroHttp(403, "Origem não permitida");
      }

      let usuario: string;
      try {
        usuario = await autenticar(req, env);
      } catch (e) {
        throw new ErroHttp(401, (e as Error).message);
      }

      let caminhoExiste = false;
      for (const r of compiladas) {
        const m = url.pathname.match(r.re);
        if (!m) continue;
        caminhoExiste = true;
        if (r.metodo !== req.method) continue;
        const params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        return seguranca(await r.handler({ req, env, exec, url, usuario, params }));
      }
      throw new ErroHttp(caminhoExiste ? 405 : 404, caminhoExiste ? "Método não permitido" : "Rota não encontrada");
    } catch (e) {
      if (e instanceof ErroHttp) return seguranca(api.json({ erro: e.message }, e.status));
      const msg = (e as Error).message ?? String(e);
      if (/UNIQUE constraint failed: pacientes\.cpf/.test(msg)) {
        return seguranca(api.json({ erro: "Já existe paciente com este CPF" }, 409));
      }
      if (/FOREIGN KEY constraint failed/.test(msg)) {
        return seguranca(api.json({ erro: "Registro vinculado a outro inexistente ou em uso" }, 409));
      }
      const gatilho = msg.match(/não podem ser [^.]+\.[^"]*/);
      if (gatilho) return seguranca(api.json({ erro: gatilho[0] }, 409));
      console.error(e);
      return seguranca(api.json({ erro: "Erro interno" }, 500));
    }
  },
} satisfies ExportedHandler<Env>;
