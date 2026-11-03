from django.conf.urls import url as legacy_url, include as legacy_include
from django.urls import path, include
from wire.urls import patterns, app_name

INSTANCE = "edge"
urlpatterns = [
    legacy_url(r"^old/", legacy_include("wire.urls", namespace=INSTANCE)),
    path("tuple/", include((patterns, app_name), namespace="inline")),
    path("named/", include("wire.urls")),
]
