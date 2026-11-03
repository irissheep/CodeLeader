from fastapi import APIRouter
router = APIRouter(prefix="/leaf", tags=["leaf"])
@router.get("/{id}")
def read(id):
    return id
