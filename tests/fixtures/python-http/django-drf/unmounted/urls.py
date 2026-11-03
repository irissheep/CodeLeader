from django.urls import path
from wire.views import function_view
urlpatterns = [path("not-mounted/", function_view)]
