from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import AutoReconnect
from redis.exceptions import ConnectionError

from app.database import Storage
from app.service import Journal


def encounter_payload(owner_id: str, **changes: object) -> dict:
    return {
        "player_id": owner_id,
        "species_id": "fox",
        "animal_nickname": "Flamme",
        "location": {"biome_id": "taiga", "label": "Pres du campement"},
        "encounter_type": "feeding",
        "description": "Le renard s'approche pour manger des baies.",
        **changes,
    }


def create_player(client: TestClient, username: str = "Alex") -> dict:
    response = client.post("/players", json={"username": username})
    assert response.status_code == 201, response.text
    return response.json()


def test_player_persisted_in_both_databases(client: TestClient, storage: Storage):
    minecraft_uuid = uuid4()
    response = client.post(
        "/players",
        json={
            "username": "  Alex_42  ",
            "description": " Explorateur ",
            "minecraft_uuid": minecraft_uuid.hex.upper(),
        },
    )
    assert response.status_code == 201, response.text
    player = response.json()
    assert player["username"] == "Alex_42"
    assert player["username_normalized"] == "alex_42"
    assert player["description"] == "Explorateur"
    assert player["minecraft_uuid"] == str(minecraft_uuid)
    assert player["sync_status"] == "synced"
    assert UUID(player["id"]) != minecraft_uuid
    assert player["created_at"].endswith("Z")
    document = storage.mongo.players.find_one({"_id": player["id"]})
    assert document["minecraft_uuid"] == str(minecraft_uuid)
    assert document["_sync_status"] == "synced"
    redis_player = storage.redis.hgetall(f"player:{player['id']}")
    assert redis_player["minecraft_uuid"] == str(minecraft_uuid)
    assert redis_player["description"] == "Explorateur"
    assert storage.redis.hget("players:by_username", "alex_42") == player["id"]
    assert storage.redis.ttl(f"player:{player['id']}") == -1
    assert client.get(f"/players/{player['id']}").json() == player
    assert "_sync_status" not in player and "_id" not in player


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "  "},
        {"username": "ab"},
        {"username": "x" * 33},
        {"username": "Alex Dupont"},
        {"username": "Alex", "minecraft_uuid": "invalid"},
        {"username": "Alex", "description": "x" * 501},
        {"username": "Alex", "password": "not-supported"},
        {"username": "Alex", "username_normalized": "fake"},
    ],
)
def test_invalid_player_rejected(client: TestClient, storage: Storage, payload: dict):
    assert client.post("/players", json=payload).status_code == 422
    assert storage.mongo.players.count_documents({}) == 0


def test_optional_fields_and_shared_minecraft_uuid(client: TestClient, storage: Storage):
    response = client.post(
        "/players", json={"username": "Alex", "description": " ", "minecraft_uuid": ""}
    )
    assert response.status_code == 201
    identifier = response.json()["id"]
    assert "minecraft_uuid" not in storage.mongo.players.find_one({"_id": identifier})
    assert not storage.redis.hexists(f"player:{identifier}", "minecraft_uuid")
    account_id = str(uuid4())
    for username in ("Steve", "NotSteve"):
        assert client.post(
            "/players", json={"username": username, "minecraft_uuid": account_id}
        ).status_code == 201


def test_username_is_unique_case_insensitively(client: TestClient, storage: Storage):
    create_player(client)
    response = client.post("/players", json={"username": " alex "})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "username_exists"
    assert storage.mongo.players.count_documents({}) == 1


def test_field_length_boundaries_are_accepted(client: TestClient):
    for username in ("abc", "x" * 32):
        response = client.post(
            "/players", json={"username": username, "description": "x" * 500}
        )
        assert response.status_code == 201
    response = client.post(
        "/encounters",
        json=encounter_payload(
            response.json()["id"],
            animal_nickname="x" * 100,
            location={"biome_id": "taiga", "label": "x" * 100},
            description="x" * 4000,
        ),
    )
    assert response.status_code == 201


def test_catalogs(client: TestClient, storage: Storage):
    for route in ("species", "biomes"):
        response = client.get(f"/{route}")
        assert response.status_code == 200
        entries = response.json()
        assert len(entries) > 1
        for entry in entries:
            prefix = "species" if route == "species" else "biome"
            assert storage.redis.hget(f"{prefix}:{entry['id']}", "name") == entry["name"]
            assert storage.redis.sismember(f"{route}:all", entry["id"])
    assert {entry["id"] for entry in client.get("/encounter-types").json()} == {
        "observation", "approach", "feeding", "taming"
    }


