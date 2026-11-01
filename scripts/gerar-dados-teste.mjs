// Gera exemplos/dados-de-teste.json: uma "cópia de segurança" com dados FICTÍCIOS
// para testar o app (Backup → Restaurar cópia).
// Uso: node scripts/gerar-dados-teste.mjs [AAAA-MM-DD]   (data de referência; padrão: hoje)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDias = (s, n) => {
  const [a, m, d] = s.split("-").map(Number);
  return iso(new Date(a, m - 1, d + n));
};
const ref = process.argv[2] || iso(new Date());
const [ra, rm, rd] = ref.split("-").map(Number);
const dRef = new Date(ra, rm - 1, rd);
// Segunda-feira da semana de referência (no domingo, a semana seguinte, como no app)
const segRef = dRef.getDay() === 0 ? addDias(ref, 1) : addDias(ref, -((dRef.getDay() + 6) % 7));

// Gerador pseudoaleatório determinístico (mesmos dados a cada execução)
let semente = 42;
const rand = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const escolher = (lista) => lista[Math.floor(rand() * lista.length)];

// Carimbo "UTC" no formato do app, a partir de data/hora local (Brasília, UTC-3)
const carimbo = (data, hora = "12:00", minutosDepois = 0) => {
  const [a, m, d] = data.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d, hh + 3, mm + minutosDepois));
  return t.toISOString().slice(0, 19).replace("T", " ");
};

// ------------------------------------------------------------------ pacientes (fictícios)
// dia: 0 = segunda … 5 = sábado
const fichas = [
  { nome: "Mariana Costa", valor: 100, dia: 0, hora: "09:00", inicio: -4, nasc: "1991-03-14", demanda: "Ansiedade relacionada ao trabalho; dificuldade para dormir. Objetivos: reduzir crises de ansiedade e reorganizar a rotina." },
  { nome: "Rafael Almeida", valor: 100, dia: 0, hora: "14:00", inicio: -4, nasc: "1985-11-02", demanda: "Luto pela perda do pai há seis meses. Objetivos: elaboração do luto e retomada de atividades sociais." },
  { nome: "Juliana Ribeiro", valor: 80, dia: 1, hora: "08:00", inicio: -4, nasc: "1998-07-21", demanda: "Insegurança nos relacionamentos e baixa autoestima. Objetivos: fortalecer autoestima e habilidades de comunicação." },
  { nome: "Bruno Ferreira", valor: 100, dia: 1, hora: "18:30", inicio: -3, nasc: "1979-01-30", demanda: "Irritabilidade e conflitos familiares. Objetivos: manejo da raiva e melhora da comunicação com a família." },
  { nome: "Camila Souza", valor: 80, dia: 2, hora: "10:00", inicio: -4, nasc: "2001-09-09", demanda: "Indecisão sobre carreira e procrastinação nos estudos. Objetivos: orientação de projeto de vida e organização de rotina de estudos." },
  { nome: "Lucas Martins", valor: 100, dia: 2, hora: "19:00", inicio: -2, nasc: "1993-05-17", demanda: "Episódios de tristeza e desânimo. Objetivos: identificar fatores de manutenção do humor deprimido e ampliar atividades prazerosas." },
  { nome: "Fernanda Lima", valor: 80, dia: 3, hora: "15:00", inicio: -4, nasc: "1988-12-03", demanda: "Sobrecarga com maternidade e trabalho. Objetivos: estabelecer limites e rede de apoio." },
  { nome: "Pedro Henrique Rocha", valor: 100, dia: 3, hora: "17:00", inicio: -3, nasc: "2006-02-25", demanda: "Ansiedade social na faculdade. Objetivos: exposição gradual a situações sociais e redução da evitação." },
  { nome: "Beatriz Carvalho", valor: 80, dia: 4, hora: "11:00", inicio: -4, nasc: "1975-08-11", demanda: "Dificuldades de adaptação após aposentadoria. Objetivos: construção de nova rotina e projetos pessoais." },
  { nome: "Gustavo Pereira", valor: 100, dia: 5, hora: "09:30", inicio: -1, nasc: "1990-10-28", demanda: "Busca de autoconhecimento após término de relacionamento. Objetivos: compreender padrões relacionais." },
];

