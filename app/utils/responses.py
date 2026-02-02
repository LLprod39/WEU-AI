"""
Unified API response helpers.

Provides consistent response format across all endpoints:
{
    "success": bool,
    "data": any | null,
    "message": str | null,
    "error": str | null
}
"""
from typing import Any

from django.http import JsonResponse


def api_success(
    data: Any = None,
    message: str | None = None,
    status: int = 200,
) -> JsonResponse:
    """
    Return a successful API response.

    Args:
        data: Response payload (dict, list, or any JSON-serializable value)
        message: Optional success message
        status: HTTP status code (default 200)

    Returns:
        JsonResponse with success=True
    """
    response = {
        "success": True,
        "data": data,
        "message": message,
        "error": None,
    }
    return JsonResponse(response, status=status)


def api_error(
    error: str,
    status: int = 400,
    data: Any = None,
) -> JsonResponse:
    """
    Return an error API response.

    Args:
        error: Error message describing what went wrong
        status: HTTP status code (default 400)
        data: Optional additional error context

    Returns:
        JsonResponse with success=False
    """
    response = {
        "success": False,
        "data": data,
        "message": None,
        "error": error,
    }
    return JsonResponse(response, status=status)


def api_created(
    data: Any = None,
    message: str | None = None,
) -> JsonResponse:
    """Return 201 Created response."""
    return api_success(data=data, message=message, status=201)


def api_not_found(error: str = "Resource not found") -> JsonResponse:
    """Return 404 Not Found response."""
    return api_error(error=error, status=404)


def api_forbidden(error: str = "Access denied") -> JsonResponse:
    """Return 403 Forbidden response."""
    return api_error(error=error, status=403)


def api_unauthorized(error: str = "Authentication required") -> JsonResponse:
    """Return 401 Unauthorized response."""
    return api_error(error=error, status=401)


def api_validation_error(
    errors: dict[str, list[str]] | str,
) -> JsonResponse:
    """
    Return 422 Validation Error response.

    Args:
        errors: Field errors dict {"field": ["error1", "error2"]} or error string
    """
    if isinstance(errors, str):
        return api_error(error=errors, status=422)
    return api_error(error="Validation failed", data={"field_errors": errors}, status=422)


def api_server_error(error: str = "Internal server error") -> JsonResponse:
    """Return 500 Internal Server Error response."""
    return api_error(error=error, status=500)