def test_encounter_persisted_with_all_indexes(client: TestClient, storage: Storage):
    player = create_player(client)
    payload = encounter_payload(player["id"])
    response = client.post("/encounters", json=payload)
    assert response.status_code == 201, response.text
    encounter = response.json()
    identifier = encounter["id"]
    document = storage.mongo.encounters.find_one({"_id": identifier})
    assert document["location"] == payload["location"]
    assert document["_sync_status"] == "synced"
    fields = storage.redis.hgetall(f"encounter:{identifier}")
    assert fields["player_id"] == player["id"]
    assert fields["biome_id"] == "taiga"
    assert fields["location_label"] == "Pres du campement"
    assert fields["description"] == payload["description"]
    assert fields["animal_nickname"] == "Flamme"
    for key in (
        f"player:{player['id']}:encounters",
        "species:fox:encounters",
        "biome:taiga:encounters",
    ):
        assert storage.redis.smembers(key) == {identifier}
        assert storage.redis.ttl(key) == -1
    assert storage.redis.zscore("encounters:recent", identifier) == document[
        "created_at"
    ].timestamp()
    assert client.get(f"/encounters/{identifier}").json() == encounter


@pytest.mark.parametrize(
    "changes",
    [
        {"player_id": str(uuid4())},
        {"species_id": "dragon"},
        {"location": {"biome_id": "unknown"}},
        {"location": {"biome_id": "taiga", "coordinates": {"x": 1}}},
        {"encounter_type": "invalid"},
        {"description": "   "},
        {"description": "x" * 4001},
        {"encountered_at": "2026-10-15T10:00:00Z"},
        {"created_at": "2026-10-15T10:00:00Z"},
        {"animal_nickname": "x" * 101},
    ],
)
def test_invalid_encounter_rejected(client: TestClient, storage: Storage, changes: dict):
    player = create_player(client)
    response = client.post("/encounters", json=encounter_payload(player["id"], **changes))
    assert response.status_code == 422, response.text
    assert storage.mongo.encounters.count_documents({}) == 0


def test_optional_encounter_fields(client: TestClient, storage: Storage):
    player = create_player(client)
    response = client.post(
        "/encounters",
        json=encounter_payload(
            player["id"], animal_nickname="  ", location={"biome_id": "taiga", "label": ""}
        ),
    )
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    document = storage.mongo.encounters.find_one({"_id": identifier})
    assert "animal_nickname" not in document
    assert "label" not in document["location"]
    fields = storage.redis.hgetall(f"encounter:{identifier}")
    assert "animal_nickname" not in fields
    assert "location_label" not in fields


def test_filters_and_pagination(client: TestClient):
    alex = create_player(client)
    steve = create_player(client, "Steve")
    first = client.post("/encounters", json=encounter_payload(alex["id"])).json()
    second = client.post(
        "/encounters",
        json=encounter_payload(
            steve["id"], species_id="cow", location={"biome_id": "plains"}
        ),
    ).json()
    for filters in (
        {"player_id": alex["id"]}, {"species_id": "fox"}, {"biome_id": "taiga"},
        {"player_id": alex["id"], "species_id": "fox", "biome_id": "taiga"},
    ):
        assert client.get("/encounters", params=filters).json() == [first]
    assert client.get(
        "/encounters", params={"player_id": alex["id"], "species_id": "cow"}
    ).json() == []
    listed = client.get("/encounters").json()
    assert {entry["id"] for entry in listed} == {first["id"], second["id"]}
    assert client.get("/encounters?limit=1&offset=1").json() == listed[1:2]
    assert len(client.get("/players?limit=1&offset=1").json()) == 1
    for query in ("limit=0", "limit=101", "offset=-1", "species_id=%24ne"):
        assert client.get(f"/encounters?{query}").status_code == 422


