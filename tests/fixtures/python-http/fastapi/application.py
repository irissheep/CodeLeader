import os
from fastapi import FastAPI, APIRouter
from routes import router
from settings import settings
app = FastAPI()
app.include_router(router, prefix=f"{settings.API_ROOT}/gate")
dynamic = APIRouter(prefix=os.getenv("HTTP_PREFIX"))
app.include_router(dynamic, prefix="/maybe")
@dynamic.get("/probe")
def probe():
    return None
def not_an_app(app):
    @app.get("/false-positive")
    def fake():
        return None
configured = APIRouter(prefix=settings.ENV_PREFIX)
@configured.get("/configured")
def configured_probe():
    return None
