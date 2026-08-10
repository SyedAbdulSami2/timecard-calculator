from __future__ import annotations

import base64
import csv
import io
import os
import re
from pathlib import Path
from typing import Any

from openai import OpenAI
from pydantic import BaseModel


SUPPORTED = {
    ".pdf",
    ".xlsx",
    ".csv",
    ".jpg",
    ".jpeg",
    ".png",
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


def _num(v: Any) -> float:
    try:
        return float(str(v).strip() or 0)
    except Exception:
        return 0.0


def _break(v: Any) -> int:
    s = str(v).strip().lower()

    m = re.search(r"(\d+)", s)

    return int(m.group(1)) if m else 0


def _empty_result():
    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": [],
        "warnings": [],
    }


def _normalize_row(
    *,
    date: str = "",
    day: str = "",
    clock_in: str = "",
    clock_out: str = "",
    break_minutes: int = 0,
    regular_hours: float = 0.0,
    overtime_hours: float = 0.0,
    holiday_hours: float = 0.0,
    on_call_hours: float = 0.0,
    call_back_hours: float = 0.0,
):
    return {
        "date": date,
        "day": day,
        "clock_in": clock_in,
        "clock_out": clock_out,
        "break_minutes": break_minutes,
        "regular_hours": regular_hours,
        "overtime_hours": overtime_hours,
        "holiday_hours": holiday_hours,
        "on_call_hours": on_call_hours,
        "call_back_hours": call_back_hours,
        "total_hours": 0.0,
    }


def extract_csv(data: bytes):
    text = data.decode(
        "utf-8-sig",
        errors="replace",
    )

    reader = csv.DictReader(
        io.StringIO(text)
    )

    rows = []

    employee_name = ""
    week_start = ""
    week_end = ""

    for raw in reader:
        normalized = {
            HEADER_MAP.get(
                (k or "").strip().lower(),
                (k or "").strip().lower(),
            ): v
            for k, v in raw.items()
        }

        if not employee_name:
            employee_name = str(
                normalized.get(
                    "employee_name",
                    "",
                )
                or ""
            ).strip()

        if not week_start:
            week_start = str(
                normalized.get(
                    "week_start",
                    "",
                )
                or ""
            ).strip()

        if not week_end:
            week_end = str(
                normalized.get(
                    "week_end",
                    "",
                )
                or ""
            ).strip()

        rows.append(
            _normalize_row(
                date=str(
                    normalized.get(
                        "date",
                        "",
                    )
                    or ""
                ),
                day=str(
                    normalized.get(
                        "day",
                        "",
                    )
                    or ""
                ),
                clock_in=str(
                    normalized.get(
                        "clock_in",
                        "",
                    )
                    or ""
                ),
                clock_out=str(
                    normalized.get(
                        "clock_out",
                        "",
                    )
                    or ""
                ),
                break_minutes=_break(
                    normalized.get(
                        "break_minutes",
                        0,
                    )
                ),
                regular_hours=_num(
                    normalized.get(
                        "regular_hours",
                        0,
                    )
                ),
                overtime_hours=_num(
                    normalized.get(
                        "overtime_hours",
                        0,
                    )
                ),
                holiday_hours=_num(
                    normalized.get(
                        "holiday_hours",
                        0,
                    )
                ),
                on_call_hours=_num(
                    normalized.get(
                        "on_call_hours",
                        0,
                    )
                ),
                call_back_hours=_num(
                    normalized.get(
                        "call_back_hours",
                        0,
                    )
                ),
            )
        )

    return {
        "employee_name": employee_name,
        "week_start": week_start,
        "week_end": week_end,
        "rows": rows,
        "warnings": [],
    }


def extract_xlsx(data: bytes):
    from openpyxl import load_workbook

    wb = load_workbook(
        io.BytesIO(data),
        data_only=True,
    )

    ws = wb.active

    values = list(
        ws.iter_rows(
            values_only=True
        )
    )

    if not values:
        return _empty_result()

    headers = [
        str(x or "")
        .strip()
        .lower()
        for x in values[0]
    ]

    keys = [
        HEADER_MAP.get(h, h)
        for h in headers
    ]

    rows = []

    employee_name = ""
    week_start = ""
    week_end = ""

    for vals in values[1:]:
        if not any(
            v not in (None, "")
            for v in vals
        ):
            continue

        raw = dict(zip(keys, vals))

        if not employee_name:
            employee_name = str(
                raw.get(
                    "employee_name",
                    "",
                )
                or ""
            ).strip()

        if not week_start:
            week_start = str(
                raw.get(
                    "week_start",
                    "",
                )
                or ""
            ).strip()

        if not week_end:
            week_end = str(
                raw.get(
                    "week_end",
                    "",
                )
                or ""
            ).strip()

        rows.append(
            _normalize_row(
                date=str(
                    raw.get(
                        "date",
                        "",
                    )
                    or ""
                ),
                day=str(
                    raw.get(
                        "day",
                        "",
                    )
                    or ""
                ),
                clock_in=str(
                    raw.get(
                        "clock_in",
                        "",
                    )
                    or ""
                ),
                clock_out=str(
                    raw.get(
                        "clock_out",
                        "",
                    )
                    or ""
                ),
                break_minutes=_break(
                    raw.get(
                        "break_minutes",
                        0,
                    )
                ),
                regular_hours=_num(
                    raw.get(
                        "regular_hours",
                        0,
                    )
                ),
                overtime_hours=_num(
                    raw.get(
                        "overtime_hours",
                        0,
                    )
                ),
                holiday_hours=_num(
                    raw.get(
                        "holiday_hours",
                        0,
                    )
                ),
                on_call_hours=_num(
                    raw.get(
                        "on_call_hours",
                        0,
                    )
                ),
                call_back_hours=_num(
                    raw.get(
                        "call_back_hours",
                        0,
                    )
                ),
            )
        )

    return {
        "employee_name": employee_name,
        "week_start": week_start,
        "week_end": week_end,
        "rows": rows,
        "warnings": [],
    }


