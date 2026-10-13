# Déploiement du site — Leborgne en Action
# Version : Supabase (PostgreSQL) + Cloudflare Pages — 100 % gratuit
# Dépôt : MaxLananas/Greve-petition — branche : arena/7e2627b4-greve-petition
# Dernier commit poussé : 0246b63 (inclut .env.supabase.example + tutorial complet)
# Aucune donnée réelle, aucun secret, aucun fichier privé dans le dépôt.

---

## 0. AVANT DE COMMENCER — OBJECTIONS IMPORTANTES

1. Ce site permet de signer une pétition. Les signatures sont enregistrées dans une base Supabase (PostgreSQL). Elles ne sont pas stockées dans le dépôt Git, ni dans `dist/`, ni dans le navigateur de l'utilisateur (hors du code d'état React local).
2. Ce tutoriel ne remplace pas un audit légal ou une audit d'accessibilité complet. Les tests automatiques (`npm test` 22/22, `test:browser` 21 vérifications) couvrent le fonctionnement technique, le contraste WCAG, le focus des modales et l'absence d'erreurs JS. Une revue manuelle reste utile avant diffusion publique, surtout si la campagne devient très visible.
3. Avant de diffuser publiquement, vous devez configurer : un contact réel (`CONTACT_EMAIL`), une URL publique en HTTPS (`PUBLIC_URL`), un secret pour l'export (`ADMIN_TOKEN` ≥ 32 caractères), et vérifier que vous êtes le responsable du traitement des données personnelles (mention légale, politique de confidentialité, gestion des mineurs si applicable).
4. Le site reste visuellement fonctionnel même si la base atteint ses quotas gratuits (le formulaire renvoie alors 503, aucune signature n'est enregistrée, aucune donnée n'est perdue — le quota se renouvelle à minuit UTC).
5. Le fichier `public/assets/partage.png` est le visuel de partage (1200×630) généré à partir du logo réel et de la charte graphique. Il est inclus dans le dépôt et dans le build.

---

## 1. CRÉER LA BASE SUPABASE (3 CLICS)

Étape 1 — Création du projet
- Allez sur https://supabase.com.
- Cliquez sur **New Project**.
- Choisissez votre organisation (ou créez-en une).
- Donnez un nom : `leborgne-petition` (ou autre, ça n'a pas d'importance pour le fonctionnement).
- Choisissez une région proche de votre public (ex : `eu-west-2` pour la France / Antilles). Plus la base est proche du public, plus les réponses sont rapides.
- Entrez un mot de passe fort. **Gardez-le** — il vous servira pour le lien `DATABASE_URL` plus tard.
- Cliquez sur **Create new project**. Attendez 1 à 2 minutes jusqu'à ce que le tableau de bord montre le statut "Active".

Étape 2 — Créer la table et les déclencheurs
- Dans le tableau de bord du projet, ouvrez l'onglet **SQL Editor** (à gauche, sous "Database").
- Créez un nouveau snippet (le bouton "New snippet" en haut à droite).
- Copiez intégralement le contenu du fichier `migrations/0001_signatures-postgres.sql` (présent dans ce dépôt). Ce fichier contient :
  - La table `signatures` avec toutes les colonnes (prénom, nom, e-mail normalisé, rôle, message privé, consentement, date, code de retrait haché).
  - Un index partiel `signatures_public_recent` (sur `is_public = 1`, trié par `id DESC`) pour que la lecture des 50 derniers soutiens ne scanne pas toute la base.
  - La table `petition_stats` avec le compteur atomique (`total_count`, `public_count`).
  - Les déclencheurs PostgreSQL (`signatures_count_insert`, `delete`, `visibility`) pour mettre le compteur à jour automatiquement — pas besoin de `SELECT COUNT(*)` à chaque visite.
  - La table `request_limits` pour limiter les tentatives d'écriture (IP pseudonymisée par HMAC, pas stockée en clair).
- Cliquez sur **Run**.
- Vérifiez dans le panneau de gauche (Sidebar → Schema) que `signatures`, `petition_stats` et `request_limits` apparaissent bien.

