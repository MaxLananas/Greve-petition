# Déploiement express — Cloudflare Pages + D1 (10 minutes)

Le site + la base sont 100 % chez Cloudflare, 100 % gratuits. Aucun compte Supabase nécessaire.

> Deux méthodes au choix : **A. avec terminal** (4 commandes, le plus rapide) ou **B. 100 % manuelle** (tableau de bord uniquement, sans aucune commande). Les deux donnent le même résultat.

## Méthode A — avec terminal (le plus rapide)

> Prérequis : ce dépôt à jour (`git pull` sur `main`), Node 22, un terminal ouvert dans le dossier du projet.

### 1. Connecter le terminal à Cloudflare (1 fois)

```sh
npm ci
npx wrangler login
```

Une page Cloudflare s'ouvre : cliquez **Allow**. Revenez au terminal.

### 2. Créer la base D1

```sh
npm run cloudflare:db:create
```

Vous devez voir `Successfully created DB 'leborgne-petition'`. Si elle existe déjà, passez à l'étape 3.

### 3. Créer les tables (migration)

```sh
npm run cloudflare:db:migrate
```

Vous devez voir une liste de `success: true`. Cette commande est réexécutable sans danger (elle ne supprime jamais les signatures).

### 4. Vérifier la base

```sh
npm run cloudflare:db:check
```

Vous devez voir **une ligne** : `id = 1, total_count = 0, public_count = 0`. Si oui, la base est prête → passez à l'étape 5 ci-dessous.

## Méthode B — 100 % manuelle (sans terminal)

### 1. Créer la base D1

Sur https://dash.cloudflare.com → **Storage & Databases** → **D1** → **Create** → nom `leborgne-petition` → **Create**.

### 2. Créer les tables (Console D1)

Cliquez sur la base `leborgne-petition` → onglet **Console**. Exécutez les 9 blocs suivants **un par un** (coller → Execute → attendre le succès → bloc suivant). Le SQL exact vient de `migrations/0001_signatures.sql` :

1. `CREATE TABLE signatures ...` (table des signatures)
2. `CREATE INDEX signatures_public_recent ...` (index des soutiens publics)
3. `CREATE TABLE petition_stats ...` (table du compteur)
4. `INSERT OR IGNORE INTO petition_stats ...` (ligne du compteur)
5. `CREATE TRIGGER signatures_count_insert ... END;` (compteur +1 à l'inscription)
6. `CREATE TRIGGER signatures_count_delete ... END;` (compteur −1 au retrait)
7. `CREATE TRIGGER signatures_count_visibility ... END;` (compteur public)
8. `CREATE TABLE request_limits ...` (anti-abus)
9. `CREATE INDEX request_limits_expiration ...` (expiration anti-abus)

Puis vérifiez avec : `SELECT * FROM petition_stats;` → **une ligne** `1 | 0 | 0`. Si oui, passez à l'étape 5.

## 5. Relier la base au site (tableau de bord)

1. Allez sur https://dash.cloudflare.com → **Workers & Pages** → votre projet Pages.
2. **Settings** → **Functions** → **D1 database bindings** → **Add binding**.
3. **Variable name : `DB`** (exactement ces 2 lettres en majuscules, sinon le site ne trouvera pas la base).
4. **D1 database** : choisissez `leborgne-petition` → **Save**.

## 6. Renseigner les variables (même page Settings)

**Settings** → **Variables and Secrets** (environnement **Production**) :

| Variable | Valeur |
|---|---|
| `PUBLIC_URL` | `https://votre-projet.pages.dev` (sans slash final) |
| `ADMIN_TOKEN` | 32 caractères aléatoires minimum (cliquez « Encrypt »). Générez avec : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SIGNATURE_GOAL` | `1000` (optionnel) |
| `SIGNATURE_RATE_SECRET` | Une chaîne aléatoire (recommandé, « Encrypt ») |
| `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | Optionnel : les deux ensemble, ou aucune |

Si d'anciennes variables `SUPABASE_*` existent : laissez-les pour l'instant (D1 est prioritaire), supprimez-les après l'étape 8.

## 7. Redéployer (obligatoire)

Les bindings et variables ne s'appliquent qu'au déploiement suivant : **Deployments** → **⋯** sur le dernier déploiement → **Retry deployment**. Attendez le ✅.

## 8. Vérifier que tout fonctionne

1. Ouvrez `https://votre-projet.pages.dev/api/health` → vous devez voir `"storage":"d1"`.
2. Sur le site, signez avec votre propre e-mail → compteur à `1`, page de confirmation avec un code de 32 caractères.
3. Retirez cette signature-test avec le code (bas du site → « Retirer ma signature ») → compteur à `0`.
4. Le site est en ligne. Vous pouvez maintenant supprimer les variables `SUPABASE_*` devenues inutiles (puis redéployer une dernière fois).

## Dépannage express

| Symptôme | Cause (99 % des cas) | Correctif |
|---|---|---|
| `/api/health` → `DB_NOT_CONFIGURED` | Binding absent, mal nommé, ou pas redéployé | Refaire étapes 5 puis 7 (nom exact : `DB`) |
| `D1_NOT_INITIALIZED` | Migration non appliquée sur la base distante | Refaire étapes 3–4 (avec `--remote`, comme le script) |
| `429` trop fréquent au lycée | Une seule IP publique pour tous les élèves | Augmenter `SIGNATURE_RATE_LIMIT` (ex. `300`), redéployer |
| `TURNSTILE_NOT_CONFIGURED` | Une seule des 2 clés Turnstile renseignée | Mettre les deux clés, ou aucune, redéployer |

## Développement local (optionnel)

```sh
npm run cloudflare:dev   # site + API + D1 locale sur http://localhost:3000
```

Pour l'export privé des signatures, le détail des sécurités et les limites du plan gratuit, voir `DEPLOY-TUTORIAL.md`.
