from collections.abc import Iterator

import fakeredis
import mongomock
import pytest
from fastapi.testclient import TestClient

from app.catalogs import BIOMES, SPECIES
from app.database import Storage
from app.main import create_app
from app.service import Journal


@pytest.fixture
def storage() -> Iterator[Storage]:
    mongo = mongomock.MongoClient(tz_aware=True)
    redis = fakeredis.FakeRedis(decode_responses=True)
    database = mongo["journal_tests"]
    database.players.create_index("username_normalized", unique=True)
    for name, entries in (("species", SPECIES), ("biomes", BIOMES)):
        database[name].insert_many([dict(entry) for entry in entries])
    connections = Storage(database, redis)
    Journal(connections).resync()
    yield connections
    redis.close()
    mongo.close()


@pytest.fixture
def client(storage: Storage) -> Iterator[TestClient]:
    with TestClient(create_app(storage)) as test_client:
        yield test_client
