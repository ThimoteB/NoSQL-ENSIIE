from unittest.mock import patch

import pytest
from redis.exceptions import ConnectionError

from app.database import Storage
from app.demo import ENCOUNTERS, PLAYERS, seed_demo_data
from app.models import Encounter, Player, PlayerCreate
from app.service import Journal, SynchronizationError


def test_demo_data_is_valid_and_projected_to_both_databases(storage: Storage):
    seed_demo_data(Journal(storage))

    assert storage.mongo.players.count_documents({}) == len(PLAYERS)
    assert storage.mongo.encounters.count_documents({}) == len(ENCOUNTERS)
    for document in storage.mongo.players.find():
        player = Player.model_validate({**document, "id": document["_id"]})
        assert player.sync_status == "synced"
        assert player.minecraft_uuid is None
        assert storage.redis.hget(f"player:{player.id}", "username") == player.username
    for document in storage.mongo.encounters.find():
        encounter = Encounter.model_validate({**document, "id": document["_id"]})
        assert encounter.sync_status == "synced"
        assert storage.mongo.players.find_one({"_id": str(encounter.player_id)})
        assert storage.redis.hget(
            f"encounter:{encounter.id}", "animal_nickname"
        ) == encounter.animal_nickname
        assert storage.redis.sismember(
            f"species:{encounter.species_id}:encounters", str(encounter.id)
        )
        assert storage.redis.zscore("encounters:recent", str(encounter.id)) is not None


def test_demo_data_is_not_duplicated_or_recreated(storage: Storage):
    journal = Journal(storage)
    seed_demo_data(journal)
    players = list(storage.mongo.players.find())
    encounters = list(storage.mongo.encounters.find())
    with patch.object(journal, "create_player") as create:
        seed_demo_data(journal)
        create.assert_not_called()
    assert list(storage.mongo.players.find()) == players
    assert list(storage.mongo.encounters.find()) == encounters

    storage.mongo.encounters.delete_many({})
    storage.mongo.players.delete_many({})
    seed_demo_data(journal)
    assert storage.mongo.players.count_documents({}) == 0
    assert storage.mongo.encounters.count_documents({}) == 0


def test_demo_data_leaves_existing_journal_untouched(storage: Storage):
    journal = Journal(storage)
    journal.create_player(PlayerCreate(username="Professor"))
    before = list(storage.mongo.players.find())
    seed_demo_data(journal)
    assert list(storage.mongo.players.find()) == before
    assert storage.mongo.encounters.count_documents({}) == 0
    assert storage.mongo.app_metadata.find_one() is None


@pytest.mark.parametrize("failure_at", [1, 6])
def test_demo_data_resumes_after_an_interrupted_redis_write(
    storage: Storage, failure_at: int
):
    journal = Journal(storage)
    project = journal.project
    calls = 0

    def interrupt(collection, document):
        nonlocal calls
        calls += 1
        if calls == failure_at:
            raise ConnectionError("offline")
        project(collection, document)

    with patch.object(journal, "project", side_effect=interrupt):
        with pytest.raises(SynchronizationError):
            seed_demo_data(journal)
    assert storage.mongo.app_metadata.find_one()["status"] == "pending"
    assert storage.mongo.players.count_documents({}) == min(failure_at, len(PLAYERS))

    journal.resync()
    seed_demo_data(journal)
    assert storage.mongo.players.count_documents({}) == len(PLAYERS)
    assert storage.mongo.encounters.count_documents({}) == len(ENCOUNTERS)
    assert storage.mongo.app_metadata.find_one()["status"] == "complete"
