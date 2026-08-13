from __future__ import annotations

import re
from datetime import datetime
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


# ============================================================
# EMPTY RESULT
# ============================================================

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
# NATIVE TEXT QUALITY CHECK
# ============================================================

def native_text_is_useful(
    text: str,
) -> bool:
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

    if keyword_count < 2:
        return False

    time_matches = re.findall(
        r"\b\d{1,2}[:.]\d{2}\b|\b\d{3,4}\b",
        cleaned,
    )

    if len(time_matches) < 2:
        return False

    return True


# ============================================================
# TIME HELPERS
# ============================================================

def normalize_time(
    value: str,
) -> str:
    text = (
        str(value or "")
        .strip()
        .upper()
        .replace(".", ":")
    )

    text = re.sub(
        r"\s+",
        "",
        text,
    )

    if re.fullmatch(
        r"\d{3}",
        text,
    ):
        text = (
            text[:1]
            + ":"
            + text[1:]
        )

    elif re.fullmatch(
        r"\d{4}",
        text,
    ):
        text = (
            text[:2]
            + ":"
            + text[2:]
        )

    return text


def parse_time(
    value: str,
) -> int | None:
    text = normalize_time(
        value
    )

    if not text:
        return None

    meridiem = ""

    match = re.search(
        r"(AM|PM)$",
        text,
    )

    if match:
        meridiem = match.group(1)

        text = re.sub(
            r"(AM|PM)$",
            "",
            text,
        )

    match = re.fullmatch(
        r"(\d{1,2}):(\d{2})",
        text,
    )

    if not match:
        return None

    hour = int(
        match.group(1)
    )

    minute = int(
        match.group(2)
    )

    if minute > 59:
        return None

    if meridiem:
        if hour < 1 or hour > 12:
            return None

        if hour == 12:
            hour = 0

        if meridiem == "PM":
            hour += 12

    else:
        if hour > 23:
            return None

    return (
        hour * 60
        + minute
    )


def worked_minutes(
    start: str,
    end: str,
) -> int:
    start_minutes = parse_time(
        start
    )

    end_minutes = parse_time(
        end
    )

    if (
        start_minutes is None
        or end_minutes is None
    ):
        return 0

    duration = (
        end_minutes
        - start_minutes
    )

    if duration < 0:
        duration += 24 * 60

    return max(
        0,
        duration,
    )


# ============================================================
# DATE HELPERS
# ============================================================

def normalize_day(
    value: str,
) -> str | None:
    text = (
        value
        .strip()
        .lower()
    )

    mapping = {
        "sun": "Sunday",
        "mon": "Monday",
        "tue": "Tuesday",
        "wed": "Wednesday",
        "thu": "Thursday",
        "fri": "Friday",
        "sat": "Saturday",
    }

    for prefix, day in mapping.items():
        if text.startswith(
            prefix
        ):
            return day

    return None


def weekday_from_date(
    value: str,
) -> str | None:
    text = value.strip()

    formats = [
        "%m/%d/%Y",
        "%m/%d/%y",
        "%m-%d-%Y",
        "%m-%d-%y",
    ]

    for format_string in formats:
        try:
            parsed = datetime.strptime(
                text,
                format_string,
            )

            return parsed.strftime(
                "%A"
            )

        except ValueError:
            continue

    return None


# ============================================================
# FIND TIME VALUES
# ============================================================

def find_times(
    text: str,
) -> list[str]:
    patterns = re.findall(
        (
            r"\b"
            r"(?:"
            r"\d{1,2}:\d{2}\s*(?:AM|PM)?"
            r"|"
            r"\d{3,4}\s*(?:AM|PM)?"
            r")"
            r"\b"
        ),
        text,
        flags=re.IGNORECASE,
    )

    result: list[str] = []

    for value in patterns:
        normalized = normalize_time(
            value
        )

        if parse_time(
            normalized
        ) is not None:
            result.append(
                normalized
            )

    return result


# ============================================================
# PRINTED HOURS
# ============================================================

def find_printed_hours(
    text: str,
) -> float | None:
    patterns = [
        r"daily\s*total\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)",
        r"total\s*reg(?:ular)?\s*hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)",
        r"hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)",
    ]

    for pattern in patterns:
        match = re.search(
            pattern,
            text,
            flags=re.IGNORECASE,
        )

        if not match:
            continue

        value = float(
            match.group(1)
        )

        if 0 <= value <= 24:
            return value

    return None


# ============================================================
# ROW CREATION
# ============================================================