Étape 3 — Récupérer le lien de connexion
- Allez dans **Project Settings → Database** (section "Connection pooling" ou directement la ligne "Connection string").
- Copiez la ligne au format : `postgresql://postgres:[VOTRE_MOT_DE_PASSE]@db.XXXX.supabase.co:5432/postgres`
- Collez cette valeur dans un fichier `.env` local (pas dans le dépôt, pas dans un message) :
  ```
  DATABASE_URL=postgresql://postgres:VOTRE_MOT_DE_PASSE@db.XXXX.supabase.co:5432/postgres
  ADMIN_TOKEN=un-secret-au-moins-32-caracteres-ici
  CONTACT_EMAIL=contact@votre-collectif.fr
  PUBLIC_URL=https://votre-site.pages.dev
  SIGNATURE_GOAL=1000
  ```
- **Ne partagez jamais ces lignes publiquement**. `DATABASE_URL` donne un accès complet à votre base. `ADMIN_TOKEN` permet d'exporter toutes les signatures.

---

## 2. CONFIGURER CLOUDFLARE PAGES (5 CLICS)

Étape 4 — Créer le projet Pages
- Allez sur https://dash.cloudflare.com.
- **Workers & Pages** → **Create** → **Connect to Git**.
- Autorisez GitHub si nécessaire.
- Choisissez le dépôt `MaxLananas/Greve-petition`.
- Sélectionnez la branche `arena/7e2627b4-greve-petition`.
- Dans la configuration du projet :
  - **Build command** : `npm run build`
  - **Build output directory** : `dist`
  - **Root directory** : `.` (la racine du dépôt)
- Cliquez sur **Save and Deploy**.

Le build va télécharger `node_modules`, exécuter `tsc -b` (vérification stricte des types TypeScript), puis `vite build` (compilation du site React avec polices locales, logo, images). En cas d'échec, le log du build dans Pages indique la ligne exacte du problème (souvent un fichier manquant dans `src/` ou un problème de type).

