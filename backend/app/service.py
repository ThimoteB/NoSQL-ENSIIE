import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from pymongo.errors import DuplicateKeyError
from redis.exceptions import RedisError
from redis.typing import EncodableT

from app.database import Document, Storage
from app.models import Encounter, EncounterCreate, Player, PlayerCreate

logger = logging.getLogger(__name__)


class DomainError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.detail: Document = {"code": code, "message": message}
        super().__init__(message)


class SynchronizationError(Exception):
    def __init__(self, collection: str, identifier: str) -> None:
        self.collection = collection
        self.identifier = identifier
        super().__init__(f"Redis synchronization incomplete: {collection}/{identifier}")


class Journal:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def project(self, collection: str, document: Document) -> None:
        identifier = document["_id"]
        fields: dict[EncodableT, EncodableT] = {}
        for name, value in document.items():
            if name in ("_id", "_sync_status"):
                continue
            if name == "location":
                fields["biome_id"] = value["biome_id"]
                if "label" in value:
                    fields["location_label"] = value["label"]
            elif isinstance(value, datetime):
                fields[name] = value.isoformat()
            else:
                fields[name] = str(value)
        fields["id"] = identifier
        prefix = {
            "players": "player", "encounters": "encounter",
            "species": "species", "biomes": "biome",
        }[collection]
        with self.storage.redis.pipeline(transaction=True) as pipeline:
            key = f"{prefix}:{identifier}"
            # Replacing the hash also removes optional fields left by an older projection.
            pipeline.delete(key)
            pipeline.hset(key, mapping=fields)
            if collection == "players":
                pipeline.hset(
                    "players:by_username", document["username_normalized"], identifier
                )
            elif collection == "encounters":
                pipeline.zadd(
                    "encounters:recent",
                    {identifier: document["created_at"].timestamp()},
                )
                pipeline.sadd(f"player:{document['player_id']}:encounters", identifier)
                pipeline.sadd(f"species:{document['species_id']}:encounters", identifier)
                pipeline.sadd(
                    f"biome:{document['location']['biome_id']}:encounters", identifier
                )
            else:
                pipeline.sadd(f"{collection}:all", identifier)
            pipeline.execute()

    def synchronize(self, collection: str, document: Document) -> None:
        self.storage.mongo[collection].update_one(
            {"_id": document["_id"]}, {"$set": {"_sync_status": "pending"}}
        )
        try:
            self.project(collection, document)
        except RedisError as error:
            logger.exception(
                "Redis projection failed collection=%s id=%s",
                collection, document["_id"],
            )
            raise SynchronizationError(collection, document["_id"]) from error
        self.storage.mongo[collection].update_one(
            {"_id": document["_id"]}, {"$set": {"_sync_status": "synced"}}
        )
        document["_sync_status"] = "synced"

    def resync(self) -> dict[str, int]:
        counts = {}
        for collection in ("species", "biomes", "players", "encounters"):
            count = 0
            for document in self.storage.mongo[collection].find():
                if collection in ("players", "encounters"):
                    self.synchronize(collection, document)
                else:
                    self.project(collection, document)
                count += 1
            counts[collection] = count
        logger.info("Redis resynchronization completed counts=%s", counts)
        return counts

    def save(
        self, collection: str, payload: Document, identifier: UUID | None
    ) -> Document:
        resource_id = str(identifier or uuid4())
        now = datetime.now(UTC)
        document = {
            **payload,
            "_id": resource_id,
            "created_at": now.replace(microsecond=(now.microsecond // 1000) * 1000),
            "_sync_status": "pending",
        }
        try:
            self.storage.mongo[collection].insert_one(document)
        except DuplicateKeyError:
            existing = self.storage.mongo[collection].find_one({"_id": resource_id})
            if existing is None:
                raise DomainError(
                    409, "username_exists", "Ce pseudo est deja utilise."
                ) from None
            existing_payload = {
                key: value for key, value in existing.items()
                if key not in ("_id", "created_at", "_sync_status")
            }
            if existing_payload != payload:
                raise DomainError(
                    409, "idempotency_conflict",
                    "Cet identifiant a deja ete utilise avec des donnees differentes.",
                ) from None
            document = existing
        self.synchronize(collection, document)
        return document

    def create_player(
        self, payload: PlayerCreate, identifier: UUID | None = None
    ) -> Player:
        data = payload.model_dump(mode="json", exclude_none=True)
        data["username_normalized"] = payload.username.lower()
        document = self.save("players", data, identifier)
        return Player.model_validate({**document, "id": document["_id"]})

    def create_encounter(
        self, payload: EncounterCreate, identifier: UUID | None = None
    ) -> Encounter:
        for collection, identifier_value in (
            ("players", str(payload.player_id)),
            ("species", payload.species_id),
            ("biomes", payload.location.biome_id),
        ):
            reference = self.storage.mongo[collection].find_one({"_id": identifier_value})
            if reference is None:
                raise DomainError(
                    422, "unknown_reference",
                    f"Reference inconnue : {collection}/{identifier_value}.",
                )
            if collection == "players" and reference["_sync_status"] == "pending":
                self.synchronize(collection, reference)
        document = self.save(
            "encounters", payload.model_dump(mode="json", exclude_none=True), identifier
        )
        return Encounter.model_validate({**document, "id": document["_id"]})

    def get(self, collection: str, identifier: UUID) -> Document:
        document = self.storage.mongo[collection].find_one({"_id": str(identifier)})
        if document is None:
            raise DomainError(404, "not_found", "Ressource introuvable.")
        return {**document, "id": document["_id"]}
