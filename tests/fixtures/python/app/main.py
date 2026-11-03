from fastapi import FastAPI
from app.api.routes import router
from app.service.orders import create as create_order

app = FastAPI()
app.include_router(router, prefix="/api")

@app.get("/health")
async def health():
    return create_order("中文 🌱")

def dynamic(handler):
    return handler()

def outer():
    def same():
        return create_order("nested")
    return same()

def same():
    return "different symbol"
