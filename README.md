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

