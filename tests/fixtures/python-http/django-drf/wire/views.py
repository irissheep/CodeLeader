from rest_framework import generics, mixins, viewsets
from rest_framework.views import APIView
from rest_framework.decorators import action, api_view

class Plain(APIView):
    def get(self, request): return {}
    def post(self, request): return {}

class Limited(APIView):
    http_method_names = ["get"]
    def get(self, request): return {}
    def post(self, request): return {}

class Collection(generics.ListCreateAPIView): pass
class Item(generics.RetrieveUpdateDestroyAPIView): pass
class ListOnly(generics.ListAPIView): pass
class CreateOnly(generics.CreateAPIView): pass
class ReadOnly(generics.RetrieveAPIView): pass
class ChangeOnly(generics.UpdateAPIView): pass
class DropOnly(generics.DestroyAPIView): pass

class Partials(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    lookup_field = "slug"
    def destroy(self, request, slug): return {}
    @action(detail=True, methods=["post"], url_path="mark")
    def tag(self, request, slug): return {}
    @action(detail=False, methods=["get"], url_path=r"lookup/(?P<code>\w+)")
    def search(self, request): return {}

class Readers(viewsets.ReadOnlyModelViewSet): pass

@api_view(["GET", "POST"])
def function_view(request): return {}
