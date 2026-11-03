from django.conf.urls import url, include
from django.urls import path
from rest_framework.routers import DefaultRouter, SimpleRouter
from . import views

app_name = "from_code"
router = DefaultRouter(trailing_slash=False)
router.register("rows", views.Partials, basename="row")
reader = SimpleRouter()
reader.register("readonly", views.Readers, basename="reader")
patterns = [
    path("view/", views.Plain.as_view()),
    path("limited/", views.Limited.as_view()),
    url(r"^collection/?$", views.Collection.as_view()),
    url(r"^detail/(?P<slug>(?:[-\w]+))/?$", views.Item.as_view()),
    url(r"^manual/(?P<slug>[-\w]+)/?$", views.Partials.as_view({"get": "retrieve", "delete": "destroy"})),
    path("list/", views.ListOnly.as_view()),
    path("create/", views.CreateOnly.as_view()),
    path("read/", views.ReadOnly.as_view()),
    path("change/", views.ChangeOnly.as_view()),
    path("drop/", views.DropOnly.as_view()),
    path("fn/", views.function_view),
    path("", include(router.urls)),
    path("", include(reader.urls)),
]
urlpatterns = patterns
