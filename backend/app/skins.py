import base64
import binascii
import hashlib
import io
import json
import logging
import re
from typing import Literal
from uuid import UUID

import httpx
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ValidationError
from redis import Redis
from redis.exceptions import RedisError

from app.service import DomainError

logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 512 * 1024
CACHE_SECONDS = 3600


class SkinInfo(BaseModel):
    minecraft_uuid: UUID
    model: Literal["classic", "slim"]
    texture_url: str


class CachedSkin(BaseModel):
    model: Literal["classic", "slim"]
    png: str


class SkinService:
    def __init__(self, cache: Redis) -> None:
        self.cache = cache

    @staticmethod
    def download(client: httpx.Client, url: str, maximum: int) -> bytes:
        with client.stream("GET", url) as response:
            if response.status_code in (204, 404):
                raise DomainError(404, "skin_not_found", "Aucun skin trouve pour ce compte Minecraft.")
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes(chunk_size=8192):
                content.extend(chunk)
                if len(content) > maximum:
                    raise ValueError("Skin provider response exceeds size limit")
            return bytes(content)

    @staticmethod
    def validate_png(content: bytes) -> bytes:
        with Image.open(io.BytesIO(content)) as image:
            if image.format != "PNG" or image.size not in ((64, 32), (64, 64)):
                raise ValueError("Unsupported skin image format or dimensions")
            image.load()
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue()

    def resolve(self, identifier: UUID) -> tuple[SkinInfo, bytes]:
        key = f"skin-cache:{identifier}"
        try:
            cached = self.cache.get(key)
        except RedisError:
            logger.warning("Skin cache unavailable; requesting official provider", exc_info=True)
            cached = None
        if isinstance(cached, (str, bytes)):
            try:
                entry = CachedSkin.model_validate_json(cached)
                content = self.validate_png(base64.b64decode(entry.png, validate=True))
                return self.info(identifier, entry.model, content), content
            except (ValidationError, ValueError, binascii.Error, OSError):
                logger.warning("Invalid skin cache entry uuid=%s; refreshing", identifier, exc_info=True)

        try:
            with httpx.Client(timeout=httpx.Timeout(8, connect=3), follow_redirects=False) as client:
                raw_profile = self.download(
                    client,
                    f"https://sessionserver.mojang.com/session/minecraft/profile/{identifier.hex}",
                    64 * 1024,
                )
                profile = json.loads(raw_profile)
                if UUID(profile["id"]) != identifier:
                    raise ValueError("Profile UUID mismatch")
                properties = profile["properties"]
                encoded = next(
                    (item["value"] for item in properties if item["name"] == "textures"), None
                )
                if encoded is None:
                    raise DomainError(404, "skin_not_found", "Ce compte ne fournit pas de skin.")
                textures = json.loads(base64.b64decode(encoded, validate=True))["textures"]
                if "SKIN" not in textures:
                    raise DomainError(404, "skin_not_found", "Ce compte ne fournit pas de skin.")
                skin = textures["SKIN"]
                match = re.fullmatch(
                    r"https?://textures\.minecraft\.net/texture/([0-9a-f]{32,64})",
                    skin["url"],
                )
                if match is None:
                    raise ValueError("Untrusted skin texture URL")
                model = skin.get("metadata", {}).get("model", "classic")
                if model not in ("classic", "slim"):
                    raise ValueError("Unsupported skin model")
                content = self.validate_png(
                    self.download(
                        client,
                        f"https://textures.minecraft.net/texture/{match.group(1)}",
                        MAX_IMAGE_BYTES,
                    )
                )
                entry = CachedSkin(model=model, png=base64.b64encode(content).decode("ascii"))
        except httpx.HTTPError as error:
            logger.warning("Official skin provider unavailable uuid=%s", identifier, exc_info=True)
            raise DomainError(
                503, "skin_provider_unavailable",
                "Le service de skins est indisponible. Le profil reste utilisable.",
            ) from error
        except (
            ValueError, KeyError, TypeError, binascii.Error, UnidentifiedImageError,
            OSError, Image.DecompressionBombError,
        ) as error:
            logger.warning("Invalid official skin response uuid=%s", identifier, exc_info=True)
            raise DomainError(
                502, "invalid_skin_response", "Le service de skins a renvoye une reponse invalide."
            ) from error

        try:
            self.cache.set(key, entry.model_dump_json(), ex=CACHE_SECONDS)
        except RedisError:
            logger.warning("Skin cache write failed uuid=%s", identifier, exc_info=True)
        return self.info(identifier, entry.model, content), content

    @staticmethod
    def info(identifier: UUID, model: Literal["classic", "slim"], content: bytes) -> SkinInfo:
        revision = hashlib.sha256(content).hexdigest()[:16]
        return SkinInfo(
            minecraft_uuid=identifier,
            model=model,
            texture_url=f"/api/skins/{identifier}/texture?v={revision}",
        )
