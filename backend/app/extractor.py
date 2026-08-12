from __future__ import annotations

import csv
import io
import re
from pathlib import Path
from typing import Any

from .document_converter import convert_document


SUPPORTED = {
    ".pdf",
    ".xlsx",
    ".csv",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}


HEADER_MAP = {
    "employee name": "employee_name",
    "employee": "employee_name",
    "week start": "week_start",
    "week end": "week_end",
    "date": "date",
    "day": "day",
    "clock in": "clock_in",
    "time in": "clock_in",
    "clock out": "clock_out",
    "time out": "clock_out",
    "break": "break_minutes",
    "break minutes": "break_minutes",
    "regular hours": "regular_hours",
    "hours": "regular_hours",
    "overtime hours": "overtime_hours",
    "ot": "overtime_hours",
    "holiday hours": "holiday_hours",
    "on-call hours": "on_call_hours",
    "on call": "on_call_hours",
    "call-back hours": "call_back_hours",
    "call back": "call_back_hours",
    "callback": "call_back_hours",
}


def _num(value: Any) -> float:
    try:
        return float(
            str(value).strip() or 0
        )
    except Exception:
        return 0.0


def _break(value: Any) -> int:
    text = str(value).strip().lower()

    if not text:
        return 0

    # Support 0:30 style.
    time_match = re.fullmatch(
        r"(\d{1,2})\s*:\s*(\d{1,2})",
        text,
    )

    if time_match:
        hours = int(
            time_match.group(1)
        )

        minutes = int(
            time_match.group(2)
        )

        return (
            hours * 60
            + minutes
        )

    # Support "30 minutes", "30 min", etc.
    number_match = re.search(
        r"(\d+)",
        text,
    )

    if number_match:
        return int(
            number_match.group(1)
        )

    return 0


def _empty_result() -> dict[str, Any]:
    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": [],
        "warnings": [],
    }


# ============================================================
# CSV
# ============================================================

def extract_csv(
    data: bytes,
) -> dict[str, Any]:
    text = data.decode(
        "utf-8-sig",
        errors="replace",
    )

    reader = csv.DictReader(
        io.StringIO(text)
    )

    rows = []

    for raw in reader:
        normalized = {
            HEADER_MAP.get(
                (key or "").strip().lower(),
                (key or "").strip().lower(),
            ): value
            for key, value in raw.items()
        }

        rows.append(
            {
                "date": normalized.get(
                    "date",
                    "",
                ),
                "day": normalized.get(
                    "day",
                    "",
                ),
                "clock_in": normalized.get(
                    "clock_in",
                    "",
                ),
                "clock_out": normalized.get(
                    "clock_out",
                    "",
                ),
                "break_minutes": _break(
                    normalized.get(
                        "break_minutes",
                        0,
                    )
                ),
                "regular_hours": _num(
                    normalized.get(
                        "regular_hours",
                        0,
                    )
                ),
                "overtime_hours": _num(
                    normalized.get(
                        "overtime_hours",
                        0,
                    )
                ),
                "holiday_hours": _num(
                    normalized.get(
                        "holiday_hours",
                        0,
                    )
                ),
                "on_call_hours": _num(
                    normalized.get(
                        "on_call_hours",
                        0,
                    )
                ),
                "call_back_hours": _num(
                    normalized.get(
                        "call_back_hours",
                        0,
                    )
                ),
                "total_hours": 0.0,
            }
        )

    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": rows,
        "warnings": [],
        "document_mode": "structured",
    }


# ============================================================
# XLSX
# ============================================================

def extract_xlsx(
    data: bytes,
) -> dict[str, Any]:
    from openpyxl import load_workbook

    workbook = load_workbook(
        io.BytesIO(data),
        data_only=True,
    )

    worksheet = workbook.active

    values = list(
        worksheet.iter_rows(
            values_only=True
        )
    )

    if not values:
        result = _empty_result()

        result[
            "document_mode"
        ] = "structured"

        return result

    headers = [
        str(value or "")
        .strip()
        .lower()
        for value in values[0]
    ]

    keys = [
        HEADER_MAP.get(
            header,
            header,
        )
        for header in headers
    ]

    rows = []

    for values_row in values[1:]:
        if not any(
            value not in (
                None,
                "",
            )
            for value in values_row
        ):
            continue

        raw = dict(
            zip(
                keys,
                values_row,
            )
        )

        rows.append(
            {
                "date": str(
                    raw.get(
                        "date",
                        "",
                    )
                    or ""
                ),
                "day": str(
                    raw.get(
                        "day",
                        "",
                    )
                    or ""
                ),
                "clock_in": str(
                    raw.get(
                        "clock_in",
                        "",
                    )
                    or ""
                ),
                "clock_out": str(
                    raw.get(
                        "clock_out",
                        "",
                    )
                    or ""
                ),
                "break_minutes": _break(
                    raw.get(
                        "break_minutes",
                        0,
                    )
                ),
                "regular_hours": _num(
                    raw.get(
                        "regular_hours",
                        0,
                    )
                ),
                "overtime_hours": _num(
                    raw.get(
                        "overtime_hours",
                        0,
                    )
                ),
                "holiday_hours": _num(
                    raw.get(
                        "holiday_hours",
                        0,
                    )
                ),
                "on_call_hours": _num(
                    raw.get(
                        "on_call_hours",
                        0,
                    )
                ),
                "call_back_hours": _num(
                    raw.get(
                        "call_back_hours",
                        0,
                    )
                ),
                "total_hours": 0.0,
            }
        )

    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": rows,
        "warnings": [],
        "document_mode": "structured",
    }


# ============================================================
# PDF / IMAGE
# ============================================================

def extract_convertible_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    """
    Convert PDF/image documents into normalized PNG pages.

    OCR is intentionally not performed here.
    The frontend can OCR these normalized pages and then
    pass the extracted text through its universal parser.
    """

    converted = convert_document(
        filename,
        data,
    )

    pages = converted.get(
        "pages",
        [],
    )

    if not pages:
        raise ValueError(
            "The document was converted, but no pages were produced."
        )

    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": [],
        "warnings": [
            (
                "Document converted successfully. "
                "OCR is required to detect time entries."
            )
        ],
        "ocr_status": "conversion_complete",
        "document_mode": "converted",
        "filename": converted.get(
            "filename",
            filename,
        ),
        "page_count": converted.get(
            "page_count",
            len(pages),
        ),
        "pages": pages,
    }


# ============================================================
# MAIN ENTRY POINT
# ============================================================

def extract_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    extension = Path(
        filename or ""
    ).suffix.lower()

    if extension not in SUPPORTED:
        raise ValueError(
            (
                "Unsupported file type. "
                "Supported formats are PDF, CSV, XLSX, "
                "JPG, JPEG, PNG, WEBP, BMP, TIF, and TIFF."
            )
        )

    if not data:
        raise ValueError(
            "The uploaded file is empty."
        )

    if extension == ".csv":
        return extract_csv(
            data
        )

    if extension == ".xlsx":
        return extract_xlsx(
            data
        )

    if extension in {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
    }:
        return extract_convertible_document(
            filename,
            data,
        )

    raise ValueError(
        "Unsupported file type."
    )
