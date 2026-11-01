-- Estrutura inicial: pacientes, agenda, pagamentos, prontuário (evoluções e anexos) e auditoria.
-- Datas de atendimento ficam em horário local (America/Sao_Paulo) no formato 'YYYY-MM-DDTHH:MM'.
-- Carimbos de criação/alteração ficam em UTC (datetime('now')).
-- Valores monetários ficam em centavos (INTEGER) para evitar erro de arredondamento.

CREATE TABLE pacientes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                  TEXT    NOT NULL,
  cpf                   TEXT    UNIQUE,
  data_nascimento       TEXT,
  telefone              TEXT,
  email                 TEXT,
  endereco              TEXT,
  contato_emergencia    TEXT,
  convenio              TEXT,
  valor_sessao_centavos INTEGER,
  observacoes           TEXT,
  ativo                 INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em             TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pacientes_nome ON pacientes (nome);

CREATE TABLE agendamentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL REFERENCES pacientes (id),
  inicio        TEXT    NOT NULL,
  duracao_min   INTEGER NOT NULL DEFAULT 50 CHECK (duracao_min > 0),
  status        TEXT    NOT NULL DEFAULT 'agendado'
                CHECK (status IN ('agendado', 'confirmado', 'realizado', 'faltou', 'cancelado')),
  observacoes   TEXT,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agendamentos_inicio ON agendamentos (inicio);
CREATE INDEX idx_agendamentos_paciente ON agendamentos (paciente_id, inicio);

CREATE TABLE pagamentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes (id),
  agendamento_id INTEGER REFERENCES agendamentos (id),
  data           TEXT    NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  forma          TEXT    NOT NULL DEFAULT 'pix'
                 CHECK (forma IN ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'convenio', 'outro')),
  status         TEXT    NOT NULL DEFAULT 'pago'
                 CHECK (status IN ('pago', 'pendente', 'cancelado')),
  referencia     TEXT,
  observacoes    TEXT,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pagamentos_data ON pagamentos (data);
CREATE INDEX idx_pagamentos_paciente ON pagamentos (paciente_id, data);

-- Prontuário: evoluções são imutáveis. Correção = nova evolução apontando para a original (retifica_id).
CREATE TABLE evolucoes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id      INTEGER NOT NULL REFERENCES pacientes (id),
  agendamento_id   INTEGER REFERENCES agendamentos (id),
  data_atendimento TEXT    NOT NULL,
  texto            TEXT    NOT NULL CHECK (length(trim(texto)) > 0),
  retifica_id      INTEGER REFERENCES evolucoes (id),
  autor_email      TEXT    NOT NULL,
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_evolucoes_paciente ON evolucoes (paciente_id, data_atendimento);

CREATE TRIGGER evolucoes_sem_update BEFORE UPDATE ON evolucoes
BEGIN
  SELECT RAISE(ABORT, 'Evoluções do prontuário não podem ser alteradas; registre uma retificação.');
END;

CREATE TRIGGER evolucoes_sem_delete BEFORE DELETE ON evolucoes
BEGIN
  SELECT RAISE(ABORT, 'Evoluções do prontuário não podem ser excluídas.');
END;

-- Anexos: o arquivo fica no R2; aqui só os metadados. Também imutáveis.
CREATE TABLE anexos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL REFERENCES pacientes (id),
  chave_r2      TEXT    NOT NULL UNIQUE,
  nome_arquivo  TEXT    NOT NULL,
  tipo_mime     TEXT    NOT NULL,
  tamanho_bytes INTEGER NOT NULL,
  sha256        TEXT    NOT NULL,
  descricao     TEXT,
  autor_email   TEXT    NOT NULL,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_anexos_paciente ON anexos (paciente_id);

CREATE TRIGGER anexos_sem_update BEFORE UPDATE ON anexos
BEGIN
  SELECT RAISE(ABORT, 'Anexos do prontuário não podem ser alterados.');
END;

CREATE TRIGGER anexos_sem_delete BEFORE DELETE ON anexos
BEGIN
  SELECT RAISE(ABORT, 'Anexos do prontuário não podem ser excluídos.');
END;

-- Pacientes com prontuário não são excluídos, apenas inativados (dever de guarda).
CREATE TRIGGER pacientes_sem_delete BEFORE DELETE ON pacientes
BEGIN
  SELECT RAISE(ABORT, 'Pacientes não podem ser excluídos; use a inativação.');
END;

-- Trilha de auditoria (quem fez o quê, quando). Também imutável.
CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quando      TEXT    NOT NULL DEFAULT (datetime('now')),
  usuario     TEXT    NOT NULL,
  acao        TEXT    NOT NULL,
  entidade    TEXT    NOT NULL,
  entidade_id INTEGER,
  detalhe     TEXT,
  ip          TEXT
);
CREATE INDEX idx_auditoria_quando ON auditoria (quando);
CREATE INDEX idx_auditoria_entidade ON auditoria (entidade, entidade_id);

CREATE TRIGGER auditoria_sem_update BEFORE UPDATE ON auditoria
BEGIN
  SELECT RAISE(ABORT, 'Registros de auditoria não podem ser alterados.');
END;

CREATE TRIGGER auditoria_sem_delete BEFORE DELETE ON auditoria
BEGIN
  SELECT RAISE(ABORT, 'Registros de auditoria não podem ser excluídos.');
END;
