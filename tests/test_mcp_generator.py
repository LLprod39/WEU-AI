import pytest
from skills.mcp_generator import _extract_output_text

def test_extract_output_text_success():
    """Test happy path: successfully extracts text from a valid payload."""
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": "Extracted text"}
                    ]
                }
            }
        ]
    }
    assert _extract_output_text(payload) == "Extracted text"

def test_extract_output_text_missing_candidates():
    """Test KeyError: 'candidates' key is missing."""
    payload = {"other_key": "value"}
    assert _extract_output_text(payload) == ""

def test_extract_output_text_empty_candidates():
    """Test IndexError: 'candidates' list is empty."""
    payload = {"candidates": []}
    assert _extract_output_text(payload) == ""

def test_extract_output_text_missing_content():
    """Test KeyError: 'content' key is missing inside candidate."""
    payload = {
        "candidates": [
            {"other_key": "value"}
        ]
    }
    assert _extract_output_text(payload) == ""

def test_extract_output_text_missing_parts():
    """Test KeyError: 'parts' key is missing inside content."""
    payload = {
        "candidates": [
            {
                "content": {"other_key": "value"}
            }
        ]
    }
    assert _extract_output_text(payload) == ""

def test_extract_output_text_empty_parts():
    """Test IndexError: 'parts' list is empty."""
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": []
                }
            }
        ]
    }
    assert _extract_output_text(payload) == ""

def test_extract_output_text_missing_text():
    """Test KeyError: 'text' key is missing inside part."""
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"other_key": "value"}
                    ]
                }
            }
        ]
    }
    assert _extract_output_text(payload) == ""

def test_extract_output_text_type_error():
    """Test TypeError: structures are not of the expected dict/list types."""
    payload = {
        "candidates": "this is a string, not a list"
    }
    assert _extract_output_text(payload) == ""

    payload2 = {
        "candidates": [
            "this is a string, not a dict"
        ]
    }
    assert _extract_output_text(payload2) == ""
