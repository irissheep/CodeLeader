from pydantic import Field
class BaseSettings:
    API_ROOT: str = "/svc"
class Settings(BaseSettings):
    ENV_PREFIX: str = Field(default_factory=lambda: "/not-evaluated")
settings = Settings()
