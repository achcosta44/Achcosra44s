import { ErroHttp } from "./types";

type Obj = Record<string, unknown>;

export function texto(o: Obj, campo: string, opts: { obrigatorio?: boolean; max?: number } = {}): string | null {
  const v = o[campo];
  if (v === undefined || v === null || String(v).trim() === "") {
    if (opts.obrigatorio) throw new ErroHttp(400, `Campo obrigatório: ${campo}`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > (opts.max ?? 2000)) throw new ErroHttp(400, `Campo muito longo: ${campo}`);
  return s;
}

export function inteiro(o: Obj, campo: string, opts: { obrigatorio?: boolean; min?: number } = {}): number | null {
  const v = o[campo];
  if (v === undefined || v === null || v === "") {
    if (opts.obrigatorio) throw new ErroHttp(400, `Campo obrigatório: ${campo}`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ErroHttp(400, `Número inteiro inválido: ${campo}`);
  if (opts.min !== undefined && n < opts.min) throw new ErroHttp(400, `Valor mínimo de ${campo}: ${opts.min}`);
  return n;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function dataValida(s: string): boolean {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function data(o: Obj, campo: string, obrigatorio = false): string | null {
  const s = texto(o, campo, { obrigatorio, max: 10 });
  if (s === null) return null;
  if (!RE_DATA.test(s) || !dataValida(s)) throw new ErroHttp(400, `Data inválida em ${campo} (use AAAA-MM-DD)`);
  return s;
}

export function dataHora(o: Obj, campo: string, obrigatorio = false): string | null {
  const s = texto(o, campo, { obrigatorio, max: 16 });
  if (s === null) return null;
  const [, hora] = s.split("T");
  const [hh, mm] = (hora ?? "").split(":").map(Number);
  if (!RE_DATA_HORA.test(s) || !dataValida(s) || hh > 23 || mm > 59) {
    throw new ErroHttp(400, `Data/hora inválida em ${campo} (use AAAA-MM-DDTHH:MM)`);
  }
  return s;
}

export function opcao<T extends string>(o: Obj, campo: string, opcoes: readonly T[], padrao?: T): T | null {
  const s = texto(o, campo, { max: 40 });
  if (s === null) return padrao ?? null;
  if (!opcoes.includes(s as T)) throw new ErroHttp(400, `Valor inválido em ${campo}: ${s}`);
  return s as T;
}

/** Aceita centavos inteiros (valor_centavos) ou reais (valor: 150, "150,00", "1.500,50"). */
export function centavos(o: Obj, obrigatorio = false): number | null {
  if (o.valor_centavos !== undefined && o.valor_centavos !== null && o.valor_centavos !== "") {
    return inteiro(o, "valor_centavos", { min: 0 });
  }
  const v = o.valor;
  if (v === undefined || v === null || v === "") {
    if (obrigatorio) throw new ErroHttp(400, "Campo obrigatório: valor");
    return null;
  }
  let n: number;
  if (typeof v === "number") n = v;
  else {
    let s = String(v).replace(/[R$\s]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    n = Number(s);
  }
  if (!Number.isFinite(n) || n < 0) throw new ErroHttp(400, "Valor inválido");
  return Math.round(n * 100);
}

export const STATUS_AGENDAMENTO = ["agendado", "confirmado", "realizado", "faltou", "cancelado"] as const;
export const FORMAS_PAGAMENTO = [
  "pix",
  "dinheiro",
  "cartao_credito",
  "cartao_debito",
  "transferencia",
  "convenio",
  "outro",
] as const;
export const STATUS_PAGAMENTO = ["pago", "pendente", "cancelado"] as const;
export const TIPOS_REGISTRO = ["evolucao", "demanda", "encaminhamento", "encerramento", "documento", "outro"] as const;
