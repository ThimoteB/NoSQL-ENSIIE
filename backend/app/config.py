import os

from pydantic import BaseModel, Field, SecretStr


class Settings(BaseModel):
    mongo_host: str = "mongodb"
    mongo_port: int = Field(default=27017, ge=1, le=65535)
    mongo_username: str = "nosql"
    mongo_password: SecretStr = SecretStr("local-mongo-password")
    mongo_database: str = Field(default="nosql", pattern=r"^[A-Za-z0-9_-]+$")
    mongo_auth_source: str = "admin"
    redis_host: str = "redis"
    redis_port: int = Field(default=6379, ge=1, le=65535)
    redis_password: SecretStr = SecretStr("local-redis-password")

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls.model_validate(
            {
                name: os.environ[name.upper()]
                for name in cls.model_fields
                if name.upper() in os.environ
            }
        )
