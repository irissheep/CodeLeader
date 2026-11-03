from fastapi import FastAPI as Application
from .routes import router as imported_router

app = Application()
@app.get("/outer")
def outer():
    return 1

def create_app():
    app = Application(
        title="factory"
    )
    app.include_router(imported_router, prefix="/mount")

    @app.get(
        "/inside"
    )
    def health():
        return 1
    return app

def fake_factory(app):
    @app.get("/not-framework")
    def fake():
        return 0

def shadow_constructor(Application):
    app = Application()
    @app.post("/not-fastapi")
    def fake_constructor():
        return 0

def overwritten():
    app = Application()
    app = object()
    @app.get("/overwritten")
    def fake_assignment():
        return 0

if __name__ == "__main__":
    create_app()
