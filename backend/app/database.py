from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database
from redis import Redis

from app.catalogs import BIOMES, SPECIES
from app.config import Settings
from app.models import EncounterType

Document = dict[str, Any]


class ValidationOptions(TypedDict):
    validator: Document
    validationLevel: Literal["strict"]
    validationAction: Literal["error"]


@dataclass
class Storage:
    mongo: Database[Document]
    redis: Redis


@contextmanager
def connect(settings: Settings) -> Iterator[Storage]:
    with MongoClient[Document](
        host=settings.mongo_host,
        port=settings.mongo_port,
        username=settings.mongo_username,
        password=settings.mongo_password.get_secret_value(),
        authSource=settings.mongo_auth_source,
        tz_aware=True,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=3000,
        socketTimeoutMS=5000,
    ) as mongo_client:
        with Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password.get_secret_value(),
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=5,
        ) as redis_client:
            mongo_client.admin.command("ping")
            redis_client.ping()
            yield Storage(mongo_client[settings.mongo_database], redis_client)


def initialize_schema(database: Database[Document]) -> None:
    uuid_schema = {
        "bsonType": "string",
        "pattern": r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    }
    common = {
        "_id": uuid_schema,
        "created_at": {"bsonType": "date"},
        "_sync_status": {"enum": ["pending", "synced"]},
    }
    schemas: dict[str, Document] = {
        "players": {
            "bsonType": "object",
            "additionalProperties": False,
            "required": [
                "_id", "username", "username_normalized", "created_at", "_sync_status"
            ],
            "properties": {
                **common,
                "username": {
                    "bsonType": "string",
                    "minLength": 3,
                    "maxLength": 32,
                    "pattern": r"^[A-Za-z0-9_]+$",
                },
                "username_normalized": {
                    "bsonType": "string",
                    "minLength": 3,
                    "maxLength": 32,
                    "pattern": r"^[a-z0-9_]+$",
                },
                "description": {
                    "bsonType": "string", "minLength": 1, "maxLength": 500
                },
                "minecraft_uuid": uuid_schema,
            },
        },
        "encounters": {
            "bsonType": "object",
            "additionalProperties": False,
            "required": [
                "_id", "player_id", "species_id", "location",
                "encounter_type", "description", "created_at", "_sync_status",
            ],
            "properties": {
                **common,
                "player_id": uuid_schema,
                "species_id": {
                    "bsonType": "string", "pattern": r"^[a-z][a-z0-9_]{0,63}$"
                },
                "animal_nickname": {
                    "bsonType": "string", "minLength": 1, "maxLength": 100
                },
                "location": {
                    "bsonType": "object",
                    "additionalProperties": False,
                    "required": ["biome_id"],
                    "properties": {
                        "biome_id": {
                            "bsonType": "string",
                            "pattern": r"^[a-z][a-z0-9_]{0,63}$",
                        },
                        "label": {
                            "bsonType": "string", "minLength": 1, "maxLength": 100
                        },
                    },
                },
                "encounter_type": {"enum": [value.value for value in EncounterType]},
                "description": {
                    "bsonType": "string", "minLength": 1, "maxLength": 4000
                },
            },
        },
    }
    for name in ("species", "biomes"):
        schemas[name] = {
            "bsonType": "object",
            "additionalProperties": False,
            "required": ["_id", "name"],
            "properties": {
                "_id": {
                    "bsonType": "string", "pattern": r"^[a-z][a-z0-9_]{0,63}$"
                },
                "name": {"bsonType": "string", "minLength": 1},
            },
        }
    existing = set(database.list_collection_names())
    for name, schema in schemas.items():
        options: ValidationOptions = {
            "validator": {"$jsonSchema": schema},
            "validationLevel": "strict",
            "validationAction": "error",
        }
        if name in existing:
            database.command("collMod", name, **options)
        else:
            database.create_collection(name, **options)

    database.players.create_index("username_normalized", unique=True)
    database.encounters.create_index([("created_at", DESCENDING), ("_id", ASCENDING)])
    for field in ("player_id", "species_id", "location.biome_id"):
        database.encounters.create_index(
            [(field, ASCENDING), ("created_at", DESCENDING), ("_id", ASCENDING)]
        )
    for name, entries in (("species", SPECIES), ("biomes", BIOMES)):
        for entry in entries:
            database[name].replace_one({"_id": entry["_id"]}, dict(entry), upsert=True)
