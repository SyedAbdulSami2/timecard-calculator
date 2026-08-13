from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import fitz


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
        "raw_text": "",
    }


# ============================================================
# NATIVE PDF TEXT
# ============================================================

def extract_native_pdf_text(
    data: bytes,
) -> str:
    """
    Read embedded text directly from a PDF.

    This is preferable to OCR when the PDF already contains
    selectable/machine-readable text.
    """

    try:
        document = fitz.open(
            stream=data,
            filetype="pdf",
        )

    except Exception as exc:
        raise ValueError(
            f"Could not open PDF: {exc}"
        ) from exc

    text_parts: list[str] = []

    try:
        for page_number in range(
            document.page_count
        ):
            page = document.load_page(
                page_number
            )

            text = page.get_text(
                "text"
            )

            if text:
                text_parts.append(
                    text
                )

    finally:
        document.close()

    return "\n".join(
        text_parts
    ).strip()


# ============================================================
# DETERMINE WHETHER PDF TEXT IS USEFUL
# ============================================================

def native_text_is_useful(
    text: str,
) -> bool:
    """
    Decide whether native PDF text is rich enough to parse
    as a timecard.

    We deliberately require more than just signatures,
    audit trails, or isolated metadata.
    """

    if not text:
        return False

    cleaned = re.sub(
        r"\s+",
        " ",
        text,
    ).strip()

    if len(cleaned) < 80:
        return False

    lower = cleaned.lower()

    timecard_keywords = [
        "time in",
        "time out",
        "clock in",
        "clock out",
        "hours",
        "date",
        "break",
        "lunch",
        "daily total",
        "regular hours",
        "total hours",
        "week ending",
    ]

    keyword_count = sum(
        1
        for keyword in timecard_keywords
        if keyword in lower
    )

    # At least a few timecard-related signals.
    if keyword_count < 2:
        return False

    # Look for time-like values.
    time_matches = re.findall(
        r"\b\d{1,2}[:.]\d{2}\b|\b\d{3,4}\b",
        cleaned,
    )

    if len(time_matches) < 2:
        return False

    return True


# ============================================================
# UNIVERSAL ENTRY POINT
# ============================================================

def extract_timecard_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    """
    Universal timecard extraction entry point.

    Current behavior:
    1. identify the file type,
    2. use native PDF text when available and useful,
    3. otherwise mark the document for OCR fallback.

    OCR and structured row parsing will be added next.
    """

    if not data:
        raise ValueError(
            "The uploaded file is empty."
        )

    result = empty_result()

    extension = Path(
        filename or ""
    ).suffix.lower()

    result["document_type"] = (
        extension.lstrip(".")
        if extension
        else ""
    )

    # --------------------------------------------------------
    # PDF
    # --------------------------------------------------------

    if extension == ".pdf":
        native_text = (
            extract_native_pdf_text(
                data
            )
        )

        result["raw_text"] = (
            native_text
        )

        if native_text_is_useful(
            native_text
        ):
            result[
                "extraction_method"
            ] = "native_pdf_text"

            result[
                "warnings"
            ].append(
                (
                    "Native PDF text was detected successfully. "
                    "Structured timecard parsing will be applied next."
                )
            )

            return result

        result[
            "extraction_method"
        ] = "ocr_required"

        result[
            "warnings"
        ].append(
            (
                "The PDF does not contain enough usable native text. "
                "OCR conversion is required."
            )
        )

        return result

    # --------------------------------------------------------
    # IMAGE / OTHER SUPPORTED DOCUMENTS
    # --------------------------------------------------------

    result[
        "extraction_method"
    ] = "ocr_required"

    result[
        "warnings"
    ].append(
        (
            "This document requires OCR-based extraction."
        )
    )

    return result