const telefones = (i) => `(31) 90000-${pad(10 + i)}${pad(i * 7 % 100)}`;
const pacientes = fichas.map((f, i) => ({
  id: i + 1,
  nome: f.nome,
  cpf: null,
  data_nascimento: f.nasc,
  telefone: telefones(i),
  email: `${f.nome.split(" ")[0].toLowerCase()}@exemplo.com`,
  endereco: null,
  contato_emergencia: null,
  convenio: null,
  valor_sessao_centavos: f.valor * 100,
  observacoes: i === 3 ? "Prefere atendimento no fim do dia." : null,
  ativo: 1,
  criado_em: carimbo(addDias(segRef, f.inicio * 7 + f.dia - 3)),
  atualizado_em: carimbo(addDias(segRef, f.inicio * 7 + f.dia - 3)),
}));
// Um paciente com acompanhamento encerrado (inativo)
pacientes.push({
  id: 11, nome: "Ana Paula Mendes", cpf: null, data_nascimento: "1983-04-19", telefone: telefones(10),
  email: "anapaula@exemplo.com", endereco: null, contato_emergencia: null, convenio: null,
  valor_sessao_centavos: 8000, observacoes: null, ativo: 0,
  criado_em: carimbo(addDias(segRef, -70)), atualizado_em: carimbo(addDias(segRef, -8)),
});

// ------------------------------------------------------------------ agenda, pagamentos, prontuário
const agendamentos = [];
const pagamentos = [];
const evolucoes = [];
const formas = ["pix", "pix", "pix", "pix", "dinheiro", "cartao_debito", "cartao_credito", "transferencia"];
const textosEvolucao = [
  "Paciente compareceu pontualmente. Relatou a semana e retomou temas da sessão anterior. Trabalhada a identificação de pensamentos automáticos em situações de tensão.",
  "Sessão centrada nos acontecimentos recentes. Paciente demonstrou maior abertura para falar sobre sentimentos. Combinada tarefa de registro diário.",
  "Revisada a tarefa da semana. Paciente relata pequena melhora. Exploradas estratégias de enfrentamento já utilizadas com sucesso.",
  "Paciente chegou mobilizado(a) por evento familiar. Acolhimento e organização das prioridades da semana.",
  "Trabalhados objetivos terapêuticos e avaliado o progresso até aqui. Paciente reconhece mudanças na forma de lidar com as situações-problema.",
  "Sessão com foco em psicoeducação sobre ansiedade e respiração diafragmática. Paciente praticou a técnica em sessão.",
];
let idAg = 1, idPag = 1, idEv = 1;

function sessao(pacienteId, data, hora, status, duracao = 50, obs = null) {
  const a = {
    id: idAg++, paciente_id: pacienteId, inicio: `${data}T${hora}`, duracao_min: duracao, status, observacoes: obs,
    criado_em: carimbo(addDias(data, -7), "10:00"), atualizado_em: carimbo(data, hora, duracao),
  };
  agendamentos.push(a);
  return a;
}
function pagar(a, valorCent, { status = "pago", forma, data, referencia = null } = {}) {
  pagamentos.push({
    id: idPag++, paciente_id: a.paciente_id, agendamento_id: a.id, data: data || a.inicio.slice(0, 10),
    valor_centavos: valorCent, forma: forma || escolher(formas), status, referencia, observacoes: null,
    criado_em: carimbo(a.inicio.slice(0, 10), a.inicio.slice(11), 60), atualizado_em: carimbo(a.inicio.slice(0, 10), a.inicio.slice(11), 60),
  });
}
function registrar(pacienteId, data, hora, tipo, texto, agendamentoId = null) {
  evolucoes.push({
    id: idEv++, paciente_id: pacienteId, agendamento_id: agendamentoId, tipo, data_atendimento: data, texto,
    retifica_id: null, autor_email: "este aparelho", criado_em: carimbo(data, hora, 55),
  });
}

