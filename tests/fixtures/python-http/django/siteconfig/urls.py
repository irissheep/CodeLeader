from django.urls import path, re_path, include
from api.views import status
urlpatterns = [
    path("api/", include("api.urls")),
    re_path(r"^legacy/(?P<id>\d+)/$", status),
]
