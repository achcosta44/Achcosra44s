-- Tipo do registro do prontuário (registro documental — Resolução CFP nº 001/2009).
ALTER TABLE evolucoes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'evolucao'
  CHECK (tipo IN ('evolucao', 'demanda', 'encaminhamento', 'encerramento', 'documento', 'outro'));