fichas.forEach((f, i) => {
  const pid = i + 1;
  for (let semana = f.inicio; semana <= 3; semana++) {
    const data = addDias(segRef, semana * 7 + f.dia);
    const passado = semana < 0;
    let status = "agendado";
    if (passado) {
      const r = rand();
      status = r < 0.1 ? "faltou" : r < 0.15 ? "cancelado" : "realizado";
    } else if (semana === 0 && rand() < 0.6) status = "confirmado";
    const a = sessao(pid, data, f.hora, status);

    if (status === "realizado") {
      const primeira = semana === f.inicio;
      registrar(pid, data, f.hora, primeira ? "demanda" : "evolucao", primeira ? f.demanda : escolher(textosEvolucao), a.id);
      const r = rand();
      if (r < 0.8) pagar(a, f.valor * 100);
      else if (r < 0.9) pagar(a, f.valor * 100, { status: "pendente", forma: "pix" });
      // ~10% ficam sem pagamento lançado (aparecem no Financeiro como "realizadas sem pagamento")
    }
  }
});

// Sessões avulsas em horários diversos
const extra = (pid, semana, dia, hora, status, dur = 50, obs = null) => {
  const f = fichas[pid - 1];
  const a = sessao(pid, addDias(segRef, semana * 7 + dia), hora, status, dur, obs);
  if (status === "realizado") {
    registrar(pid, a.inicio.slice(0, 10), hora, "evolucao", "Sessão extra solicitada pelo(a) paciente. " + escolher(textosEvolucao), a.id);
    pagar(a, f.valor * 100);
  }
};
extra(1, -2, 3, "07:30", "realizado", 50, "Sessão extra (antes do trabalho)");
extra(6, -1, 4, "20:00", "realizado", 50, "Sessão extra");
extra(3, 0, 2, "12:15", "agendado", 30, "Sessão curta – retorno");
extra(8, 1, 5, "08:00", "agendado", 50, "Reposição de falta");
extra(2, 2, 4, "16:20", "agendado", 80, "Sessão estendida");

// Paciente inativo: histórico encerrado
{
  const pid = 11;
  for (let semana = -10; semana <= -2; semana++) {
    const a = sessao(pid, addDias(segRef, semana * 7 + 1), "13:00", "realizado");
    registrar(pid, a.inicio.slice(0, 10), "13:00", semana === -10 ? "demanda" : "evolucao",
      semana === -10 ? "Crise de ansiedade após mudança de cidade. Objetivos: adaptação e manejo da ansiedade." : escolher(textosEvolucao), a.id);
    pagar(a, 8000);
  }
  const fim = addDias(segRef, -2 * 7 + 1);
  registrar(pid, fim, "13:00", "encaminhamento", "Encaminhada para avaliação psiquiátrica (Dr(a). fictício) para acompanhamento conjunto do sono.");
  registrar(pid, fim, "13:00", "encerramento", "Encerramento do acompanhamento de comum acordo. Objetivos alcançados: retomada da rotina e redução das crises. Orientada sobre possibilidade de retorno.");
}

// Uma retificação de exemplo (registro original continua visível)
{
  const orig = evolucoes.find((e) => e.paciente_id === 1 && e.tipo === "evolucao");
  if (orig) {
    evolucoes.push({
      ...orig, id: idEv++, agendamento_id: null, retifica_id: orig.id,
      texto: "Retificação: onde se lê 'tarefa de registro diário', leia-se 'registro de pensamentos três vezes por semana'.",
      criado_em: carimbo(orig.data_atendimento, "21:00"),
    });
  }
}

const backup = {
  formato: "consultorio-backup",
  versao: 1,
  gerado_em: new Date().toISOString(),
  dados: {
    pacientes,
    agendamentos: agendamentos.sort((a, b) => a.inicio.localeCompare(b.inicio)),
    pagamentos,
    evolucoes,
    anexos: [],
    auditoria: [{ id: 1, quando: new Date().toISOString().slice(0, 19).replace("T", " "), usuario: "este aparelho", acao: "restaurar", entidade: "sistema", entidade_id: null, detalhe: "dados fictícios de teste", ip: null }],
  },
};

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "exemplos", "dados-de-teste.json");
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, JSON.stringify(backup, null, 1));
const soma = (st) => pagamentos.filter((p) => p.status === st).reduce((s, p) => s + p.valor_centavos, 0) / 100;
console.log(`Gerado ${saida}`);
console.log(`Semana de referência: ${segRef} | pacientes: ${pacientes.length} | sessões: ${agendamentos.length} | registros: ${evolucoes.length} | pagamentos: ${pagamentos.length} (pago R$ ${soma("pago")}, pendente R$ ${soma("pendente")})`);
