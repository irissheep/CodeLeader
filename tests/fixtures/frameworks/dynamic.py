from fastapi import APIRouter
router = APIRouter(prefix=read_config())

@router.get("/items")
def items():
    return []