class ExtractedRow(BaseModel):
    day: str = ""
    date: str = ""

    clock_in: str = ""
    clock_out: str = ""

    break_minutes: int = 0

    regular_hours: float = 0.0
    overtime_hours: float = 0.0
    holiday_hours: float = 0.0
    on_call_hours: float = 0.0
    call_back_hours: float = 0.0


class TimecardExtraction(BaseModel):
    employee_name: str = ""
    rows: list[ExtractedRow]
    warnings: list[str]


def extract_image_timecard(
    filename: str,
    data: bytes,
):
    api_key = os.getenv(
        "OPENAI_API_KEY"
    )

    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not configured."
        )

    ext = Path(
        filename
    ).suffix.lower()

    mime_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
    }.get(ext)

    if not mime_type:
        raise ValueError(
            "Image extraction supports JPG, JPEG and PNG."
        )

    encoded = base64.b64encode(
        data
    ).decode("utf-8")

    client = OpenAI(
        api_key=api_key
    )

    prompt = """
You are extracting data from an employee timecard image.

The image may be:
- photographed at an angle
- handwritten
- low contrast
- a hospital/facility timecard
- a different layout from previous timecards

Read the timecard carefully.

IMPORTANT RULES:

1. Do not guess unreadable handwriting.
2. If you are not confident about a value, return an empty string for that value.
3. Read the employee name if clearly visible.
4. Extract the employee's REGULAR work rows.
5. Do not accidentally use supervisor signature names as the employee name.
6. Ignore Call Back Hours, On Call Hours, Holiday Hours, or other special sections unless the value clearly belongs to the main work row.
7. Preserve AM/PM when visible.
8. If the timecard uses 24-hour times, preserve that format.
9. Do not calculate missing clock-in or clock-out values.
10. Do not invent break durations.
11. Day names should be Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, or Sunday when identifiable.
12. If the form has more than one time-in/time-out pair for a day, use the main regular-work pair only unless the form clearly indicates they are both part of the regular shift.
13. Empty/unworked days can be omitted.
14. Add a warning when handwriting is uncertain.

Return only the structured timecard information.
"""

    completion = (
        client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": (
                                    f"data:{mime_type};"
                                    f"base64,{encoded}"
                                )
                            },
                        },
                    ],
                }
            ],
            response_format=TimecardExtraction,
        )
    )

    message = (
        completion
        .choices[0]
        .message
    )

    if not message.parsed:
        raise ValueError(
            "The timecard could not be extracted."
        )

    result = message.parsed

    rows = []

    for item in result.rows:
        rows.append(
            _normalize_row(
                date=item.date.strip(),
                day=item.day.strip(),
                clock_in=item.clock_in.strip(),
                clock_out=item.clock_out.strip(),
                break_minutes=max(
                    0,
                    int(
                        item.break_minutes
                        or 0
                    ),
                ),
                regular_hours=max(
                    0.0,
                    float(
                        item.regular_hours
                        or 0
                    ),
                ),
                overtime_hours=max(
                    0.0,
                    float(
                        item.overtime_hours
                        or 0
                    ),
                ),
                holiday_hours=max(
                    0.0,
                    float(
                        item.holiday_hours
                        or 0
                    ),
                ),
                on_call_hours=max(
                    0.0,
                    float(
                        item.on_call_hours
                        or 0
                    ),
                ),
                call_back_hours=max(
                    0.0,
                    float(
                        item.call_back_hours
                        or 0
                    ),
                ),
            )
        )

    warnings = list(
        result.warnings
        or []
    )

    if not warnings:
        warnings = [
            (
                "Handwritten values were extracted. "
                "Please verify all entries before calculating."
            )
        ]

    return {
        "employee_name":
            result.employee_name.strip(),

        "week_start": "",
        "week_end": "",

        "rows": rows,

        "warnings": warnings,

        "ocr_status":
            "vision_review_required",
    }


def extract_document(
    filename: str,
    data: bytes,
):
    ext = Path(
        filename
    ).suffix.lower()

    if ext not in SUPPORTED:
        raise ValueError(
            "Unsupported file type"
        )

    if ext == ".csv":
        return extract_csv(
            data
        )

    if ext == ".xlsx":
        return extract_xlsx(
            data
        )

    if ext in {
        ".jpg",
        ".jpeg",
        ".png",
    }:
        return extract_image_timecard(
            filename,
            data,
        )

    if ext == ".pdf":
        return {
            "employee_name": "",
            "week_start": "",
            "week_end": "",
            "rows": [],
            "warnings": [
                (
                    "For handwritten timecards, "
                    "please upload the timecard page "
                    "as JPG or PNG for more reliable extraction."
                )
            ],
            "ocr_status":
                "image_upload_recommended",
        }

    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": [],
        "warnings": [
            (
                "We couldn't confidently read this timecard. "
                "Please enter or correct the information manually."
            )
        ],
        "ocr_status":
            "manual_review_required",
    }
