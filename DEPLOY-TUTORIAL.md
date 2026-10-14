# Déploiement du site — Leborgne en Action (référence complète)
# Parcours recommandé : DEPLOY-D1-RAPIDE.md (Pages + D1, 10 minutes, sans Supabase).
# Ce document reste la référence détaillée : Supabase en alternative, export,
# sécurité, limites, dépannage.
# Dépôt : MaxLananas/Greve-petition — branche de production : main
# Aucune donnée réelle, aucun secret, aucun fichier privé dans le dépôt.

---

## 0. AVANT DE COMMENCER — POINTS IMPORTANTS

1. Ce site permet de signer une pétition. Les signatures sont enregistrées dans une base Supabase (PostgreSQL). Elles ne sont pas stockées dans le dépôt Git, ni dans `dist/`, ni dans le navigateur (hors état local React).
2. Ce tutoriel ne remplace pas un audit légal ou un audit d'accessibilité complet. Les tests automatiques (`npm test` : 52 tests API, `npm run test:cloudflare` : bundle réel, `npm run test:browser` : 21 vérifications navigateur avec axe) couvrent le fonctionnement technique. Une revue manuelle reste utile avant diffusion publique, surtout si la campagne devient très visible.
3. Avant de diffuser publiquement, vous devez configurer : une URL publique en HTTPS (`PUBLIC_URL`), un secret pour l'export (`ADMIN_TOKEN` ≥ 32 caractères), et vérifier que vous êtes le responsable du traitement des données personnelles (mention légale, politique de confidentialité, gestion des mineurs si applicable).
4. Le site reste visuellement fonctionnel même si la base atteint ses quotas gratuits (le formulaire renvoie alors 503, aucune signature n'est enregistrée, aucune donnée n'est perdue).
5. Le fichier `public/assets/partage.png` est le visuel de partage (1200×630). Il est inclus dans le dépôt et dans le build.

---

## 1. CRÉER LA BASE SUPABASE

Étape 1 — Création du projet
- Allez sur https://supabase.com.
- Cliquez sur **New Project**.
- Choisissez votre organisation (ou créez-en une).
- Donnez un nom : `leborgne-petition` (le nom n'a pas d'importance pour le fonctionnement).
- Choisissez une région proche de votre public (ex : `eu-west-1` ou `eu-central-1` pour les Antilles/France).
- Entrez un mot de passe fort et conservez-le (mot de passe Postgres, usage admin uniquement).
- Cliquez sur **Create new project**. Attendez 1 à 2 minutes jusqu'au statut « Active ».

Étape 2 — Créer les tables et les déclencheurs
- Dans le tableau de bord, ouvrez **SQL Editor** (menu de gauche).
- Créez un nouveau snippet (« New snippet » en haut à droite).
- Copiez intégralement le contenu de `migrations/0001_signatures-postgres.sql` (présent dans ce dépôt) :
  - la table `signatures` (prénom, nom, e-mail normalisé, rôle, message privé, consentement, date, code de retrait haché) ;
  - un index partiel `signatures_public_recent` pour lire les 50 derniers soutiens de chaque catégorie sans scanner toute la base ;
  - la table `petition_stats` avec le compteur atomique (`total_count`, `public_count`) ;
  - les déclencheurs PostgreSQL qui maintiennent le compteur automatiquement ;
  - la table `request_limits` pour la limitation anti-abus (IP pseudonymisée par HMAC, jamais en clair) ;
  - le verrouillage RLS (seule la clé `service_role`, côté serveur, accède aux tables).
- Cliquez sur **Run**.
- Vérifiez dans le panneau de gauche que `signatures`, `petition_stats` et `request_limits` existent.

