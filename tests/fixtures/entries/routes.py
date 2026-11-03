from fastapi import APIRouter as Router
router = Router(prefix="/v1")

@router.post("/go")
def go():
    return 1