def create_row(
    day: str,
    date: str,
    times: list[str],
    printed_hours: float | None,
) -> dict[str, Any] | None:
    if len(times) < 2:
        return None

    segments = []

    total_minutes = 0

    # Pair times in order:
    # 09:00, 12:00, 12:30, 17:30
    # becomes two work segments.
    for index in range(
        0,
        len(times) - 1,
        2,
    ):
        clock_in = times[index]
        clock_out = times[index + 1]

        minutes = worked_minutes(
            clock_in,
            clock_out,
        )

        if minutes <= 0:
            continue

        # Reject obviously invalid 20+ hour pairs.
        if minutes > 20 * 60:
            continue

        segments.append(
            {
                "clock_in": clock_in,
                "clock_out": clock_out,
            }
        )

        total_minutes += minutes

    if not segments:
        return None

    calculated_hours = (
        total_minutes / 60
    )

    needs_review = False

    if printed_hours is not None:
        needs_review = (
            abs(
                calculated_hours
                - printed_hours
            )
            > 0.25
        )

    confidence = (
        0.95
        if not needs_review
        else 0.70
    )

    return {
        "day": day,
        "date": date,
        "segments": segments,
        "break_minutes": 0,
        "on_call_hours": 0.0,
        "call_back_hours": 0.0,
        "printed_hours": printed_hours,
        "calculated_minutes": total_minutes,
        "confidence": confidence,
        "needs_review": needs_review,
    }


# ============================================================
# NATIVE PDF STRUCTURED PARSER
# ============================================================

def parse_native_timecard_text(
    text: str,
) -> list[dict[str, Any]]:
    """
    Generic native-PDF row parser.

    Handles lines/blocks containing combinations such as:

    Mon 06/08/26 1030 1330 3

    Tuesday 2/14/23
    1:50 AM
    10:35 AM
    8.75

    Monday
    9:00AM 12:00PM 12:30PM 5:30PM
    8.0
    """

    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    detected_rows: list[
        dict[str, Any]
    ] = []

    for index in range(
        len(lines)
    ):
        block = " ".join(
            lines[
                index:
                index + 8
            ]
        )

        day_match = re.search(
            (
                r"\b"
                r"(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|"
                r"Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)"
                r"\b"
            ),
            block,
            flags=re.IGNORECASE,
        )

        date_match = re.search(
            r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
            block,
        )

        day = None
        date = ""

        if day_match:
            day = normalize_day(
                day_match.group(1)
            )

        if date_match:
            date = (
                date_match.group(0)
            )

            if not day:
                day = weekday_from_date(
                    date
                )

        if not day:
            continue

        times = find_times(
            block
        )

        if len(times) < 2:
            continue

        printed_hours = (
            find_printed_hours(
                block
            )
        )

        row = create_row(
            day=day,
            date=date,
            times=times,
            printed_hours=printed_hours,
        )

        if not row:
            continue

        duplicate = any(
            existing["day"]
            == row["day"]
            and existing[
                "segments"
            ]
            == row["segments"]
            for existing in detected_rows
        )

        if duplicate:
            continue

        detected_rows.append(
            row
        )

    return detected_rows


# ============================================================
# MAP TO SUNDAY-SATURDAY
# ============================================================

def build_week(
    detected_rows: list[
        dict[str, Any]
    ],
) -> list[dict[str, Any]]:
    week = empty_week()

    for row in detected_rows:
        day = row.get(
            "day",
            "",
        )

        if day not in DAYS:
            continue

        index = DAYS.index(
            day
        )

        existing = (
            week[index]
        )

        # Prefer row with more detected segments.
        if (
            len(
                row.get(
                    "segments",
                    [],
                )
            )
            >= len(
                existing.get(
                    "segments",
                    [],
                )
            )
        ):
            week[index] = row

    return week


# ============================================================
# UNIVERSAL ENTRY POINT
# ============================================================

def extract_timecard_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    if not data:
        raise ValueError(
            "The uploaded file is empty."
        )

    result = empty_result()

    extension = Path(
        filename or ""
    ).suffix.lower()

    result[
        "document_type"
    ] = (
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

        result[
            "raw_text"
        ] = native_text

        if native_text_is_useful(
            native_text
        ):
            detected_rows = (
                parse_native_timecard_text(
                    native_text
                )
            )

            result[
                "extraction_method"
            ] = "native_pdf_text"

            result[
                "rows"
            ] = build_week(
                detected_rows
            )

            detected_count = sum(
                1
                for row in result["rows"]
                if row["segments"]
            )

            if detected_count:
                result[
                    "warnings"
                ].append(
                    (
                        f"{detected_count} workday(s) "
                        "were parsed from native PDF text."
                    )
                )

            else:
                result[
                    "warnings"
                ].append(
                    (
                        "Native PDF text was available, "
                        "but structured work rows could not "
                        "be identified. OCR fallback is required."
                    )
                )

                result[
                    "extraction_method"
                ] = "ocr_required"

            return result

        result[
            "extraction_method"
        ] = "ocr_required"

        result[
            "warnings"
        ].append(
            (
                "The PDF does not contain enough usable "
                "native text. OCR conversion is required."
            )
        )

        return result

    # --------------------------------------------------------
    # IMAGE / SCAN
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
