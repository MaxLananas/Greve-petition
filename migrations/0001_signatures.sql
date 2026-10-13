-- Base D1 pour la pétition. Aucun signataire ou compteur fictif.
-- Réexécutable sans supprimer les signatures existantes.
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT '' CHECK (role IN ('', 'eleve', 'personnel', 'parent', 'ancien', 'soutien')),
  message TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  withdrawal_hash TEXT NOT NULL UNIQUE
);

-- Index partiel : lire les 50 derniers soutiens ne scanne pas toute la base.
CREATE INDEX IF NOT EXISTS signatures_public_recent ON signatures (id DESC) WHERE is_public = 1;

-- Compteurs maintenus atomiquement par SQLite, sans COUNT(*) à chaque visite.
CREATE TABLE IF NOT EXISTS petition_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  public_count INTEGER NOT NULL CHECK (public_count >= 0 AND public_count <= total_count)
);
INSERT OR IGNORE INTO petition_stats (id, total_count, public_count)
SELECT 1, COUNT(*), COALESCE(SUM(is_public), 0) FROM signatures;

CREATE TRIGGER IF NOT EXISTS signatures_count_insert AFTER INSERT ON signatures
BEGIN
  UPDATE petition_stats SET total_count = total_count + 1, public_count = public_count + NEW.is_public WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS signatures_count_delete AFTER DELETE ON signatures
BEGIN
  UPDATE petition_stats SET total_count = total_count - 1, public_count = public_count - OLD.is_public WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS signatures_count_visibility AFTER UPDATE OF is_public ON signatures
BEGIN
  UPDATE petition_stats SET public_count = public_count + NEW.is_public - OLD.is_public WHERE id = 1;
END;

-- Limitation distribuée entre Workers. Pas d'IP en clair : empreinte + expiration.
CREATE TABLE IF NOT EXISTS request_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS request_limits_expiration ON request_limits (expires_at);
