from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from redis.exceptions import ConnectionError

from app.config import Settings
from app.database import Storage, connect
from app.main import create_app


def test_settings_validate_environment_and_mask_secrets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MONGO_PASSWORD", "private")
    monkeypatch.setenv("MONGO_PORT", "27018")
    settings = Settings.from_environment()
    assert settings.mongo_port == 27018
    assert settings.mongo_password.get_secret_value() == "private"
    assert "private" not in repr(settings)
    monkeypatch.setenv("REDIS_PORT", "0")
    with pytest.raises(ValidationError):
        Settings.from_environment()


def test_connect_pings_and_closes_both_clients():
    with patch("app.database.MongoClient") as mongo, patch("app.database.Redis") as redis:
        mongo.__getitem__.return_value = mongo
        mongo_client = mongo.return_value.__enter__.return_value
        redis_client = redis.return_value.__enter__.return_value
        with connect(Settings()) as connections:
            assert connections.mongo is mongo_client.__getitem__.return_value
            assert connections.redis is redis_client
            mongo_client.admin.command.assert_called_once_with("ping")
            redis_client.ping.assert_called_once()
        redis.return_value.__exit__.assert_called_once()
        mongo.return_value.__exit__.assert_called_once()


def test_connect_cleans_up_when_a_storage_is_unavailable():
    with patch("app.database.MongoClient") as mongo, patch("app.database.Redis") as redis:
        mongo.__getitem__.return_value = mongo
        redis.return_value.__enter__.return_value.ping.side_effect = ConnectionError("offline")
        with pytest.raises(ConnectionError):
            with connect(Settings()):
                pytest.fail("Connection must fail rather than start with one database")
        redis.return_value.__exit__.assert_called_once()
        mongo.return_value.__exit__.assert_called_once()


def test_production_lifespan_initializes_and_resyncs(storage: Storage):
    events = []

    @contextmanager
    def connections(settings: Settings):
        events.append("open")
        yield storage
        events.append("close")

    with (
        patch("app.main.connect", connections),
        patch("app.main.initialize_schema") as initialize,
        patch("app.main.Journal.resync", return_value={}) as resync,
    ):
        with TestClient(create_app()) as client:
            initialize.assert_called_once_with(storage.mongo)
            resync.assert_called_once()
            assert client.get("/players").status_code == 200
        assert events == ["open", "close"]


def test_production_lifespan_refuses_to_start_when_resync_fails(storage: Storage):
    @contextmanager
    def connections(settings: Settings):
        yield storage

    with (
        patch("app.main.connect", connections),
        patch("app.main.initialize_schema"),
        patch("app.main.Journal.resync", side_effect=ConnectionError("offline")),
        pytest.raises(ConnectionError),
    ):
        with TestClient(create_app()):
            pytest.fail("A failed initial synchronization must not look healthy")
