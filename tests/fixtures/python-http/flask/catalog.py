from flask import Blueprint
from flask.views import MethodView
bp = Blueprint("catalog", __name__, url_prefix="/construct")
@bp.route("/items", methods=["GET", "POST"])
def items():
    return {}
@bp.patch("/items/<int:id>")
def edit(id):
    return id
class ItemView(MethodView):
    def get(self):
        return []
    def post(self):
        return {}
bp.add_url_rule("/view", view_func=ItemView.as_view("items"))
