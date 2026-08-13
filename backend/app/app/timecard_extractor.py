from __future__ import annotations

from typing import Any


DAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]


def empty_week() -> list[dict[str, Any]]:
    return [
        {
            "day": day,
            "date": "",
            "segments": [],
            "break_minutes": 0,
            "on_call_hours": 0.0,
            "call_back_hours": 0.0,
            "printed_hours": None,
            "calculated_minutes": 0,
            "confidence": 0.0,
            "needs_review": False,
        }
        for day in DAYS
    ]


def empty_result() -> dict[str, Any]:
    return {
        "employee_name": "",
        "employee_id": "",
        "facility_name": "",
        "department": "",
        "week_start": "",
        "week_end": "",
        "rows": empty_week(),
        "warnings": [],
        "document_type": "",
        "extraction_method": "",
    }


def extract_timecard_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    """
    Universal timecard extraction entry point.

    Later this function will:
    1. detect the document type,
    2. try native PDF/table extraction,
    3. fall back to OCR,
    4. identify the timecard layout,
    5. normalize everything into Sunday-Saturday rows.
    """

    if not data:
        raise ValueError(
            "The uploaded file is empty."
        )

    result = empty_result()

    result["document_type"] = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    result["warnings"].append(
        "Universal extraction is initialized but document parsing has not been added yet."
    )

    return result
