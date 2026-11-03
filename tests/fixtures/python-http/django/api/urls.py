from django.urls import path, include
from rest_framework.routers import SimpleRouter
from .views import status, read, RecordViewSet
router = SimpleRouter()
router.register("records", RecordViewSet, basename="record")
urlpatterns = [
    path("status/", status),
    path("numbers/<int:id>/", read),
    path("v2/", include(router.urls)),
]