@pytest.mark.parametrize("route", ["/players", "/encounters"])
def test_idempotent_creation(client: TestClient, storage: Storage, route: str):
    player = create_player(client)
    payload = {"username": "Steve"} if route == "/players" else encounter_payload(player["id"])
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.post(route, json=payload, headers=headers)
    second = client.post(route, json=payload, headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    changed = {**payload, "description": "Different"}
    response = client.post(route, json=changed, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "idempotency_conflict"
    assert client.post(
        route, json=payload, headers={"Idempotency-Key": "invalid"}
    ).status_code == 422


@pytest.mark.parametrize("route", ["/players", "/encounters"])
def test_partial_failure_is_explicit_and_retry_recovers(
    client: TestClient, storage: Storage, route: str
):
    player = create_player(client)
    payload = {"username": "Steve"} if route == "/players" else encounter_payload(player["id"])
    identifier = str(uuid4())
    headers = {"Idempotency-Key": identifier}
    with patch.object(storage.redis, "pipeline", side_effect=ConnectionError("offline")):
        response = client.post(route, json=payload, headers=headers)
    assert response.status_code == 503, response.text
    detail = response.json()["detail"]
    assert detail["persisted_in_mongodb"] is True
    assert detail["resource_id"] == identifier
    collection = route.lstrip("/")
    assert storage.mongo[collection].find_one({"_id": identifier})["_sync_status"] == "pending"
    assert client.get(f"{route}/{identifier}").json()["sync_status"] == "pending"
    recovered = client.post(route, json=payload, headers=headers)
    assert recovered.status_code == 201
    assert recovered.json()["sync_status"] == "synced"
    assert storage.mongo[collection].count_documents({"_id": identifier}) == 1


def test_resync_restores_missing_redis_data_without_duplicates(
    client: TestClient, storage: Storage
):
    player = create_player(client)
    encounter = client.post("/encounters", json=encounter_payload(player["id"])).json()
    storage.redis.flushdb()
    storage.redis.set("unrelated", "keep")
    counts = Journal(storage).resync()
    assert counts["players"] == counts["encounters"] == 1
    assert Journal(storage).resync() == counts
    assert storage.redis.get("unrelated") == "keep"
    assert storage.redis.hget(f"player:{player['id']}", "username") == "Alex"
    assert storage.redis.hget(f"encounter:{encounter['id']}", "description") == encounter[
        "description"
    ]
    assert storage.redis.zcard("encounters:recent") == 1
    assert storage.redis.scard("species:fox:encounters") == 1
    assert all(storage.redis.ttl(key) == -1 for key in storage.redis.scan_iter())


def test_encounter_repairs_a_pending_player(client: TestClient, storage: Storage):
    with patch.object(storage.redis, "pipeline", side_effect=ConnectionError("offline")):
        response = client.post("/players", json={"username": "Alex"})
    assert response.status_code == 503
    identifier = response.json()["detail"]["resource_id"]
    response = client.post("/encounters", json=encounter_payload(identifier))
    assert response.status_code == 201
    assert storage.mongo.players.find_one({"_id": identifier})["_sync_status"] == "synced"
    assert storage.redis.hget(f"player:{identifier}", "username") == "Alex"


def test_redis_wrong_key_type_is_not_a_success(client: TestClient, storage: Storage):
    player = create_player(client)
    storage.redis.set("encounters:recent", "wrong-type")
    response = client.post("/encounters", json=encounter_payload(player["id"]))
    assert response.status_code == 503
    identifier = response.json()["detail"]["resource_id"]
    assert storage.mongo.encounters.find_one({"_id": identifier})["_sync_status"] == "pending"
    storage.redis.delete("encounters:recent")
    Journal(storage).resync()
    assert storage.mongo.encounters.find_one({"_id": identifier})["_sync_status"] == "synced"


def test_storage_outages_and_missing_resources(client: TestClient, storage: Storage):
    for route in ("players", "encounters"):
        assert client.get(f"/{route}/{uuid4()}").status_code == 404
        assert client.get(f"/{route}/invalid").status_code == 422
    assert client.get("/health").json() == {"status": "ok"}
    with patch.object(storage.redis, "ping", side_effect=ConnectionError("offline")):
        assert client.get("/health").status_code == 503
    with patch.object(
        storage.mongo.players, "insert_one", side_effect=AutoReconnect("offline")
    ):
        response = client.post("/players", json={"username": "Alex"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "storage_unavailable"
    assert storage.mongo.players.count_documents({}) == 0


def test_openapi_uses_proxy_prefix(client: TestClient):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "/players" in response.json()["paths"]
    assert response.json()["servers"] == [{"url": "/api"}]
    assert client.get("/docs").status_code == 404
