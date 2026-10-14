# Leborgne en Action — la pétition

Site de la mobilisation 2026–2027 du lycée Yves Leborgne à Sainte-Anne, en Guadeloupe. L’identité visuelle reprend le logo fourni, les formes modulaires, Manrope / Space Grotesk et la palette de la charte. Les contenus sont tirés du dossier de revendications enrichi de neuf pages, conservé intégralement et proposé au téléchargement.

## Ce qui fonctionne

- Site responsive, navigation par ancres, sept fiches de revendications et FAQ.
- Enregistrement **réel** des signatures côté serveur (Supabase en production, SQLite en local). Aucun chiffre ou soutien prérempli.
- Unicité des adresses e-mail, validation côté client **et serveur**, consentement obligatoire, limitation des tentatives, champ anti-robot discret et Turnstile optionnel.
- Compteur actualisé après une signature / un retrait, puis toutes les minutes et au retour sur la page.
- Affichage public désactivé par défaut : uniquement le prénom, l’initiale du nom, le profil facultatif et la date si la personne donne son accord. E-mail, nom complet et messages jamais publics.
- Référence privée de retrait remise à la signature ; seule son empreinte est enregistrée. Le retrait supprime la ligne et actualise le compteur.
- Partage natif quand disponible, sinon copie du lien ; dossier PDF original consultable et téléchargeable.
- Export CSV réservé à l’équipe, désactivé tant qu’un secret n’est pas configuré. Les cellules sont protégées contre l’injection de formules.
- Polices hébergées localement. Pas d’analytics, de publicité ou de cookies de suivi.

## Lancer le site

**Node.js 22.13 ou supérieur** est nécessaire (`node:sqlite`). Le pilote SQLite est intégré à Node ; Node 22 peut afficher un avertissement expérimental.

```sh
npm ci
cp .env.example .env
npm run dev
```

Le site et son API sont servis sur **le même port, 3000**, avec une écoute sur `0.0.0.0`. Toutes les requêtes du navigateur utilisent des URLs relatives : aucun appel à un serveur `localhost` dans le code frontend. L’aperçu proxifié est accepté par le serveur de développement.

### Production

```sh
npm ci
npm run build
npm start
```

Le serveur sert alors `dist/` et l’API. Il n’est **pas** possible de déployer uniquement les fichiers statiques : l’enregistrement des signatures nécessite ce serveur Node.

### Docker (facultatif)

```sh
docker build -t leborgne-petition .
docker volume create leborgne-signatures
docker run -d --name leborgne-petition \
  -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/signatures.sqlite \
  -v leborgne-signatures:/app/data \
  leborgne-petition
```

Un volume persistant est indispensable. Les signatures ne doivent pas être placées dans un dossier public, dans Git, ou sur un disque éphémère. Docker n’a pas été exécuté dans l’environnement de développement ; le lancement Node et le build sont testés.

## Configuration avant une diffusion publique

Voir `.env.example` :

| Variable | Utilité |
| --- | --- |
| `PORT` | Port HTTP, 3000 par défaut. |
| `DATABASE_PATH` | Chemin privé de la base, `./data/signatures.sqlite` par défaut. |
| `SIGNATURE_GOAL` | Premier palier visuel, 1 000 par défaut ; **ce n’est pas une cible indiquée dans le PDF** et il peut être ajusté par l’équipe. |
| `CONTACT_EMAIL` | Adresse réelle du collectif responsable. Elle apparaît dans la confidentialité et le pied de page quand elle est renseignée. |
| `PUBLIC_URL` | Origine publique HTTPS pour les métadonnées de partage et le lien canonique. |
| `TRUST_PROXY` | Nombre de reverse proxies de confiance, 0 par défaut. À adapter à la chaîne réelle d’hébergement, jamais `true` sans contrôle. |
| `SIGNATURE_RATE_LIMIT` | Envois autorisés par IP sur dix minutes, 60 par défaut. À augmenter si de nombreux élèves partagent la même connexion. |
| `ADMIN_TOKEN` | Secret aléatoire d’au moins 32 caractères donnant accès à l’export CSV. Vide = export désactivé. Ne jamais l’envoyer au frontend ou le committer. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Clés du widget anti-robot Cloudflare Turnstile. Vides = désactivé. Les deux doivent être renseignées ensemble. |

En production Cloudflare Pages, ajoutez en plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `SIGNATURE_RATE_SECRET` (voir `DEPLOY-TUTORIAL.md`).

**Avant mise en ligne :** renseigner l’adresse de contact, valider collectivement les contenus et les demandes nouvelles, identifier juridiquement le responsable et l’hébergeur dans les mentions de confidentialité si nécessaire, arrêter une durée de conservation, et confirmer les modalités de remise des signatures aux destinataires. Une signature peut révéler un soutien à une mobilisation ; l’équipe doit vérifier les obligations de protection des données qui lui sont applicables, notamment pour les mineurs. Le site ne prétend pas être un dispositif juridiquement audité.

Mettre le serveur derrière **HTTPS**, restreindre l’accès au fichier SQLite et à l’export, sauvegarder le volume avec les mêmes restrictions, et prévoir la suppression des données à la clôture de la mobilisation (y compris les sauvegardes). Le retrait supprime les données de la base active ; le traitement des sauvegardes relève de l’exploitant. SQLite convient à une instance serveur unique ; pour plusieurs instances, migrer vers une base partagée.

