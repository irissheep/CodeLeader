from fastapi import APIRouter
from .leaf import router as child
PREFIX = "/mid"
router = APIRouter(prefix=PREFIX)
router.include_router(child, prefix="/nested")