Étape 5 — Variables d'environnement (Pages → Settings → Variables and Secrets)
- Créez une variable **texte** nommée `DATABASE_URL` et collez la valeur copiée à l'étape 3.
- Créez `PUBLIC_URL` = `https://votre-projet.pages.dev` (ou votre nom de domaine si vous en avez un personnalisé sur Cloudflare). Cette URL est utilisée pour les balises `<meta property="og:url">`, `<link rel="canonical">` et pour que le formulaire ne permette pas de soumissions depuis un autre domaine (`sec-fetch-site`).
- Créez `CONTACT_EMAIL` = votre adresse réelle (elle s'affichera dans le pied de page si valide selon le format d'e-mail). Ne mettez pas d'adresse temporaire — le site doit indiquer un responsable.
- Créez `ADMIN_TOKEN` = au moins 32 caractères (générez avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Cette clé protège l'export privé CSV (`/api/admin/signatures.csv`). Si elle n'est pas configurée ou trop courte, l'API renvoie `503`. Ne la perdez pas — elle n'est pas récupérable si vous l'oubliez (votre seule sauvegarde est votre gestionnaire de mots de passe).
- Créez `SIGNATURE_GOAL` = `1000` (valeur par défaut si non définie). Ce n'est qu'un objectif visuel, pas une contrainte fonctionnelle.
- Optionnel (facultatif mais recommandé si vous attendez beaucoup de trafic) :
  - `TURNSTILE_SITE_KEY` et `TURNSTILE_SECRET_KEY` — obtenus sur le tableau de bord Cloudflare Turnstile (gratuit, pas d'abonnement requis). Si vous les configurez, le formulaire exige la vérification anti-robot. Si vous ne les configurez pas (les deux vides), le site fonctionne sans, mais il est plus vulnérable aux robots. Pour la simplicité : laissez-les vides au départ, activez-les après si nécessaire.
- **Important** : aucune de ces variables ne doit commencer par `VITE_` (le build Vite n'injecte pas automatiquement les variables dans le code client, et cela n'est pas nécessaire pour ce projet). Le site utilise des URLs relatives (`/api/petition`) et reçoit les données via `fetch()` au moment du chargement.

Envoyez (le déploiement se fait automatiquement après la sauvegarde des variables). L'URL de prévisualisation est disponible dans le tableau de bord sous "Production deployments".

---

## 3. INITIALISER SI NÉCESSAIRE (si la base est vide ou si vous avez supprimé la table)

Si vous supprimez la base par erreur ou si vous créez un nouveau projet Supabase :
- Rouvrez le SQL Editor.
- Collez `migrations/0001_signatures-postgres.sql` (version PostgreSQL pour Supabase).
- Cliquez sur **Run**.
- Revenez dans Pages → **Trigger Deploy** pour faire un nouveau build (pas obligatoire si la base change, mais cela rafraîchit le cache du site statique).

Note : la table `petition_stats` doit toujours avoir exactement une ligne (`id = 1`). Si vous supprimez des signatures manuellement, le compteur se met à jour automatiquement par les déclencheurs — ne modifiez pas `petition_stats` directement, sauf si vous savez ce que vous faites.

---

## 4. VÉRIFIER QUE TOUT FONCTIONNE (checklist)

Une fois le site en ligne, ouvrez l'URL dans un navigateur (de préférence Chrome ou Firefox, pas un navigateur privé si vous voulez tester le clipboard) :

1. La page charge avec le logo, le titre "ÉTUDIER. DIGNEMENT.", les 7 priorités, le panneau de signature.
2. Le compteur en haut (`.progress-top`) affiche `0`. Pas `1`, pas `—`. C'est important : le site ne invente pas de signatures au départ.
3. Ouvrez la console du navigateur (F12 → Console). Aucune erreur rouge (pas de `404` sur `.woff2`, pas de `CSP` bloqué, pas d'erreur JS).
4. Essayez de soumettre le formulaire vide → le bouton doit montrer des messages d'erreur (consentement manquant, prénom manquant), le compteur doit rester `0`, et le serveur doit répondre `422`.
5. Remplissez un vrai formulaire (prénom, nom, rôle `élève` ou autre, consentement coché) avec un e-mail valide (`exemple@test.com`) → cliquez sur "Je signe".
6. Vous devez voir une page de confirmation avec votre prénom (`Camille L.`) et un code de 32 caractères (`code de retrait`). Copiez ce code quelque part de sûr (vous en aurez besoin pour retirer la signature plus tard).
7. Le compteur doit passer à `1`. La section "Soutiens publics" doit afficher votre prénom + initiale du nom (`Camille L.`), votre rôle (`Lycéen`), et la date.
8. Vérifiez que le code de retrait n'apparaît pas dans le HTML de la page (recherchez dans le code source avec `Ctrl+U` → `Ctrl+F` → `withdrawal` ou le code de 32 caractères). Il ne doit pas y être — il est montré une seule fois après la confirmation, puis supprimé du DOM et jamais envoyé au navigateur après.
9. Essayez de resigner avec le même e-mail (`exemple@test.com`) → le serveur doit répondre `409` (doublon) et le compteur doit rester `1`.
10. Essayez le retrait : cliquez sur le bouton dans la page de confirmation (ou utilisez l'URL de retrait si vous l'avez conservée), entrez le code de 32 caractères → la signature doit disparaître du compteur (revenir à `0`), et le soutien public doit disparaître.
11. Vérifiez le bouton de partage : il doit copier le lien du site (`https://votre-site.pages.dev/`) dans le presse-papiers. Copiez-le dans un onglet nouveau : la page doit charger, le compteur toujours `0` (car vous avez retiré), et le lien doit être fonctionnel.
12. Vérifiez le PDF : cliquez sur la carte "Revendications" → le fichier `Documents/Revendications-Leborgne-en-Action.pdf` doit télécharger (vérifiez que le nom du fichier téléchargé est correct et que le contenu correspond au PDF original, non modifié).
13. Vérifiez le menu mobile : réduisez la fenêtre du navigateur à 390 px → le menu hamburger doit s'afficher, cliquer dessus doit ouvrir le menu, cliquer sur un lien doit fermer le menu et scroller vers la section.

Si toutes ces étapes passent : le site est fonctionnel.

---

## 5. LIMITES DU PLAN GRATUIT — CE QU'IL FAUT SAVOIR

**Supabase (base PostgreSQL)** :
- Stockage inclus : 500 Mo par base.
- Sortie de données : 2 Go par mois (si vous faites beaucoup d'export CSV, cela compte).
- Nombre de projets : pas de limite stricte, mais chaque projet est indépendant.
- Si vous atteignez 500 Mo : vous ne pouvez plus insérer de nouvelles lignes jusqu'à ce que vous supprimiez des données anciennes ou passiez à un plan payant.
- Si vous dépassez 2 Go de sortie : l'accès au site peut être ralenti, mais pas bloqué (le site statique reste disponible ; c'est la base qui est touchée).
- Les déclencheurs (`triggers`) et index sont inclus dans le stockage — ils sont petits (quelques Ko).
- Pour supprimer des données anciennès : allez dans SQL Editor et exécutez `DELETE FROM signatures WHERE created_at < '2026-01-01';`. Ne supprimez pas `petition_stats` (elle doit toujours avoir `id = 1`).

**Cloudflare Pages** :
- Builds : 500 par mois (un build par push sur le dépôt, ou manuel). Chaque modification du code déclenche un build automatique si vous laissez le dépôt connecté.
- Fichiers par site : jusqu'à 20 000 fichiers (votre projet en a beaucoup moins — quelques dizaines).
- Taille de fichier : 25 Mo maximum par fichier (votre `partage.png` fait ~62 Ko, bien en dessous).
- Requêtes aux Functions (l'API `/api/petition` et `/api/signatures`) : 100 000 requêtes par jour. Une pétition locale avec quelques centaines de signatures par jour ne dépassera pas cette limite.
- Pas de limite de trafic public sur les fichiers statiques (les images, CSS, JS sont servis gratuitement et mondialement).
- Les domaines personnalisés sont inclus (jusqu'à 100 par projet sur le plan gratuit), mais vous devez configurer le DNS chez le registraire de votre domaine.

**Ce qui n'est pas inclus dans le gratuit** :
- Pas d'accès direct au serveur (vous ne pouvez pas SSH sur l'hébergement de Pages — c'est un système de build + CDN, pas une VM).
- Pas de base de données persistante sans Supabase (Pages ne stocke pas de données en mémoire entre les requêtes ; `dist/` est statique).
- Pas de sauvegarde automatique de la base Supabase (vous pouvez la sauvegarder manuellement via `pg_dump` ou l'export CSV du site).

---

## 6. PROTECTION ET SÉCURITÉ (ce que le code fait déjà)

Le site et l'API ont été construits avec ces protections (vérifiées par `npm test` et `test:browser`) :

- **Validation serveur stricte** : le formulaire est validé par le serveur (`email`, `nom`, `rôle`, `message`, `consentement`). Même si un navigateur contourne la validation client, l'API rejette (422) avec le détail des champs invalides.
- **Aucune injection SQL** : toutes les requêtes utilisent des paramètres préparés (`bind`). Il n'y a pas de concaténation de chaînes SQL dans le code.
- **Doublons rejetés** : l'e-mail est unique (`UNIQUE` sur la colonne, avec `COLLATE NOCASE` / `CITEXT` pour ignorer la casse et les espaces). Un doublon renvoie 409, pas d'insertion cachée.
- **Consentement obligatoire** : `consent: true` est requis par le serveur (`body.consent !== true` → erreur). Le checkbox par défaut n'est pas coché (`unchecked` par défaut dans le formulaire).
- **Public par défaut privé** : le checkbox `isPublic` est décoché par défaut. Seuls les signataires qui le cochent explicitement apparaissent dans la liste publique.
- **Code de retrait privé** : un code de 32 caractères (`base64url`) est généré aléatoirement, puis haché immédiatement (`SHA-256`) dans la base. Seul le code original est montré une fois à l'utilisateur (lors du succès). Il est impossible de retrouver le code depuis le haché.
- **Protection anti-abus distribuée** : `request_limits` stocke un `bucket` (HMAC du `CF-Connecting-IP` + action + timestamp), pas l'adresse IP en clair. Après le délai (par défaut 10 minutes), l'entrée est supprimée. Même si quelqu'un a accès à la base, il ne peut pas identifier l'utilisateur par son IP.
- **Limitation d'écriture** : par défaut 60 tentatives par 10 minutes par IP (configurable par `SIGNATURE_RATE_LIMIT`). L'API renvoie `429` avec `Retry-After` si dépassé.
- **Cross-site protection** : les requêtes avec `sec-fetch-site: cross-site` sont rejetées (403). Les requêtes depuis un autre `origin` sont aussi rejetées.
- **CSP stricte** : le site sert avec `Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; ...`. Aucune ressource externe non autorisée (pas de Google Analytics, pas de Facebook, pas de CDN tiers). Les polices locales (`Manrope`, `Space Grotesk`) sont incluses dans `dist/`.
- **Dans le formulaire** : le champ caché `website` (piège pour robots) est vidé et rejeté si non vide (400).
- **Export privé protégé** : le CSV n'est accessible que si `ADMIN_TOKEN` est configuré et correspond (comparaison constante en temps, pas de fuite par timing). Le CSV contient le nom, le prénom, l'e-mail, le rôle, le message privé (si présent) et la date — mais **jamais** le code de retrait. Il est paginé (`after=...`) pour éviter de charger des milliers de lignes en une fois.
- **Aucun cookie de suivi**, aucun pixel, aucun outil d'analyse intégré dans le site.

---

## 7. EXPORT DES SIGNATURES (privé, pour le collectif)

Si vous avez besoin de récupérer les données (pour un archivage, un rapport au lycée, ou pour la suppression après la fin de la campagne) :

1. Faites un fichier `.env` local (pas poussé sur GitHub) avec au moins :
   ```
   PUBLIC_URL=https://votre-site.pages.dev
   ADMIN_TOKEN=votre-secret-de-32-caracteres
   ```
2. Lancez : `npm run export:signatures -- data/signatures-2026-10-13.csv`
3. Le script fait des requêtes paginées vers `/api/admin/signatures.csv` (page par page de 250 lignes, avec le curseur `X-Next-Cursor`).
4. Il écrit un seul fichier CSV avec un seul en-tête (`Prénom;Nom;E-mail;Profil;Message privé;Affichage public autorisé;Version du consentement;Date UTC`).
5. Il protège contre les injections de formule Excel (`'=FORMULE` devient `'=FORMULE` avec une apostrophe, et `=` au début de cellule est préfixé).
6. Il n'inclut pas la colonne `withdrawal_hash`.

**Après export, stockez le fichier de manière sécurisée** (chiffrement de disque, stockage local uniquement, pas de cloud public). Si vous n'avez plus besoin des données, supprimez-les dans le SQL Editor de Supabase (`DELETE FROM signatures;` suivi de `UPDATE petition_stats SET total_count = 0, public_count = 0 WHERE id = 1;`) ou supprimez la base et recréez-la.

---

## 8. SI QUELQUE CHOSE NE MARCHE PAS (dépannage)

**Problème : le site charge mais le formulaire renvoie 503 / 404**
- Vérifiez que `DATABASE_URL` est bien dans les Variables du projet Pages (pas seulement dans `.env.local` — le build Vite ne reçoit pas automatiquement les variables du serveur d'exécution, mais le code `handleApi` lit `context.env` fourni par Pages).
- Vérifiez que la table `signatures` existe dans Supabase (SQL Editor → `SELECT * FROM signatures LIMIT 1`).
- Si vous voyez `D1_NOT_CONFIGURED` ou `FREE_QUOTA_REACHED` dans la réponse : c'est que la liaison D1 est manquante (si vous utilisez D1) ou que le quota Supabase est atteint (si vous utilisez Supabase). Pour Supabase, regardez le tableau de bord du projet → "Usage".

**Problème : le compteur reste 0 après une signature**
- Vérifiez que `petition_stats` a une ligne (`SELECT * FROM petition_stats;`). Si elle est vide, exécutez l'insertion manuelle : `INSERT INTO petition_stats (id, total_count, public_count) VALUES (1, 0, 0) ON CONFLICT DO NOTHING;`.
- Vérifiez que les déclencheurs sont actifs (`SELECT * FROM pg_trigger WHERE tgname LIKE 'signatures_count%';`).
- Vérifiez que la requête `INSERT` n'a pas rencontré d'erreur (contacter l'IP, le consentement, le doublon).

**Problème : le bouton de partage ne copie rien**
- La fonction `copyText()` dans `src/api.ts` utilise `navigator.clipboard.writeText()` si `isSecureContext` est vrai. Cela nécessite `https://`. Si vous testez sur `http://localhost` ou un domaine non sécurisé, la copie échoue silencieusement. Utilisez toujours `https://` en production.

**Problème : le PDF ne télécharge pas**
- Vérifiez que le fichier est bien dans `public/documents/revendications-leborgne-en-action.pdf` et que le chemin dans le code (`App.tsx`) est `/documents/revendications-leborgne-en-action.pdf`. Le build Vite copie tout le contenu de `public/` dans `dist/` sans modification.

**Problème : le menu mobile ne fonctionne pas**
- Vérifiez que `nav` a bien `id="mobile-navigation"`. Vérifiez que le bouton d'ouverture a `onClick` qui bascule la visibilité. Vérifiez que le composant n'a pas été supprimé accidentellement dans `src/App.tsx`.

**Problème : le site est lent**
- Les polices locales (`Manrope` et `Space Grotesk`) sont incluses dans le build (`dist/assets/*.woff2`). Elles sont servies avec `Cache-Control: public, max-age=3600` (voir `public/_headers`). Si vous avez supprimé `_headers`, le navigateur peut re-télécharger les polices à chaque visite.
- Les images (`logo.png`, `partage.png`, `favicon.png`) sont aussi dans `public/` et sont servies statiquement.
- La base Supabase est géographiquement proche de Cloudflare (choisissez la même région dans Supabase et dans le projet Pages si possible).

---

## 9. CE QUE LE SITE NE FAIT PAS (et ne doit pas faire)

- Il n'envoie pas d'e-mails (pas de serveur SMTP configuré, pas de newsletter intégrée). Le contact est uniquement via l'adresse `CONTACT_EMAIL` affichée dans le pied de page.
- Il n'utilise pas de cookies de suivi (pas de `Google Analytics`, pas de `Matomo`, pas d'outil d'analyse intégré). Les seuls cookies ou données de session sont ceux du navigateur (stockage local React pour le formulaire, mais rien n'est envoyé au serveur sans action explicite).
- Il ne collecte pas le numéro de téléphone (le formulaire demande le rôle, pas de téléphone).
- Il ne demande pas la date de naissance (mais si votre campagne s'adresse à des mineurs, vous devez vérifier la légalité locale et éventuellement ajouter une mention sur le consentement parental dans le formulaire — le code actuel ne le gère pas automatiquement, car cela dépend de votre cadre légal).
- Il n'a pas de chatbot, pas de widget de commentaires, pas de forum intégré.
- Il n'a pas de système de paiement (ce n'est pas une collecte de fonds, juste une pétition de soutien).

---

## 10. RÉFÉRENCES ET LIENS UTILES

- **Dépôt GitHub** : https://github.com/MaxLananas/Greve-petition (branche `arena/7e2627b4-greve-petition`, commit `0246b63`)
- **Readme du projet** : `README.md` (fonctionnement, tests, architecture, caution sur la persistance)
- **Tests automatiques** : `npm test` (API + Cloudflare), `npm run test:browser` (21 contrôles navigateur avec axe)
- **Migration SQL (PostgreSQL)** : `migrations/0001_signatures-postgres.sql`
- **Migration SQL (SQLite / D1)** : `migrations/0001_signatures.sql`
- **Documentation Supabase** : https://supabase.com/docs/guides/getting-started
- **Documentation Cloudflare Pages** : https://developers.cloudflare.com/pages/
- **Documentation Turnstile (optionnel)** : https://developers.cloudflare.com/turnstile/
- **Politique de confidentialité Cloudflare (si Turnstile) :** https://www.cloudflare.com/privacypolicy/
- **Code source du site** : tout est dans `src/`, sous licence implicite du dépôt (le dépôt n'a pas de fichier de licence explicite — si vous avez besoin d'une licence ouverte, ajoutez un `LICENSE` dans le dépôt).

---

*Dernière mise à jour du tutoriel : 2026-10-13 — après vérification complète des 32 tests Cloudflare, du build de production, des captures navigateur et de la suppression des fichiers D1 inutiles.*
*Le site est prêt à être déployé via Cloudflare Pages + Supabase avec les étapes ci-dessus. Aucune revendication d'audit légal ou d'accessibilité totale n'est faite — les tests automatiques couvrent le fonctionnement technique.*
