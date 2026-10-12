import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError, WriteError

from app.config import Settings
from app.database import connect
from app.main import create_app
from app.service import Journal

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_STORAGE_TESTS") != "1",
    reason="Run with the isolated compose.test.yaml stack to test real databases.",
)


def test_real_database_lifecycle_validation_and_recovery():
    player_key = str(uuid4())
    encounter_key = str(uuid4())
    username = f"Explorer_{uuid4().hex[:12]}"
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        response = client.post(
            "/players",
            json={"username": username, "minecraft_uuid": uuid4().hex},
            headers={"Idempotency-Key": player_key},
        )
        assert response.status_code == 201, response.text
        player = response.json()
        response = client.post(
            "/encounters",
            json={
                "player_id": player["id"],
                "species_id": "fox",
                "location": {"biome_id": "taiga"},
                "encounter_type": "observation",
                "description": "Un renard pres du campement.",
            },
            headers={"Idempotency-Key": encounter_key},
        )
        assert response.status_code == 201, response.text
        encounter = response.json()
        with connect(Settings.from_environment()) as storage:
            for collection, identifier, prefix in (
                ("players", player_key, "player"),
                ("encounters", encounter_key, "encounter"),
            ):
                assert storage.mongo[collection].find_one({"_id": identifier})[
                    "_sync_status"
                ] == "synced"
                assert storage.redis.hget(f"{prefix}:{identifier}", "id") == identifier
                assert storage.redis.ttl(f"{prefix}:{identifier}") == -1
            with pytest.raises(WriteError):
                storage.mongo.players.insert_one({"_id": str(uuid4()), "username": "bad"})
            with pytest.raises(WriteError):
                storage.mongo.encounters.update_one(
                    {"_id": encounter_key}, {"$set": {"encounter_type": "invalid"}}
                )
            duplicate = storage.mongo.players.find_one({"_id": player_key})
            duplicate["_id"] = str(uuid4())
            with pytest.raises(DuplicateKeyError):
                storage.mongo.players.insert_one(duplicate)
            storage.redis.delete(f"encounter:{encounter_key}")
            Journal(storage).resync()
            assert storage.redis.hget(
                f"encounter:{encounter_key}", "description"
            ) == encounter["description"]
    # Reopening the production lifespan checks that initialization is repeatable.
    with TestClient(create_app()) as client:
        assert client.get(f"/players/{player_key}").json() == player
        assert client.get(f"/encounters/{encounter_key}").json() == encounter
