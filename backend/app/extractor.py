from __future__ import annotations

import csv
import io
import re
from pathlib import Path
from typing import Any


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


DAY_MAP = {
    "mon": "Monday",
    "monday": "Monday",
    "tue": "Tuesday",
    "tues": "Tuesday",
    "tuesday": "Tuesday",
    "wed": "Wednesday",
    "wednesday": "Wednesday",
    "thu": "Thursday",
    "thur": "Thursday",
    "thurs": "Thursday",
    "thursday": "Thursday",
    "fri": "Friday",
    "friday": "Friday",
    "sat": "Saturday",
    "saturday": "Saturday",
    "sun": "Sunday",
    "sunday": "Sunday",
}


def _num(value: Any) -> float:
    try:
        return float(str(value).strip() or 0)
    except Exception:
        return 0.0


def _break(value: Any) -> int:
    text = str(value).strip().lower()

    match = re.search(r"(\d+)", text)

    return int(match.group(1)) if match else 0


def _row(
    day: str = "",
    date: str = "",
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

    for raw in reader:
        normalized = {
            HEADER_MAP.get(
                (key or "").strip().lower(),
                (key or "").strip().lower(),
            ): value
            for key, value in raw.items()
        }

        rows.append(
            _row(
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
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": rows,
        "warnings": [],
    }


def extract_xlsx(data: bytes):
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
        return {
            "employee_name": "",
            "week_start": "",
            "week_end": "",
            "rows": [],
            "warnings": [],
        }

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
            value not in (None, "")
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
            _row(
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
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": rows,
        "warnings": [],
    }


def parse_mobile_ocr_text(text: str):
    """
    Parse OCR text from mobile timecard screenshots such as:

        Mon
        05
        06:48 - 19:31
        Daily total: 12.72

    This parser deliberately leaves uncertain fields blank.
    """

    normalized = (
        text.replace("\r", "\n")
        .replace("–", "-")
        .replace("—", "-")
    )

    lines = [
        line.strip()
        for line in normalized.splitlines()
        if line.strip()
    ]

    results = {
        day: _row(day=day)
        for day in [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]
    }

    time_range_pattern = re.compile(
        r"\b(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\b"
    )

    daily_total_pattern = re.compile(
        r"daily\s*total\s*:\s*(\d+(?:\.\d+)?)",
        re.IGNORECASE,
    )

    for index, line in enumerate(lines):
        day_match = re.search(
            r"\b("
            r"mon(?:day)?|"
            r"tue(?:s|sday)?|"
            r"wed(?:nesday)?|"
            r"thu(?:r|rs|rsday|ursday)?|"
            r"fri(?:day)?|"
            r"sat(?:urday)?|"
            r"sun(?:day)?"
            r")\b",
            line,
            re.IGNORECASE,
        )

        if not day_match:
            continue

        key = day_match.group(1).lower()

        day = DAY_MAP.get(key)

        if not day:
            continue

        # OCR often breaks one card into multiple lines.
        nearby = " ".join(
            lines[
                max(0, index - 1):
                min(len(lines), index + 8)
            ]
        )

        time_match = time_range_pattern.search(
            nearby
        )

        if time_match:
            results[day]["clock_in"] = (
                time_match.group(1)
            )

            results[day]["clock_out"] = (
                time_match.group(2)
            )

        total_match = daily_total_pattern.search(
            nearby
        )

        if total_match:
            results[day]["reported_hours"] = float(
                total_match.group(1)
            )

    rows = list(results.values())

    detected = [
        row
        for row in rows
        if row.get("clock_in")
        and row.get("clock_out")
    ]

    warnings = []

    if not detected:
        warnings.append(
            "No daily time ranges were confidently detected."
        )
    else:
        warnings.append(
            "OCR values were detected. Please review them before using the total."
        )

    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": rows,
        "warnings": warnings,
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

    # JPG/PNG/PDF OCR currently runs in the browser.
    return {
        "employee_name": "",
        "week_start": "",
        "week_end": "",
        "rows": [],
        "warnings": [
            "Image and PDF OCR is processed in the browser."
        ],
        "ocr_status":
            "browser_ocr_required",
    }
