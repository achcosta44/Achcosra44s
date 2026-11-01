-- Servidor de sincronização: guarda apenas dados CRIPTOGRAFADOS pelos aparelhos.
-- Sem a senha do usuário, nada aqui pode ser lido (nem pela Cloudflare, nem pelo administrador).

CREATE TABLE cofres (
  id         TEXT PRIMARY KEY,           -- código do cofre (ex.: K7QM-2XRP-9TDA)
  token_hash TEXT NOT NULL,              -- SHA-256 do token derivado da senha (a senha nunca chega aqui)
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mudancas (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  cofre       TEXT NOT NULL REFERENCES cofres (id),
  dispositivo TEXT NOT NULL,
  dado        TEXT NOT NULL,             -- registro criptografado (AES-256-GCM), em base64
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mudancas_cofre_seq ON mudancas (cofre, seq);
