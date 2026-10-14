-- Schema Supabase (PostgreSQL) — à exécuter dans l'éditeur SQL de Supabase.
-- Réexécutable sans supprimer les signatures existantes.
-- L'API Cloudflare utilise la clé SERVICE_ROLE (qui contourne le RLS) :
-- aucune lecture publique directe n'est autorisée.

CREATE TABLE IF NOT EXISTS signatures (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT '' CHECK (role IN ('', 'eleve', 'personnel', 'parent', 'ancien', 'soutien')),
  message TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  consent_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawal_hash TEXT NOT NULL UNIQUE
);

-- L'application normalise les e-mails en minuscules ; cet index ajoute une
-- protection insensible à la casse même en cas d'insertion manuelle.
CREATE UNIQUE INDEX IF NOT EXISTS signatures_email_lower_unique ON signatures (lower(email));

CREATE INDEX IF NOT EXISTS signatures_public_recent ON signatures (id DESC) WHERE is_public = 1;

CREATE TABLE IF NOT EXISTS petition_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  public_count INTEGER NOT NULL DEFAULT 0 CHECK (public_count >= 0 AND public_count <= total_count)
);

INSERT INTO petition_stats (id, total_count, public_count)
SELECT 1, COUNT(*), COALESCE(SUM(is_public), 0) FROM signatures
ON CONFLICT (id) DO NOTHING;

-- Triggers PostgreSQL pour le compteur (atomique, pas de SELECT COUNT(*) par visite).
CREATE OR REPLACE FUNCTION signatures_count_insert()
RETURNS TRIGGER AS $$ BEGIN UPDATE petition_stats SET total_count = total_count + 1, public_count = public_count + NEW.is_public WHERE id = 1; RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS signatures_count_insert ON signatures;
CREATE TRIGGER signatures_count_insert AFTER INSERT ON signatures FOR EACH ROW EXECUTE FUNCTION signatures_count_insert();

CREATE OR REPLACE FUNCTION signatures_count_delete()
RETURNS TRIGGER AS $$ BEGIN UPDATE petition_stats SET total_count = total_count - 1, public_count = public_count - OLD.is_public WHERE id = 1; RETURN OLD; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS signatures_count_delete ON signatures;
CREATE TRIGGER signatures_count_delete AFTER DELETE ON signatures FOR EACH ROW EXECUTE FUNCTION signatures_count_delete();

CREATE OR REPLACE FUNCTION signatures_count_visibility()
RETURNS TRIGGER AS $$ BEGIN UPDATE petition_stats SET public_count = public_count + NEW.is_public - OLD.is_public WHERE id = 1; RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS signatures_count_visibility ON signatures;
CREATE TRIGGER signatures_count_visibility AFTER UPDATE OF is_public ON signatures FOR EACH ROW EXECUTE FUNCTION signatures_count_visibility();

CREATE TABLE IF NOT EXISTS request_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limits_expiration ON request_limits (expires_at);

-- Sécurité : l'API REST publique de Supabase est verrouillée.
-- Seule la clé SERVICE_ROLE (côté serveur Cloudflare) y accède.
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE petition_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_limits ENABLE ROW LEVEL SECURITY;