Étape 3 — Récupérer l'URL du projet et la clé `service_role`
- Allez dans **Project Settings → API** (ou **Project Settings → Data API** selon l'interface).
- Copiez le **Project URL** (format `https://xxxx.supabase.co`).
- Copiez la clé **`service_role`** (« secret », à ne montrer à personne).
- Conservez ces deux valeurs dans votre gestionnaire de mots de passe. Elles serviront à l'étape 5.
- ⚠️ N'utilisez PAS la clé `anon`/`publishable` pour ce site : les tables sont verrouillées (RLS) et seule la clé `service_role`, utilisée côté serveur par les Pages Functions, peut lire et écrire. La clé `service_role` ne doit JAMAIS apparaître dans le code frontend ni dans Git.

---

## 2. CONFIGURER CLOUDFLARE PAGES

Étape 4 — Créer le projet Pages
- Allez sur https://dash.cloudflare.com.
- **Workers & Pages** → **Create** → **Connect to Git**.
- Autorisez GitHub si nécessaire.
- Choisissez le dépôt `MaxLananas/Greve-petition`.
- Sélectionnez la branche `main`.
- Configuration du build :
  - **Build command** : `npm run build`
  - **Build output directory** : `dist`
  - **Root directory** : `.` (racine du dépôt)
- Cliquez sur **Save and Deploy**.

Le build installe les dépendances, vérifie TypeScript (`tsc -b`), puis compile le site (`vite build`). En cas d'échec, le journal du build indique la cause exacte.

Étape 5 — Variables d'environnement (Pages → Settings → Variables and Secrets, environnement **Production**)
- `SUPABASE_URL` = le Project URL de l'étape 3 (`https://xxxx.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY` = la clé `service_role` (cliquez sur « Encrypt » / secret chiffré).
- `PUBLIC_URL` = `https://votre-projet.pages.dev` (ou votre domaine personnalisé). Utilisée pour les métadonnées de partage (`og:url`, `canonical`).
- `ADMIN_TOKEN` = au moins 32 caractères aléatoires (secret chiffré). Générez avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Protège l'export privé CSV. Sans lui, l'export renvoie `503`.
- `SIGNATURE_GOAL` = `1000` (optionnel, valeur par défaut). Simple objectif visuel.
- `SIGNATURE_RATE_SECRET` = chaîne aléatoire (recommandé, secret chiffré). Sert à pseudonymiser les IP pour la limitation anti-abus.
- Optionnel : `TURNSTILE_SITE_KEY` et `TURNSTILE_SECRET_KEY` (tableau de bord Cloudflare Turnstile, gratuit). Les deux ensemble activent la vérification anti-robot ; les deux vides la désactivent. Une seule des deux provoque une erreur `TURNSTILE_NOT_CONFIGURED`.
- ⚠️ Ne préfixez aucune variable par `VITE_` : le frontend n'a besoin d'aucune variable (il appelle `/api/...` en relatif, et le serveur lui transmet la clé publique Turnstile si configurée).

Redéployez après avoir enregistré les variables (**Retry deployment** ou nouveau push), puis vérifiez :
`https://votre-projet.pages.dev/api/health` doit répondre `{"status":"ok","storage":"supabase","count":0}`.

---

## 3. SI LA BASE EST VIDE OU RÉINITIALISÉE

- Rouvrez le SQL Editor Supabase, exécutez `migrations/0001_signatures-postgres.sql` (réexécutable sans perte), cliquez **Run**.
- Aucun redéploiement n'est nécessaire après un changement de base (seul le code statique requiert un build).

Note : `petition_stats` doit toujours avoir exactement une ligne (`id = 1`). Si vous supprimez des signatures manuellement, les déclencheurs ajustent le compteur automatiquement.

---

## 4. VÉRIFIER QUE TOUT FONCTIONNE (checklist)

1. La page charge avec le logo, le titre « ÉTUDIER. DIGNEMENT. », les 9 priorités, le panneau de signature.
2. Le compteur affiche `0`. Pas `1`, pas `—`. Le site n'invente aucune signature.
3. Ouvrez la console (F12) : aucune erreur rouge (pas de `404` sur `.woff2`, pas de violation CSP, pas d'erreur JS).
4. Soumettez le formulaire vide → messages d'erreur, compteur à `0`, réponse `422`.
5. Remplissez un vrai formulaire (prénom, nom, e-mail valide, consentement coché) → « Je signe ».
6. Page de confirmation avec votre prénom et un code de 32 caractères (code de retrait). Conservez-le.
7. Le compteur passe à `1`. Si vous avez coché l'affichage public, votre prénom + initiale apparaît dans les soutiens.
8. Vérifiez que le code de retrait n'apparaît nulle part ailleurs (ni dans le HTML, ni dans `/api/petition`).
9. Resignez avec le même e-mail → `409` (doublon), compteur inchangé.
10. Retrait avec le code → compteur à `0`, soutien public disparu.
11. Partage : copie le lien du site (`https://.../`).
12. PDF : la carte « Revendications » télécharge `Revendications-Leborgne-en-Action-2026-2027.pdf`.
13. Menu mobile à 390 px : hamburger, ouverture, fermeture au clic, ancre correcte.

Si toutes ces étapes passent : le site est fonctionnel.

---

## 5. LIMITES DU PLAN GRATUIT — CE QU'IL FAUT SAVOIR

**Supabase (PostgreSQL)** :
- Stockage : 500 Mo par projet. Largement suffisant pour des signatures texte.
- Sortie de données : 2 Go par mois (les exports CSV comptent).
- Au dépassement : les écritures échouent proprement (`FREE_QUOTA_REACHED`, 503), aucune donnée partielle.
- Pour purger d'anciennes données : `DELETE FROM signatures WHERE created_at < '2027-01-01';` (les déclencheurs ajustent le compteur). Ne supprimez pas la ligne `id = 1` de `petition_stats`.

**Cloudflare Pages** :
- Builds : 500 par mois (un build par push si le dépôt reste connecté).
- Requêtes Functions (`/api/...`) : 100 000 par jour. Une pétition locale ne dépassera pas cette limite.
- Trafic des fichiers statiques inclus ; domaine `https://<projet>.pages.dev` fourni.

**Ce qui n'est pas inclus** :
- Pas d'accès SSH (Pages = build + CDN, pas une VM).
- Pas de sauvegarde automatique Supabase sur le plan gratuit (pensez à l'export CSV régulier).

---

## 6. PROTECTION ET SÉCURITÉ (ce que le code fait déjà)

Vérifié par `npm test`, `npm run test:cloudflare` et `npm run test:browser` :

- **Validation serveur stricte** : e-mail, noms, rôle, message, consentement. Tout contournement du navigateur est rejeté (422) avec le détail des champs.
- **Aucune injection SQL** : requêtes préparées (`bind`) côté D1, API REST paramétrée côté Supabase. Aucune concaténation SQL.
- **Doublons rejetés** : e-mail normalisé (minuscules, espaces rognés) + contrainte `UNIQUE` (+ index insensible à la casse sur Postgres). Un doublon renvoie 409, sans insertion cachée.
- **Consentement obligatoire** : `consent: true` requis. La case n'est jamais pré-cochée.
- **Public désactivé par défaut** : seuls les signataires ayant coché l'option apparaissent (prénom, initiale, profil, date).
- **Code de retrait privé** : 32 caractères aléatoires (`base64url`), seul son hash SHA-256 est stocké. Irréversible.
- **IP pseudonymisées** : `request_limits` stocke un HMAC (secret serveur + IP + action + fenêtre), jamais l'IP en clair. Expiration automatique après 10 minutes.
- **Limitation d'écriture** : 60 tentatives / 10 min / IP par défaut (`SIGNATURE_RATE_LIMIT`). Dépassement = `429` + `Retry-After`.
- **Protection cross-site** : `sec-fetch-site: cross-site` ou `Origin` étrangère = 403 sur les écritures.
- **CSP stricte** : aucune ressource externe sauf Turnstile (si activé). Polices locales, pas d'analytics, pas de publicité, pas de cookies de suivi.
- **Piège anti-robot** : champ caché `website` ; tout contenu = 400.
- **Export privé** : `ADMIN_TOKEN` (≥ 32 caractères) via `Authorization: Bearer`, comparaison constante, pagination (`after`), protection anti-formules Excel, jamais de hash de retrait.
- **Clé Supabase cloisonnée** : la `service_role` reste côté serveur (Pages Functions). Le navigateur ne la voit jamais.

---

## 7. EXPORT DES SIGNATURES (privé, pour le collectif)

1. Fichier `.env` local (jamais sur GitHub) :
   ```
   PUBLIC_URL=https://votre-site.pages.dev
   ADMIN_TOKEN=votre-secret-de-32-caracteres
   ```
2. Lancez : `npm run export:signatures -- data/signatures-2026-10-14.csv`
3. Le script pagine `/api/admin/signatures.csv` (250 lignes par lot, curseur `X-Next-Cursor`).
4. Un seul fichier CSV, un seul en-tête (`Prénom;Nom;E-mail;...`), sans colonne de retrait.
5. Stockez le fichier de façon sécurisée (chiffrement disque, local uniquement, jamais de cloud public ni GitHub).

---

## 8. SI QUELQUE CHOSE NE MARCHE PAS (dépannage)

**Le formulaire renvoie 503 avec `DB_NOT_CONFIGURED`**
- `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` manque dans Pages → Settings → Variables (Production). Vérifiez l'orthographe exacte des noms, puis **redéployez** (les variables ne s'appliquent qu'au déploiement suivant).

**503 avec `SUPABASE_NOT_INITIALIZED`**
- Les tables n'existent pas : exécutez `migrations/0001_signatures-postgres.sql` dans le SQL Editor du BON projet Supabase (celui de `SUPABASE_URL`).
- Ou `petition_stats` a perdu sa ligne `id = 1` : `INSERT INTO petition_stats (id, total_count, public_count) VALUES (1, 0, 0) ON CONFLICT DO NOTHING;`.

**503 avec `FREE_QUOTA_REACHED`**
- Quota Supabase atteint (tableau de bord → « Usage »). Attendez le renouvellement ; aucune signature n'est perdue ou partielle.

**503 avec `TURNSTILE_NOT_CONFIGURED`**
- Une seule des deux clés Turnstile est renseignée. Mettez les deux, ou aucune (puis redéployez).

**422 avec `fields.turnstile`**
- Le visiteur n'a pas validé le widget, ou la vérification a échoué (mauvaise action, mauvais domaine). Vérifiez que le widget Turnstile utilise le même nom de domaine que le site.

**429 trop fréquent (lycée, une seule IP publique)**
- Augmentez `SIGNATURE_RATE_LIMIT` (ex : `300`) dans les variables Pages, puis redéployez.

**Le compteur reste à 0 après une signature**
- Vérifiez `SELECT * FROM petition_stats;` (une ligne `id = 1` requise) et les déclencheurs (`SELECT * FROM pg_trigger WHERE tgname LIKE 'signatures_count%';`).
- Regardez la réponse exacte de l'API (F12 → Réseau → `/api/signatures`) : le `code` indique la cause.

**Le bouton de partage ne copie rien**
- `navigator.clipboard` exige un contexte sécurisé (`https://`). En production HTTPS, cela fonctionne ; en `http://` local, utilisez le fallback (copie manuelle).

**Le PDF ne télécharge pas**
- Vérifiez `public/documents/revendications-leborgne-en-action.pdf` et le chemin `/documents/...` dans le code. Le build copie `public/` tel quel dans `dist/`.

**Le site est lent**
- Les polices et images sont locales et mises en cache (`public/_headers`). Choisissez une région Supabase proche (Europe pour la Guadeloupe).

---

## 9. CE QUE LE SITE NE FAIT PAS (et ne doit pas faire)

- Il n'envoie pas d'e-mails (pas de SMTP, pas de newsletter). L'adresse de contact est affichée dans le pied de page.
- Il n'utilise pas de cookies ou outils de suivi (pas d'analytics, pas de pixel). Rien n'est envoyé au serveur sans action explicite.
- Il ne collecte ni téléphone, ni date de naissance. Si la campagne s'adresse à des mineurs, vérifiez le cadre légal applicable (mention de consentement parental éventuelle — non gérée automatiquement).
- Pas de chatbot, commentaires, forum ou paiement : c'est une pétition de soutien, pas une collecte.

---

## 10. RÉFÉRENCES ET LIENS UTILES

- **Dépôt GitHub** : https://github.com/MaxLananas/Greve-petition (branche `main`)
- **Readme** : `README.md` (fonctionnement, tests, architecture)
- **Tests** : `npm test` (52 tests API), `npm run test:cloudflare` (intégration Miniflare), `npm run test:browser` (21 contrôles navigateur avec axe)
- **Migration Supabase** : `migrations/0001_signatures-postgres.sql`
- **Migration SQLite/D1 (dev local)** : `migrations/0001_signatures.sql`
- **Documentation Supabase** : https://supabase.com/docs/guides/getting-started
- **Documentation Cloudflare Pages** : https://developers.cloudflare.com/pages/
- **Documentation Turnstile (optionnel)** : https://developers.cloudflare.com/turnstile/
- **Politique de confidentialité Cloudflare** : https://www.cloudflare.com/privacypolicy/

---

*Dernière mise à jour : 2026-10-14 — API Cloudflare réécrite (D1 + Supabase REST), 52 tests API, intégration Miniflare, variables Supabase documentées.*
*Le site est prêt à être déployé via Cloudflare Pages + Supabase avec les étapes ci-dessus. Aucun audit légal ou d'accessibilité totale n'est revendiqué — les tests automatiques couvrent le fonctionnement technique.*
