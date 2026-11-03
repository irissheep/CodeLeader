from flask import Flask, Blueprint
from catalog import bp
def create_app():
    app = Flask(__name__)
    app.register_blueprint(bp, url_prefix="/mounted")
    parent = Blueprint("parent", __name__, url_prefix="/unused")
    parent.register_blueprint(bp, url_prefix="/nested")
    app.register_blueprint(parent, url_prefix="/root")
    @app.route("/direct", methods=["GET", "POST"])
    def direct():
        return "ok"
    def home():
        return "ok"
    app.add_url_rule("/home", view_func=home)
    return app
def not_an_app(app):
    @app.get("/false-positive")
    def fake():
        return None
