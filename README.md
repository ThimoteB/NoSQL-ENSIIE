# CookieCraft : Explorers — NoSQL ENSIIE

Application web de démonstration de persistance multi-bases.

| Équipe | Projet |
| --- | --- |
| Thimoté Bois, Alice Baco | <https://github.com/ThimoteB/NoSQL-ENSIIE> |

## Démarrage rapide

```sh
git clone https://github.com/ThimoteB/NoSQL-ENSIIE.git
cd NoSQL-ENSIIE
docker compose up --build
```

Ouvrir <http://localhost:8080>, puis suivre
[Ouvrir les deux terminaux de persistance](#ouvrir-les-deux-terminaux-de-persistance).

## Sujet du projet

Application web simple, avec au moins une page de formulaire, qui persiste les
données saisies dans au moins deux systèmes parmi PostgreSQL, Redis, MongoDB,
Neo4j et Elasticsearch. Un fichier Docker Compose orchestre au moins trois
conteneurs (serveur + un par technologie de stockage). Le correcteur doit pouvoir
faire `git clone`, `docker compose up`, utiliser l'interface web, puis ouvrir un
terminal par système de persistance pour constater la persistance.

Ce projet utilise **MongoDB** et **Redis**, avec quatre conteneurs.

## État du projet

Le projet est un journal de rencontres avec les animaux Minecraft :

- **Frontend** : React et TypeScript, interface voxel et personnages 3D, compilés avec Vite et servis par Nginx.
- **Backend** : Python et FastAPI, API de joueurs, catalogues et rencontres.
- **Persistance** : MongoDB et Redis, chacun avec un volume et un réseau privé.

Le parcours web est fonctionnel : menu, création/sélection d'un explorateur,
préparation du monde, formulaire et journal filtrable. Les profils et rencontres
sont persistés dans MongoDB et Redis. Les skins sont récupérés par le backend
puis affichés en 3D dans le navigateur.

Aucune musique commerciale n'est incluse. Les captures de biomes du jeu sont
accompagnées de leurs sources, contributeurs et conditions d'utilisation.

## Arborescence

```text
.
├── compose.yaml
├── compose.test.yaml
├── .env.example
├── bruno/
│   ├── bruno.json
│   ├── collection.bru
│   ├── environments/Local.bru
│   └── 01 - Systeme/ ... 07 - Skins externes/
├── backend/
│   ├── Dockerfile
│   ├── Dockerfile.test
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── pytest.ini
│   ├── tests/
│   └── app/
│       ├── __init__.py
│       ├── catalogs.py
│       ├── config.py
│       ├── database.py
│       ├── models.py
│       ├── resync.py
│       ├── service.py
│       ├── skins.py
│       └── main.py
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    ├── playwright.config.ts
    ├── tests/
    ├── scripts/copy-licenses.mjs
    ├── public/audio/manifest.json
    ├── public/biomes/
    ├── public/animals/
    └── src/
        ├── App.tsx
        ├── AudioControls.tsx
        ├── Skin.tsx
        ├── CssSkin.tsx
        ├── World.tsx
        ├── api.ts
        ├── main.tsx
        ├── styles.css
        └── world-ui.css
```

## Démarrage

Prérequis : Git, Docker Engine/Docker Desktop en cours d'exécution et
**Docker Compose v2** (`docker compose version`).

```sh
git clone https://github.com/ThimoteB/NoSQL-ENSIIE.git
cd NoSQL-ENSIIE
docker compose up --build
```

Au premier démarrage, le téléchargement et la compilation prennent quelques
minutes. Un simple `docker compose up` construit également les images absentes ;
utiliser `--build` après modification des sources.

- Interface web : http://localhost:8080
- Le backend et les stockages n'ont aucun port publié sur l'hôte.

### Personnalisation

La configuration par défaut fonctionne sans copie de fichier. Pour personnaliser
les ports ou identifiants **avant le premier lancement** :

```sh
cp .env.example .env
```

Les identifiants par défaut sont uniquement destinés au développement local.
Les connecteurs MongoDB et Redis consomment les variables du backend et sont
fermés à l'arrêt du serveur. Aucun secret n'est transmis au frontend.

```sh
docker compose ps
docker compose logs -f backend
```

## Réseaux et accès

| Réseau | Services connectés | Usage |
| --- | --- | --- |
| `web` | frontend, backend | Proxy HTTP vers le serveur |
| `mongodb_private` | backend, mongodb | Accès MongoDB uniquement |
| `redis_private` | backend, redis | Accès Redis uniquement |

Les deux réseaux de stockage sont `internal: true`. MongoDB et Redis ne
partagent aucun réseau entre eux ; le frontend ne rejoint aucun réseau de
stockage. Le backend est le seul service relié aux deux stockages. Le port
web est lié à `127.0.0.1`, et non à toutes les interfaces de la machine.

Nginx est prêt à transférer `/api/...` au backend en retirant le préfixe `/api`.
La sonde du backend appelle `/health`, qui vérifie MongoDB et Redis et retourne
503 lorsqu'un stockage est indisponible. Les validateurs MongoDB, les index et les
catalogues sont initialisés au démarrage, puis les données MongoDB sont reprojetées
dans Redis avant que le backend soit prêt.

**Ce socle n'est pas destiné à une
exposition en production** : il faudra notamment activer TLS, l'authentification,
des comptes applicatifs à droits limités et une vraie gestion des secrets.

## Modèle métier

Il n'y a pas d'authentification : un profil public n'est pas une identité vérifiée.
Tout visiteur peut sélectionner un joueur existant pour déclarer une rencontre.

### Collections MongoDB

| Collection | Champs principaux |
| --- | --- |
| `players` | `_id`, `username`, `username_normalized`, `description` facultative, `minecraft_uuid` facultatif, `created_at`, `_sync_status` |
| `species` | `_id`, `name` |
| `biomes` | `_id`, `name` |
| `encounters` | `_id`, `player_id`, `species_id`, `animal_nickname` facultatif, `location`, `encounter_type`, `description`, `created_at`, `_sync_status` |

Les identifiants des joueurs et rencontres sont des UUID générés par le backend
(ou la clé d'idempotence UUID fournie). Les catalogues utilisent des identifiants
stables comme `fox` et `taiga`. Le backend vérifie l'existence des références.

- Pseudo : 3 à 32 lettres ASCII, chiffres ou `_`, espaces extérieurs retirés.
  Un index unique sur sa version en minuscules empêche `Alex` et `alex` de créer
  deux profils différents.
- Description du profil : facultative, 500 caractères maximum.
- UUID Minecraft Java : facultatif, accepté avec ou sans tirets, stocké en
  minuscules avec tirets. Il est indépendant de l'identifiant interne et n'est
  pas unique : l'association au compte est déclarative. Seul son format est
  vérifié à la création, pas l'existence du compte ni sa propriété. La récupération
  du skin est une opération distincte : son échec ne bloque pas la création.
- Une rencontre référence un joueur, une espèce et un biome. Le surnom de
  l'animal et le nom du lieu sont facultatifs (100 caractères maximum).
- `location` contient `biome_id` et éventuellement `label`, sans coordonnées.
- `encounter_type` : `observation`, `approach`, `feeding` ou `taming`.
- Le contexte `description` est obligatoire : 1 à 4 000 caractères après retrait
  des espaces extérieurs. Les textes facultatifs vides sont considérés absents.
- Aucune date de rencontre n'est demandée. `created_at` est la date de publication
  générée par le serveur en UTC.
- Les champs inconnus sont refusés. Les collections ont des validateurs MongoDB
  stricts ; les rencontres sont indexées par date, joueur, espèce et biome.

Les catalogues sont un sous-ensemble initial, extensible dans
[`backend/app/catalogs.py`](backend/app/catalogs.py). Le backend ne vérifie pas
les règles du jeu associant une espèce à un biome ou à un type de rencontre.
Il n'y a pas encore de modification ni de suppression.

### Structures Redis

| Clé | Type | Contenu |
| --- | --- | --- |
| `player:{id}` | Hash | Profil complet |
| `players:by_username` | Hash | Pseudo normalisé vers identifiant |
| `species:{id}`, `biome:{id}` | Hash | Entrées des catalogues |
| `species:all`, `biomes:all` | Set | Identifiants des catalogues |
| `encounter:{id}` | Hash | Rencontre complète, lieu aplati en `biome_id` et `location_label` |
| `encounters:recent` | Sorted set | Identifiants des rencontres, score = timestamp UTC |
| `player:{id}:encounters` | Set | Identifiants des rencontres d'un joueur |
| `species:{id}:encounters` | Set | Identifiants des rencontres d'une espèce |
| `biome:{id}:encounters` | Set | Identifiants des rencontres d'un biome |

Les champs facultatifs absents ne sont pas écrits. Aucune clé métier n'expire.
Redis n'est pas seulement un cache : il conserve les données et leurs index.
Les lectures filtrées et paginées utilisent MongoDB comme référence.

## API

Toutes les URL ci-dessous passent par Nginx sur `http://localhost:8080/api`.
Le schéma OpenAPI est disponible à `/api/openapi.json`.

| Méthode | Route | Usage |
| --- | --- | --- |
| `POST` | `/players` | Créer un profil |
| `GET` | `/players` | Lister les profils par pseudo |
| `GET` | `/players/{id}` | Lire un profil |
| `GET` | `/species` | Lister les espèces |
| `GET` | `/biomes` | Lister les biomes |
| `GET` | `/encounter-types` | Lister les types de rencontre |
| `POST` | `/encounters` | Déclarer une rencontre |
| `GET` | `/encounters` | Lister et filtrer les rencontres (MongoDB) |
| `GET` | `/encounters/{id}` | Lire une rencontre |
| `GET` | `/health` | Vérifier les deux stockages |
| `GET` | `/skins/{minecraft_uuid}` | Modèle classic/slim et URL de texture locale |
| `GET` | `/skins/{minecraft_uuid}/texture` | Texture PNG validée pour le rendu 3D |

Les listes de joueurs et rencontres acceptent `limit` (1 à 100, 50 par défaut)
et `offset` (0 par défaut). Les rencontres acceptent également les filtres
combinables `player_id`, `species_id` et `biome_id`.

Créer un joueur (l'UUID Minecraft peut être omis) :

```sh
curl -i http://localhost:8080/api/players \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  -d '{"username":"Alex","description":"Explorateur"}'
```

Puis créer une rencontre avec l'identifiant du joueur retourné :

```sh
curl -i http://localhost:8080/api/encounters \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 22222222-2222-4222-8222-222222222222' \
  -d '{
    "player_id": "11111111-1111-4111-8111-111111111111",
    "species_id": "fox",
    "animal_nickname": "Flamme",
    "location": {"biome_id": "taiga", "label": "Pres du campement"},
    "encounter_type": "feeding",
    "description": "Le renard est venu manger des baies."
  }'
```

```sh
curl 'http://localhost:8080/api/encounters?species_id=fox&biome_id=taiga'
```

### Double écriture et reprise

MongoDB est la source de référence. Chaque création est enregistrée avec un statut
interne `pending`, puis projetée dans Redis (hash et index regroupés avec
`MULTI/EXEC`), avant de passer à `synced`. Les réponses publiques exposent ce statut
sous le nom `sync_status`. Un succès HTTP 201 confirme les deux écritures.

Il n'y a **pas de transaction distribuée** MongoDB/Redis. Une panne Redis après
l'écriture MongoDB produit une erreur HTTP 503 avec `code=redis_sync_pending`,
`persisted_in_mongodb=true` et `resource_id`. La donnée MongoDB est conservée ;
elle peut être lue avec son statut `pending`. Une panne MongoDB ou une réponse
d'écriture incertaine produit aussi une erreur 503, sans promettre l'absence
d'écriture. Les erreurs de stockage sont journalisées.

Le header facultatif `Idempotency-Key` doit être un UUID : le réutiliser avec
le même corps permet de reprendre une création sans doublon, y compris après
une panne. La même clé avec des données différentes retourne 409 ; un pseudo
déjà pris retourne également 409. Utiliser une nouvelle clé pour chaque nouvelle
création. Sans header, le serveur génère l'identifiant ; un nouvel essai peut
donc créer une nouvelle rencontre. Le frontend conserve cette clé pendant les
tentatives d'une même soumission.

Pour rejouer les projections Redis sans modifier les identifiants :

```sh
docker compose exec backend python -m app.resync
```

La commande retourne les nombres d'objets traités et échoue explicitement si un
stockage est indisponible. Elle est aussi exécutée au démarrage. Elle réécrit les
hashes et complète les index de manière rejouable, sans vider Redis ni supprimer
les clés étrangères au projet. Ce n'est pas un nettoyage des anciennes clés :
les modifications/suppressions et changements de catalogue nécessiteront une
stratégie de migration dédiée.

## Interface et skins

Le menu **Continuer** ouvre une liste paginée de profils publics avec personnages
3D. **Nouvelle partie** crée un profil avec pseudo, description et UUID Minecraft
facultatifs pour les deux derniers champs. Il n'y a pas d'authentification.

Après sélection, un écran de préparation charge réellement le profil, les
catalogues et le journal. L'animation de terrain est décorative, pas une génération
de monde Minecraft ; la progression compte les trois étapes de chargement.
Cet écran reste affiché **au moins cinq secondes**, y compris après une création
de profil. Avec la réduction des animations activée, le terrain est statique,
mais le délai est conservé. Les boutons gris à relief, panneaux pierre/terre et
survols gris bleuté s'inspirent de **Minecraft Java**, pas de Bedrock.
En cas d'erreur, le joueur peut réessayer ou revenir au menu.

Le journal possède deux onglets :

Le skin de l'explorateur actif reste affiché en 3D dans l'en-tête des deux onglets,
avec le même mode compatible sans WebGL que lors de la création et de la sélection.
Les personnages sont affichés sans socle.

- **Nouvelle rencontre** : la saisie est conservée en changeant d'onglet.
  Une véritable capture du jeu change selon le biome choisi. Chaque soumission garde
  sa clé d'idempotence lors d'une reprise ; après une réponse incertaine, les champs
  et le changement de profil sont verrouillés jusqu'à résolution. Un avertissement
  du navigateur protège également la fermeture/recharge pendant une écriture en attente.
- **Toutes les rencontres** : pagination et filtres par explorateur, espèce et
  biome, auteur, lieu et statut de synchronisation. Le filtre des explorateurs
  permet de charger les profils par lots au-delà de la première page.
  Chaque espèce possède un portrait transparent issu d'un rendu de son modèle
  Minecraft, à la place d'une icône générique. Les douze images sont servies
  localement en WebP, sans moteur 3D supplémentaire pour les animaux.

L'interface est adaptée aux petits écrans, utilisable au clavier et respecte
`prefers-reduced-motion`. Les onglets sont navigables avec les flèches gauche/droite.
Les appels API passent par `/api` sur la même origine, avec délai de 20 secondes.
Un rechargement complet revient au menu ; les brouillons ne sont pas stockés
durablement dans le navigateur.

### Livraison des skins

Le backend utilise les services officiels `sessionserver.mojang.com` et
`textures.minecraft.net`, en HTTPS, sans redirection ni URL fournie directement
par le visiteur. Seuls l'UUID demandé et la référence publique de texture sont
transmis à ces services, pas le pseudo local, la description ou les rencontres.
La connectivité sortante du backend passe par le réseau `web` ; les bases restent
isolées.

Le profil est limité à 64 Kio et l'image à 512 Kio. Seules les textures PNG 64×32
ou 64×64 sont acceptées et réencodées. Le modèle classique ou slim est communiqué
au frontend, qui charge la texture depuis notre API avec `skinview3d`.
Ce sont des textures, pas des captures d'écran de personnages.

Redis conserve un **cache technique** `skin-cache:{uuid}` pendant une heure,
séparé des clés métier sans expiration. Les textures ne sont pas ajoutées au dépôt.
Un compte sans skin renvoie 404, une réponse invalide 502, un fournisseur indisponible
503. Les erreurs sont visibles dans l'interface ; un personnage original de
remplacement permet de continuer. L'absence de cache est journalisée mais ne bloque
pas la récupération auprès du fournisseur.

La bibliothèque 3D est chargée à la demande. Les personnages hors écran sont
déchargés, et l'animation est suspendue lorsque l'onglet du navigateur est masqué.
Sans WebGL (ou après perte du contexte), un rendu **CSS 3D** affiche le même skin :
six volumes texturés, couches externes, modèles classique/slim et anciennes
textures 64×32. Ce mode continue de récupérer la texture du backend ; il ne
remplace pas un skin disponible par une icône. Sa rotation est automatique,
sans les contrôles souris du moteur WebGL.
Un canvas neuf est créé à chaque remontage et les contextes GPU sont libérés.

Dans Opera, si « Mode 3D compatible » apparaît, vérifier **Réglages → Système →
Utiliser l'accélération graphique si disponible**, puis redémarrer le navigateur.
La page `opera://gpu` permet de vérifier l'état de WebGL. Le site ne peut pas
réactiver une fonction GPU bloquée par le navigateur, un pilote ou une politique
système ; le rendu CSS 3D est prévu pour conserver l'affichage dans ce cas.

### Ambiance audio et ressources

La musique est **désactivée tant qu'aucun fichier n'est configuré**. Un clic court
original est synthétisé avec Web Audio. Le bouton Son règle séparément musique et
effets, permet de couper le son et mémorise les préférences dans `localStorage`.
L'audio ne démarre qu'après interaction, conformément aux règles des navigateurs.

Pour ajouter vos fichiers dont la diffusion est autorisée, les placer dans
`frontend/public/audio/` puis modifier `manifest.json` :

```json
{
  "music": "/audio/ambiance.mp3",
  "click": "/audio/clic.ogg"
}
```

Les formats acceptés par le manifeste sont `.mp3`, `.ogg` et `.wav`, avec un nom
simple composé de lettres, chiffres, `_` ou `-`. Garder `null` pour les ressources
absentes, puis reconstruire le frontend avec `docker compose up --build -d`.
Un fichier configuré mais introuvable ou illisible produit un message dans les
réglages audio. La musique boucle et se met en pause dans un onglet masqué.

Les dix paysages sont de vraies captures Minecraft provenant du **Minecraft Wiki**,
stockées localement en WebP dans `frontend/public/biomes/` : aucun dessin de biome
généré, aucun hotlink ni requête au wiki depuis le navigateur. Les fichiers
`credits.json` (également accessible depuis le pied de page) détaillent les URL,
révisions et contributeurs. Seuls le redimensionnement et la compression ont été
appliqués, sans suppression de filigrane. Ces images restent la propriété de
Mojang/Microsoft et relèvent des [Minecraft Usage Guidelines](https://www.minecraft.net/usage-guidelines),
**pas** de la licence Creative Commons du texte du wiki. Le site est un projet
étudiant non officiel, ni approuvé ni associé à Mojang ou Microsoft.

La texture du personnage de remplacement et les styles sont originaux.
Les portraits d'animaux, leurs contributeurs et conditions figurent dans
[`frontend/public/animals/credits.json`](frontend/public/animals/credits.json),
également accessible dans le pied de page. Les rendus de poule et de tortue
portent respectivement les conditions CC BY-NC 3.0 et CC BY-NC-SA 3.0, en plus
des droits Mojang sur les éléments du jeu : usage non commercial, attribution
et partage de l'adaptation de la tortue sous la même licence. Les marges
transparentes sont recadrées et les images redimensionnées, sans génération IA.
La police **VT323** est distribuée sous OFL-1.1, `skinview3d` et Three.js
sous MIT. Les licences des dépendances d'exécution sont copiées dans `/licenses/`
au build (par exemple `/licenses/fontsource-vt323.txt` et `/licenses/skinview3d.txt`).
Le projet ne contient ni pistes C418 ni sons extraits du jeu.
Ne publier des MP3 ou images tiers que si leur licence ou votre
autorisation couvre le site et le dépôt GitHub.

## Collection Bruno

Ouvrir le dossier [`bruno`](bruno/) avec **Open Collection** dans Bruno, puis
sélectionner l'environnement **Local**. L'application Docker doit être démarrée.
La collection contient **56 requêtes**, chacune avec des tests automatisés :

| Dossier | Contenu |
| --- | --- |
| `01 - Systeme` | Initialisation des variables, sonde MongoDB/Redis et schéma OpenAPI |
| `02 - Catalogues` | Espèces, biomes et types de rencontre |
| `03 - Joueurs` | Création complète/minimale, UUID Minecraft, lecture, pagination, unicité et idempotence |
| `04 - Rencontres` | Création complète/minimale, lecture, filtres, pagination et idempotence |
| `05 - Erreurs` | Réponses attendues 404 et 422 : identifiants, références, champs, limites |
| `06 - Pannes manuelles` | Panne Redis, écriture partielle, lecture `pending` et reprise sans doublon |
| `07 - Skins externes` | Métadonnées et image PNG du skin, connexion au fournisseur requise |

### Parcours automatique : 47 requêtes

Exécuter les dossiers **01 à 05 dans l'ordre**, sans parallélisme. Dans le runner
graphique, désélectionner les dossiers **06 et 07** (ou exclure les tags `manual,external`).
Ne pas exécuter toute la collection sans cette exclusion : le scénario de panne
nécessite des manipulations Docker entre les requêtes.

La première requête génère les UUID et pseudos de la session ; les requêtes
suivantes réutilisent les identifiants et comparent les réponses sauvegardées.
Les tests d'erreur sont réussis lorsqu'ils reçoivent l'erreur attendue.

En CLI, depuis la racine du dépôt, avec Node.js/npm disponibles :

```sh
cd bruno
npm exec --yes --package=@usebruno/cli@4.2.1 -- bru run --env Local --exclude-tags manual,external --bail
```

Cette version du CLI est épinglée pour rendre l'exécution reproductible.
Le sandbox `safe` par défaut suffit ; aucun script n'exécute de commande système.
Pour changer le port HTTP sans éditer l'environnement :

```sh
npm exec --yes --package=@usebruno/cli@4.2.1 -- bru run --env Local --exclude-tags manual,external --bail \
  --env-var baseUrl=http://localhost:8081/api
```

Le parcours ajoute des données de démonstration et ne les supprime pas : l'API
n'a pas encore de suppression. Chaque nouvelle initialisation génère des pseudos
uniques ; rejouer seulement une création idempotente ne crée pas de doublon.
L'UUID Minecraft d'exemple sert à tester son stockage dans les dossiers 01 à 05.
Le dossier 07 l'utilise pour demander son skin au fournisseur officiel. Les UUID et instantanés du parcours sont des variables runtime Bruno,
pas des secrets ni des modifications de l'environnement versionné.

Pour vérifier les skins séparément, avec une connexion Internet :

```sh
npm exec --yes --package=@usebruno/cli@4.2.1 -- bru run '07 - Skins externes' --env Local --bail
```

### Scénario manuel Redis : 7 requêtes

Dans le dossier **06 - Pannes manuelles**, exécuter les étapes séparément :

1. Redis actif : requête **01**, pour préparer le joueur.
2. Depuis la racine du dépôt, lancer `docker compose stop redis`.
3. Exécuter les requêtes **02**, **03**, **04** : sonde 503, création 503 avec
   conservation MongoDB, puis lecture de la rencontre avec `sync_status=pending`.
4. Lancer `docker compose start redis` et attendre qu'il soit sain.
5. Exécuter **05**, **06**, **07** : sonde rétablie, reprise avec la même clé,
   puis vérification de l'unique rencontre synchronisée.

**Toujours redémarrer Redis même si un test échoue.** Ce scénario interrompt
temporairement le stockage de la pile de développement : ne pas le lancer sur un
environnement partagé utilisé par d'autres personnes. Ne pas redémarrer le backend
pendant la panne : son initialisation exige les deux bases.

Les identifiants et le pseudo de ce scénario sont fixes dans `Local.bru` pour
pouvoir exécuter ses requêtes une par une, même entre plusieurs invocations du CLI.
Le scénario est rejouable avec ces mêmes valeurs. Les pannes ne sont jamais
déclenchées automatiquement par les scripts Bruno.

## Vérifications locales

Validation de la configuration Docker, sans démarrer les conteneurs :

```sh
docker compose config --quiet
```

Vérification TypeScript et compilation du frontend (Node.js 22.12 ou plus récent) :

```sh
cd frontend
npm ci
npm run build
```

Tests navigateur reproductibles, une fois la pile Docker démarrée sur le port 8080 :

```sh
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e
```

Ils couvrent création et sélection, conservation du brouillon, filtres,
reprise après perte d'une réponse d'écriture sans doublon, affichage mobile,
validation, erreur du fournisseur de skins, mémorisation des réglages audio,
alignement du panneau, délai de cinq secondes, chargement des dix captures et
rendu CSS 3D sans WebGL (classique, slim et ancien format).
Ils vérifient aussi la transparence et la couverture de toutes les espèces par les
portraits, le skin persistant dans le journal et la superposition du texte jaune
sur la fin du titre.
Ils créent des données de test dans la pile locale, sans suppression automatique.
Les rapports/éventuelles traces restent dans les dossiers ignorés par Git.

Tests backend avec Python 3.13 (MongoDB et Redis sont simulés pour cette suite) :

```sh
cd backend
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m mypy app --check-untyped-defs
```

Ces tests couvrent notamment la validation, les UUID, l'unicité, les références,
la double écriture, les filtres, l'idempotence, les pannes/reprises et la livraison
des skins (fournisseur simulé, contrôle des URL, taille, format PNG et cache).
Le test de stockage réel est ignoré sans `RUN_LIVE_STORAGE_TESTS=1`.

Tests avec de vrais MongoDB et Redis, dans une pile séparée sans port publié :

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f compose.test.yaml down -v
```

Cette pile a son propre nom, ses réseaux et ses données de test : ne pas la
fusionner avec `compose.yaml`. Le test réel vérifie le démarrage de l'application,
les validateurs et l'index unique MongoDB, les écritures Redis, la resynchronisation
et la relecture après réouverture des connexions. Il ne remplace pas le test de
recréation des conteneurs et volumes décrit plus haut.

La validation complète de l'infrastructure nécessite un moteur Docker actif :
`docker compose up --build --wait`, puis vérifier l'interface, l'état des quatre
services et le scénario de persistance décrit plus haut.

