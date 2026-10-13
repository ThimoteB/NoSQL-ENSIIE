import base64
import io
import json
from unittest.mock import patch
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from redis.exceptions import ConnectionError

from app.database import Storage
from app.skins import CACHE_SECONDS, MAX_IMAGE_BYTES

IDENTIFIER = UUID("069a79f4-44e9-4726-a5be-fca90e38aaf5")
TEXTURE = "https://textures.minecraft.net/texture/" + "a" * 64


def png(size: tuple[int, int] = (64, 64)) -> bytes:
    result = io.BytesIO()
    Image.new("RGBA", size, (80, 110, 65, 255)).save(result, format="PNG")
    return result.getvalue()


def profile(model: str = "classic", url: str = TEXTURE) -> dict:
    skin = {"url": url}
    if model != "classic":
        skin["metadata"] = {"model": model}
    textures = base64.b64encode(json.dumps({"textures": {"SKIN": skin}}).encode()).decode()
    return {"id": IDENTIFIER.hex, "properties": [{"name": "textures", "value": textures}]}


def provider(handler):
    return patch("app.skins.httpx.Client", return_value=httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.mark.parametrize("model,size", [("classic", (64, 32)), ("classic", (64, 64)), ("slim", (64, 64))])
def test_skin_metadata_png_and_cache(client: TestClient, storage: Storage, model: str, size: tuple[int, int]):
    calls = []

    def handler(request: httpx.Request):
        calls.append(str(request.url))
        if request.url.host == "sessionserver.mojang.com":
            return httpx.Response(200, json=profile(model, TEXTURE.replace("https:", "http:")))
        assert str(request.url) == TEXTURE
        return httpx.Response(200, content=png(size))

    with provider(handler):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == 200, response.text
    info = response.json()
    assert info["minecraft_uuid"] == str(IDENTIFIER)
    assert info["model"] == model
    assert info["texture_url"].startswith(f"/api/skins/{IDENTIFIER}/texture?v=")
    assert len(calls) == 2
    assert 0 < storage.redis.ttl(f"skin-cache:{IDENTIFIER}") <= CACHE_SECONDS
    with patch("app.skins.httpx.Client", side_effect=AssertionError("Cache must avoid another download")):
        texture = client.get(info["texture_url"])
    assert texture.status_code == 200
    assert texture.headers["content-type"] == "image/png"
    assert texture.headers["x-content-type-options"] == "nosniff"
    assert "max-age=3600" in texture.headers["cache-control"]
    assert Image.open(io.BytesIO(texture.content)).size == size
    assert storage.mongo.players.count_documents({}) == 0


@pytest.mark.parametrize("status,expected,code", [
    (204, 404, "skin_not_found"), (404, 404, "skin_not_found"),
    (429, 503, "skin_provider_unavailable"), (500, 503, "skin_provider_unavailable"),
    (302, 503, "skin_provider_unavailable"),
])
def test_provider_errors_are_explicit(client: TestClient, status: int, expected: int, code: str):
    with provider(lambda request: httpx.Response(status)):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == expected
    assert response.json()["detail"]["code"] == code


@pytest.mark.parametrize("url", [
    "http://localhost/image.png",
    "https://textures.minecraft.net.evil.test/texture/" + "a" * 64,
    "https://textures.minecraft.net/texture/../../metadata",
    "https://user@textures.minecraft.net/texture/" + "a" * 64,
])
def test_untrusted_texture_destinations_are_never_fetched(client: TestClient, url: str):
    calls = []

    def handler(request: httpx.Request):
        calls.append(str(request.url))
        return httpx.Response(200, json=profile(url=url))

    with provider(handler):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "invalid_skin_response"
    assert len(calls) == 1


@pytest.mark.parametrize("body", [b"not a png", png((128, 128)), b"x" * (MAX_IMAGE_BYTES + 1)])
def test_invalid_or_oversized_images_are_rejected(client: TestClient, body: bytes):
    def handler(request: httpx.Request):
        return httpx.Response(200, json=profile()) if request.url.host == "sessionserver.mojang.com" else httpx.Response(200, content=body)

    with provider(handler):
        response = client.get(f"/skins/{IDENTIFIER}/texture")
    assert response.status_code == 502


def test_timeout_and_invalid_uuid(client: TestClient):
    def handler(request: httpx.Request):
        raise httpx.ReadTimeout("timed out")

    with provider(handler):
        assert client.get(f"/skins/{IDENTIFIER}").status_code == 503
        assert client.get("/skins/not-a-uuid").status_code == 422
        assert client.get("/skins/not-a-uuid/texture").status_code == 422


def test_corrupted_cache_is_refreshed(client: TestClient, storage: Storage):
    storage.redis.set(f"skin-cache:{IDENTIFIER}", "not-json")

    def handler(request: httpx.Request):
        return httpx.Response(200, json=profile()) if request.url.host == "sessionserver.mojang.com" else httpx.Response(200, content=png())

    with provider(handler):
        assert client.get(f"/skins/{IDENTIFIER}").status_code == 200
    assert storage.redis.ttl(f"skin-cache:{IDENTIFIER}") > 0


def test_cache_outage_does_not_prevent_skin_display(client: TestClient, storage: Storage):
    def handler(request: httpx.Request):
        return httpx.Response(200, json=profile()) if request.url.host == "sessionserver.mojang.com" else httpx.Response(200, content=png())

    with (
        provider(handler),
        patch.object(storage.redis, "get", side_effect=ConnectionError("offline")),
        patch.object(storage.redis, "set", side_effect=ConnectionError("offline")),
    ):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == 200


@pytest.mark.parametrize("payload", [
    {"id": "00000000000000000000000000000000", "properties": []},
    {"id": IDENTIFIER.hex, "properties": [{"name": "textures", "value": "bad base64!"}]},
    profile(model="unsupported"),
])
def test_malformed_profile(client: TestClient, payload: dict):
    with provider(lambda request: httpx.Response(200, json=payload)):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == 502


def test_absent_skin(client: TestClient):
    with provider(lambda request: httpx.Response(200, json={"id": IDENTIFIER.hex, "properties": []})):
        response = client.get(f"/skins/{IDENTIFIER}")
    assert response.status_code == 404
