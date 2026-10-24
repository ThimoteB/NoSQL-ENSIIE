import logging
from uuid import NAMESPACE_URL, uuid5

from app.models import EncounterCreate, EncounterType, Location, PlayerCreate
from app.service import Journal

logger = logging.getLogger(__name__)

PLAYERS = (
    PlayerCreate(username="Demo_Alex", description="Demo : les animaux de la foret."),
    PlayerCreate(username="Demo_Steve", description="Demo : voyageur des plaines."),
    PlayerCreate(username="Demo_Luna", description="Demo : exploratrice des oceans."),
)

# Player index, species, biome, type, nickname, place and journal entry.
ENCOUNTERS = (
    (0, "fox", "taiga", EncounterType.FEEDING, "Flamme", "Campement des sapins",
     "Un renard est sorti des fougeres pour manger quelques baies."),
    (0, "wolf", "forest", EncounterType.TAMING, "Givre", "Clairiere du vieux chene",
     "Apres quelques os et beaucoup de patience, ce loup me suit partout."),
    (1, "horse", "plains", EncounterType.APPROACH, "Eclair", "Prairie fleurie",
     "Un cheval curieux s'est approche pendant la construction de mon abri."),
    (1, "bee", "forest", EncounterType.OBSERVATION, "Miel", "Ruche des bouleaux",
     "Les abeilles font des allers-retours entre leur ruche et les fleurs."),
    (2, "turtle", "beach", EncounterType.OBSERVATION, "Corail", "Plage du levant",
     "Une tortue est revenue sur le sable au lever du soleil."),
    (2, "axolotl", "lush_caves", EncounterType.FEEDING, "Bulle", "Grotte aux lianes",
     "Un axolotl nage dans un bassin sous les baies lumineuses."),
)


def seed_demo_data(journal: Journal) -> None:
    database = journal.storage.mongo
    marker = {"_id": "demo-v1"}
    state = database.app_metadata.find_one(marker)
    if state is None:
        if database.players.find_one() or database.encounters.find_one():
            logger.info("Demo data skipped: journal already contains user data")
            return
        database.app_metadata.update_one(
            marker, {"$setOnInsert": {"status": "pending"}}, upsert=True
        )
    elif state["status"] == "complete":
        return

    # Stable keys let an interrupted initialization resume without duplicates.
    player_ids = []
    for payload in PLAYERS:
        identifier = uuid5(NAMESPACE_URL, f"cookiecraft:demo:v1:{payload.username}")
        journal.create_player(payload, identifier)
        player_ids.append(identifier)
    for index, (player, species, biome, kind, nickname, place, text) in enumerate(ENCOUNTERS):
        journal.create_encounter(
            EncounterCreate(
                player_id=player_ids[player],
                species_id=species,
                location=Location(biome_id=biome, label=place),
                encounter_type=kind,
                animal_nickname=nickname,
                description=text,
            ),
            uuid5(NAMESPACE_URL, f"cookiecraft:demo:v1:encounter:{index}"),
        )
    database.app_metadata.update_one(marker, {"$set": {"status": "complete"}})
    logger.info("Demo data initialized: %s players, %s encounters", len(PLAYERS), len(ENCOUNTERS))
