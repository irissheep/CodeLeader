from fastapi import FastAPI as Application, Request
from .types import AgentOne, AgentTwo

def create_app():
    async def lifespan(app):
        app.state.agent = AgentOne()
        yield
    app = Application(lifespan=lifespan)
    @app.post("/work")
    def work(request: Request):
        return request.app.state.agent.answer()
    @app.post("/index")
    def index(request: Request):
        return request.app.state.agent.store.index()
    @app.post("/delete")
    def delete(request: Request):
        return request.app.state.agent.store.delete()
    return app

def other_app(flag):
    async def lifespan(app):
        if flag:
            app.state.agent = AgentOne()
        else:
            app.state.agent = AgentTwo()
        yield
    app = Application(lifespan=lifespan)
    @app.post("/other")
    def work(request: Request):
        return request.app.state.agent.answer()
    @app.post("/work")
    def wrong_same_path(request: Request):
        return request.app.state.agent.answer()
    return app

def same_type(flag):
    async def lifespan(app):
        if flag:
            app.state.agent = AgentOne()
        else:
            app.state.agent = AgentOne()
        yield
    app = Application(lifespan=lifespan)
    @app.post("/same")
    def work(request: Request):
        return request.app.state.agent.answer()
    return app

app = create_app()
