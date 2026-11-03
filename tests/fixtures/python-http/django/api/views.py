from rest_framework.decorators import api_view
from rest_framework.viewsets import ModelViewSet
@api_view(["GET", "POST"])
def status(request):
    return {}
@api_view(["GET"])
def read(request, id):
    return id
class RecordViewSet(ModelViewSet):
    pass