La pétition n’envoie pas d’e-mail et ne vérifie pas la possession de l’adresse : le compteur correspond aux signatures enregistrées, **pas à des identités certifiées**. La validation est syntaxique, l’unicité est par adresse e-mail, et la limitation de tentatives est par IP. Pour une diffusion à grande échelle, ajouter une confirmation par e-mail et une protection anti-abus adaptée, en informant les signataires.

## Export privé

Après avoir configuré `ADMIN_TOKEN` dans l’environnement du serveur, charger ce même secret dans votre terminal privé (ne pas le mettre en URL) :

```sh
curl --fail \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$PUBLIC_URL/api/admin/signatures.csv" \
  -o signatures-leborgne.csv
```

Le CSV contient les coordonnées, le profil, le message privé, l’accord d’affichage, la version de consentement et la date UTC. Il ne contient ni références de retrait ni empreintes. Il doit rester confidentiel.

## Tests

```sh
npm test           # 10 tests API : validation, confidentialité, doublons, retrait, export, anti-abus, persistance
npm run check      # Vérification TypeScript
npm run build      # Build de production
npm run test:browser
```

Les tests navigateur utilisent un serveur de production local et **une base en mémoire isolée**, jamais les signatures du site. Ils vérifient le formulaire complet, les doublons, le retrait, le partage, le téléchargement, le focus des modales, le menu mobile, l’absence de débordement de 320 à 1 440 px et les contrôles axe WCAG A/AA. Les captures sont dans `test-results/` (ignoré par Git). Le navigateur embarqué est prévu pour Linux ; ailleurs, fournir `CHROMIUM_PATH` vers un Chromium compatible. Les 52 tests API, les 2 tests d’intégration Cloudflare et les 21 vérifications navigateur passent. Les contrôles automatisés ne remplacent pas un audit d’accessibilité manuel.

## Structure

- `src/` : React / TypeScript, composants, contenu et styles.
- `shared/` : validation et métadonnées communes aux deux API.
- `cloudflare/` : API Pages Functions (D1 **ou** Supabase, détection automatique) + tests.
- `functions/` : point d’entrée Pages Functions (`/api/*`).
- `migrations/` : `0001_signatures.sql` (SQLite/D1, dev local) et `0001_signatures-postgres.sql` (Supabase, production).
- `server/` : API Express + SQLite (développement local, Docker, auto-hébergement).
- `tests/` : tests d’intégration du bundle Cloudflare via Miniflare.
- `public/assets/` : logo dérivé du fichier fourni, favicon et visuel de partage.
- `public/documents/` : dossier PDF original, inchangé.
- `data/` : base privée créée au lancement, **ignorée par Git**.

Les documents initialement fournis à la racine sont conservés. Les données et les secrets ne sont pas versionnés.

## Hébergement gratuit (Cloudflare Pages + D1)

En production, le site est une page statique sur Cloudflare Pages et les signatures sont enregistrées dans une base D1 (SQLite Cloudflare) via les Pages Functions. Tout est chez Cloudflare, aucun service externe requis, aucune dépense ni abonnement sur les plans gratuits.

**Déploiement express (10 minutes) : suivez `DEPLOY-D1-RAPIDE.md`** — résumé :
- `npx wrangler login`, `npm run cloudflare:db:create`, `npm run cloudflare:db:migrate`, `npm run cloudflare:db:check`.
- Projet Pages connecté au dépôt (branche `main`), build `npm run build`, dossier `dist`, Node 22.
- Relier la base : Pages → Settings → Functions → D1 binding nommé exactement `DB`.
- Variables (Production) : `CONTACT_EMAIL`, `PUBLIC_URL=https://...`, `ADMIN_TOKEN` (≥ 32 caractères, chiffré), `SIGNATURE_GOAL` (optionnel), `SIGNATURE_RATE_SECRET` (recommandé), `TURNSTILE_*` (optionnels, les deux ensemble ou aucun).
- Redéployer, puis vérifier `https://<projet>.pages.dev/api/health` : `{"status":"ok","storage":"d1",...}`.
- Pour l’export : `npm run export:signatures -- data/export.csv`, avec `PUBLIC_URL` (HTTPS) et `ADMIN_TOKEN` dans un `.env` privé. Le fichier produit doit rester privé et ne jamais être publié.

En cas de dépassement du quota gratuit de D1 : l’API renvoie un code `FREE_QUOTA_REACHED` (503) et la signature n’est pas enregistrée ; aucune donnée partielle n’est conservée. Réessayez après le renouvellement du quota.

Le développement local peut utiliser `npm run dev` (SQLite) ou `npm run cloudflare:dev` (D1 locale). Supabase reste supporté en alternative (l’API détecte automatiquement le backend ; voir `DEPLOY-TUTORIAL.md`).

### Les limites réelles du plan gratuit

- **Pages** : trafic public inclus ; 500 builds/mois ; 100 000 requêtes Functions/jour. Une pétition locale ne dépassera pas cette limite, sauf campagne massive.
- **D1** : 5 Go de stockage, 5 millions de lignes lues/jour, 10 bases. Largement suffisant pour une pétition (quelques Ko par signature).
- **Pas de nom de domaine obligatoire** : le lien `https://<projet>.pages.dev` fonctionne directement.

Le site reste visible même si la base atteint ses limites, car l’interface est statique. Seule la signature devient temporairement impossible jusqu’au renouvellement du quota.
