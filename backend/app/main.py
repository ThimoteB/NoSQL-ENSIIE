import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError
from redis.exceptions import RedisError

from app.config import Settings
from app.database import Document, Storage, connect, initialize_schema
from app.models import (
    CatalogEntry,
    CatalogId,
    Encounter,
    EncounterCreate,
    EncounterType,
    Player,
    PlayerCreate,
)
from app.service import DomainError, Journal, SynchronizationError

logger = logging.getLogger(__name__)


def get_journal(request: Request) -> Journal:
    return request.app.state.journal


JournalDependency = Annotated[Journal, Depends(get_journal)]
IdempotencyKey = Annotated[UUID | None, Header(alias="Idempotency-Key")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


def create_app(storage: Storage | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        if storage is not None:
            application.state.journal = Journal(storage)
            yield
        else:
            with connect(Settings.from_environment()) as connections:
                initialize_schema(connections.mongo)
                application.state.journal = Journal(connections)
                application.state.journal.resync()
                logger.info("MongoDB and Redis initialized")
                yield

    application = FastAPI(
        title="Minecraft Encounter Journal",
        root_path="/api",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @application.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError) -> JSONResponse:
        logger.warning(
            "Request rejected method=%s path=%s code=%s",
            request.method, request.url.path, error.detail["code"],
        )
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @application.exception_handler(SynchronizationError)
    async def synchronization_error(
        request: Request, error: SynchronizationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "redis_sync_pending",
                    "message": "Donnee conservee dans MongoDB, synchronisation Redis incomplete.",
                    "persisted_in_mongodb": True,
                    "collection": error.collection,
                    "resource_id": error.identifier,
                }
            },
        )

    @application.exception_handler(PyMongoError)
    @application.exception_handler(RedisError)
    async def storage_error(request: Request, error: Exception) -> JSONResponse:
        logger.error(
            "Storage operation failed method=%s path=%s",
            request.method, request.url.path, exc_info=error,
        )
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "storage_unavailable",
                    "message": "Stockage indisponible. Reessayer avec la meme cle d'idempotence.",
                }
            },
        )

    @application.get("/health")
    def health(journal: JournalDependency) -> dict[str, str]:
        journal.storage.mongo.command("ping")
        journal.storage.redis.ping()
        return {"status": "ok"}

    @application.post("/players", response_model=Player, status_code=201)
    def create_player(
        payload: PlayerCreate, journal: JournalDependency,
        idempotency_key: IdempotencyKey = None,
    ) -> Player:
        return journal.create_player(payload, idempotency_key)

    @application.get("/players", response_model=list[Player])
    def players(
        journal: JournalDependency, limit: Limit = 50, offset: Offset = 0
    ) -> list[Document]:
        documents = (
            journal.storage.mongo.players.find()
            .sort([("username_normalized", 1), ("_id", 1)])
            .skip(offset).limit(limit)
        )
        return [{**document, "id": document["_id"]} for document in documents]

    @application.get("/players/{player_id}", response_model=Player)
    def player(player_id: UUID, journal: JournalDependency) -> Document:
        return journal.get("players", player_id)

    @application.get("/species", response_model=list[CatalogEntry])
    def species(journal: JournalDependency) -> list[dict[str, str]]:
        return [
            {"id": document["_id"], "name": document["name"]}
            for document in journal.storage.mongo.species.find().sort("_id", 1)
        ]

    @application.get("/biomes", response_model=list[CatalogEntry])
    def biomes(journal: JournalDependency) -> list[dict[str, str]]:
        return [
            {"id": document["_id"], "name": document["name"]}
            for document in journal.storage.mongo.biomes.find().sort("_id", 1)
        ]

    @application.get("/encounter-types", response_model=list[CatalogEntry])
    def encounter_types() -> list[dict[str, str]]:
        return [
            {"id": EncounterType.OBSERVATION, "name": "Observation"},
            {"id": EncounterType.APPROACH, "name": "Approche"},
            {"id": EncounterType.FEEDING, "name": "Nourrissage"},
            {"id": EncounterType.TAMING, "name": "Apprivoisement"},
        ]

    @application.post("/encounters", response_model=Encounter, status_code=201)
    def create_encounter(
        payload: EncounterCreate, journal: JournalDependency,
        idempotency_key: IdempotencyKey = None,
    ) -> Encounter:
        return journal.create_encounter(payload, idempotency_key)

    @application.get("/encounters", response_model=list[Encounter])
    def encounters(
        journal: JournalDependency,
        player_id: UUID | None = None,
        species_id: CatalogId | None = None,
        biome_id: CatalogId | None = None,
        limit: Limit = 50,
        offset: Offset = 0,
    ) -> list[Document]:
        filters: dict[str, str] = {}
        if player_id is not None:
            filters["player_id"] = str(player_id)
        if species_id is not None:
            filters["species_id"] = species_id
        if biome_id is not None:
            filters["location.biome_id"] = biome_id
        documents = (
            journal.storage.mongo.encounters.find(filters)
            .sort([("created_at", -1), ("_id", 1)])
            .skip(offset).limit(limit)
        )
        return [{**document, "id": document["_id"]} for document in documents]

    @application.get("/encounters/{encounter_id}", response_model=Encounter)
    def encounter(encounter_id: UUID, journal: JournalDependency) -> Document:
        return journal.get("encounters", encounter_id)

    return application


app = create_app()
