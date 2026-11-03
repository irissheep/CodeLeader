from fastapi import APIRouter as Router
from app.service.orders import create as create_order

router = Router(prefix="/orders")

@router.post("/")
async def submit():
    return create_order("order")

class Pretend:
    def get(self, path):
        return lambda function: function

fake = Pretend()
@fake.get("/not-a-fastapi-route")
def impostor():
    return "not an entry"
