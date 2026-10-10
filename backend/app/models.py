from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, StringConstraints, field_validator

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_]+$"
    ),
]
CatalogId = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")
]
ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
ProfileDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
EncounterDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlayerCreate(InputModel):
    username: Username
    description: ProfileDescription | None = None
    minecraft_uuid: UUID | None = None

    @field_validator("description", "minecraft_uuid", mode="before")
    @classmethod
    def empty_optional_field(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class Player(PlayerCreate):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    username_normalized: str
    created_at: datetime
    sync_status: Literal["pending", "synced"] = Field(
        validation_alias=AliasChoices("sync_status", "_sync_status")
    )


class EncounterType(StrEnum):
    OBSERVATION = "observation"
    APPROACH = "approach"
    FEEDING = "feeding"
    TAMING = "taming"


class Location(InputModel):
    biome_id: CatalogId
    label: ShortText | None = None

    @field_validator("label", mode="before")
    @classmethod
    def empty_label(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class EncounterCreate(InputModel):
    player_id: UUID
    species_id: CatalogId
    animal_nickname: ShortText | None = None
    location: Location
    encounter_type: EncounterType
    description: EncounterDescription

    @field_validator("animal_nickname", mode="before")
    @classmethod
    def empty_nickname(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class Encounter(EncounterCreate):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    created_at: datetime
    sync_status: Literal["pending", "synced"] = Field(
        validation_alias=AliasChoices("sync_status", "_sync_status")
    )


class CatalogEntry(BaseModel):
    id: str
    name: str
