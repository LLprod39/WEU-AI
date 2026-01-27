from django.urls import path
from . import views

app_name = 'passwords'

urlpatterns = [
    path('', views.password_list, name='password_list'),
    path('api/create/', views.credential_create, name='credential_create'),
    path('api/<int:credential_id>/decrypt/', views.credential_decrypt, name='credential_decrypt'),
    path('api/generate-password/', views.generate_password, name='generate_password'),
]
