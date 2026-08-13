from __future__ import annotations

import csv
import io
import os
import re
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .document_converter import convert_document
from .extractor import extract_document
from .timecard_extractor import extract_timecard_document


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="TimeCard Calculator API",
    version="3.0.0",
    description=(
        "API for converting timecards, automatically extracting "
        "time entries, calculating worked hours, and exporting results."
    ),
)


# ============================================================
# CORS
# ============================================================

frontend_origin = os.getenv(
    "FRONTEND_ORIGIN",
    "",
).strip()

allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

if frontend_origin:
    allowed_origins.append(
        frontend_origin
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROOT / HEALTH
# ============================================================

@app.get("/")
async def root():
    return {
        "name": "TimeCard Calculator API",
        "status": "running",
        "version": "3.0.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
    }


# ============================================================
# DOCUMENT CONVERTER
# ============================================================

@app.post("/convert-timecard")
async def convert_timecard(
    file: UploadFile = File(...)
):
    """
    Convert supported PDF/image timecards into normalized images.

    Supported:
    - PDF
    - JPG
    - JPEG
    - PNG
    - WEBP
    - BMP
    - TIFF
    - TIF
    """

    try:
        data = await file.read()

        if not data:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        result = convert_document(
            file.filename or "timecard",
            data,
        )

        return result

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        print(
            "Document conversion error:",
            repr(exc),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "The document could not be converted. "
                "Please try another copy or image."
            ),
        ) from exc


# ============================================================
# UNIVERSAL TIMECARD EXTRACTION
# ============================================================

@app.post("/extract-timecard")
async def extract_timecard_universal(
    file: UploadFile = File(...)
):
    """
    Universal timecard extraction endpoint.

    Current behavior:

    PDF:
    1. Tries native PDF text first.
    2. Parses machine-readable timecard rows.
    3. Returns OCR-required status when native extraction
       is not sufficient.

    Images/scans:
    - Returns OCR-required status.

    Backend OCR fallback will be connected in the next stage.
    """

    try:
        data = await file.read()

        if not data:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        result = extract_timecard_document(
            file.filename or "timecard",
            data,
        )

        return result

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        print(
            "Universal extraction error:",
            repr(exc),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "The timecard could not be extracted."
            ),
        ) from exc


# ============================================================
# ORIGINAL EXTRACTION ENDPOINT
# ============================================================

@app.post("/extract")
async def extract_timecard(
    file: UploadFile = File(...)
):
    """
    Legacy extraction endpoint.

    CSV/XLSX can be extracted directly.
    PDF/images can be converted by the document converter.

    The new /extract-timecard endpoint will eventually replace
    this workflow for automatic universal timecard reading.
    """

    try:
        data = await file.read()

        if not data:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        result = extract_document(
            file.filename or "timecard",
            data,
        )

        return result

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        print(
            "Extraction error:",
            repr(exc),
        )

        raise HTTPException(
            status_code=500,
            detail="Could not extract the timecard.",
        ) from exc


# ============================================================
# TIME HELPERS
# ============================================================

def normalize_time(
    value: Any,
) -> str:
    if value is None:
        return ""

    text = str(value).strip().upper()

    if not text:
        return ""

    text = text.replace(
        ".",
        ":",
    )

    text = re.sub(
        r"\s+",
        "",
        text,
    )

    # OCR corrections.
    text = re.sub(
        r"(?<=\d)[Oo](?=\d)",
        "0",
        text,
    )

    text = re.sub(
        r"(?<=\d)[Il](?=\d)",
        "1",
        text,
    )

    return text


def parse_time(
    value: Any,
) -> int | None:
    """
    Return minutes after midnight.

    Supports:
    - 6:40AM
    - 06:40
    - 18:40
    - 640
    - 1840
    """

    text = normalize_time(
        value
    )

    if not text:
        return None

    meridiem: str | None = None

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

    hour = 0
    minute = 0

    if ":" in text:
        parts = text.split(":")

        if len(parts) != 2:
            return None

        try:
            hour = int(
                parts[0]
            )

            minute = int(
                parts[1]
            )

        except ValueError:
            return None

    else:
        digits = re.sub(
            r"\D",
            "",
            text,
        )

        if len(digits) <= 2:
            try:
                hour = int(
                    digits
                )

                minute = 0

            except ValueError:
                return None

        elif len(digits) == 3:
            hour = int(
                digits[:1]
            )

            minute = int(
                digits[1:]
            )

        elif len(digits) == 4:
            hour = int(
                digits[:2]
            )

            minute = int(
                digits[2:]
            )

        else:
            return None

    if minute < 0 or minute > 59:
        return None

    if meridiem:
        if hour < 1 or hour > 12:
            return None

        if hour == 12:
            hour = 0

        if meridiem == "PM":
            hour += 12

    else:
        if hour < 0 or hour > 23:
            return None

    return (
        hour * 60
        + minute
    )


def worked_minutes(
    clock_in: Any,
    clock_out: Any,
    break_minutes: Any = 0,
) -> int:
    start = parse_time(
        clock_in
    )

    end = parse_time(
        clock_out
    )

    if start is None or end is None:
        return 0

    minutes = end - start

    # Overnight shift.
    if minutes < 0:
        minutes += 24 * 60

    try:
        break_value = int(
            float(
                break_minutes or 0
            )
        )

    except (
        TypeError,
        ValueError,
    ):
        break_value = 0

    minutes -= max(
        0,
        break_value,
    )

    return max(
        0,
        minutes,
    )


# ============================================================
# CALCULATE
# ============================================================

@app.post("/calculate")
async def calculate_timecard(
    payload: dict[str, Any],
):
    """
    Calculate work hours supplied by the frontend.

    Expected shape:

    {
        "timecard": {
            "rows": [...]
        },
        "overtime": {
            "mode": "none"
        }
    }
    """

    try:
        timecard = payload.get(
            "timecard",
            {},
        )

        source_rows = timecard.get(
            "rows",
            [],
        )

        if not isinstance(
            source_rows,
            list,
        ):
            raise HTTPException(
                status_code=400,
                detail="timecard.rows must be a list.",
            )

        overtime = payload.get(
            "overtime",
            {},
        )

        overtime_mode = overtime.get(
            "mode",
            "none",
        )

        try:
            daily_threshold = float(
                overtime.get(
                    "daily_threshold",
                    8,
                )
                or 8
            )

        except (
            TypeError,
            ValueError,
        ):
            daily_threshold = 8.0

        try:
            weekly_threshold = float(
                overtime.get(
                    "weekly_threshold",
                    40,
                )
                or 40
            )

        except (
            TypeError,
            ValueError,
        ):
            weekly_threshold = 40.0

        calculated_rows: list[
            dict[str, Any]
        ] = []

        weekly_regular_used = 0.0

        total_regular = 0.0
        total_overtime = 0.0
        total_hours = 0.0

        for row in source_rows:
            if not isinstance(
                row,
                dict,
            ):
                continue

            clock_in = (
                row.get(
                    "clock_in"
                )
                or row.get(
                    "start_time"
                )
                or ""
            )

            clock_out = (
                row.get(
                    "clock_out"
                )
                or row.get(
                    "end_time"
                )
                or ""
            )

            break_minutes = (
                row.get(
                    "break_minutes",
                    0,
                )
                or 0
            )

            minutes = worked_minutes(
                clock_in,
                clock_out,
                break_minutes,
            )

            hours = (
                minutes / 60
            )

            regular_hours = hours
            overtime_hours = 0.0

            if overtime_mode == "daily":
                regular_hours = min(
                    hours,
                    daily_threshold,
                )

                overtime_hours = max(
                    0,
                    hours
                    - daily_threshold,
                )

            elif overtime_mode in (
                "weekly",
                "custom",
            ):
                remaining_regular = max(
                    0,
                    weekly_threshold
                    - weekly_regular_used,
                )

                regular_hours = min(
                    hours,
                    remaining_regular,
                )

                overtime_hours = max(
                    0,
                    hours
                    - remaining_regular,
                )

                weekly_regular_used += (
                    regular_hours
                )

            regular_hours = round(
                regular_hours,
                4,
            )

            overtime_hours = round(
                overtime_hours,
                4,
            )

            total_row_hours = round(
                regular_hours
                + overtime_hours,
                4,
            )

            calculated_row = {
                **row,
                "regular_hours":
                    regular_hours,
                "overtime_hours":
                    overtime_hours,
                "total_hours":
                    total_row_hours,
                "worked_minutes":
                    minutes,
            }

            calculated_rows.append(
                calculated_row
            )

            total_regular += (
                regular_hours
            )

            total_overtime += (
                overtime_hours
            )

            total_hours += (
                total_row_hours
            )

        summary = {
            "regular_hours": round(
                total_regular,
                2,
            ),
            "overtime_hours": round(
                total_overtime,
                2,
            ),
            "total_hours": round(
                total_hours,
                2,
            ),
        }

        return {
            "rows":
                calculated_rows,
            "summary":
                summary,
        }

    except HTTPException:
        raise

    except Exception as exc:
        print(
            "Calculation error:",
            repr(exc),
        )

        raise HTTPException(
            status_code=500,
            detail="Could not calculate hours.",
        ) from exc


# ============================================================
# CSV EXPORT
# ============================================================

@app.post("/export/csv")
async def export_csv(
    payload: dict[str, Any],
):
    try:
        timecard = payload.get(
            "timecard",
            {},
        )

        rows = timecard.get(
            "rows",
            [],
        )

        if not isinstance(
            rows,
            list,
        ):
            raise HTTPException(
                status_code=400,
                detail="timecard.rows must be a list.",
            )

        output = io.StringIO()

        writer = csv.writer(
            output
        )

        writer.writerow(
            [
                "Day / Shift",
                "Clock In",
                "Clock Out",
                "Break Minutes",
                "Hours",
            ]
        )

        total = 0.0

        for index, row in enumerate(
            rows
        ):
            if not isinstance(
                row,
                dict,
            ):
                continue

            label = (
                row.get(
                    "label"
                )
                or row.get(
                    "day"
                )
                or row.get(
                    "date"
                )
                or f"Shift {index + 1}"
            )

            clock_in = (
                row.get(
                    "clock_in"
                )
                or ""
            )

            clock_out = (
                row.get(
                    "clock_out"
                )
                or ""
            )

            break_minutes = (
                row.get(
                    "break_minutes",
                    0,
                )
                or 0
            )

            minutes = worked_minutes(
                clock_in,
                clock_out,
                break_minutes,
            )

            hours = round(
                minutes / 60,
                2,
            )

            total += hours

            writer.writerow(
                [
                    label,
                    clock_in,
                    clock_out,
                    break_minutes,
                    f"{hours:.2f}",
                ]
            )

        writer.writerow(
            []
        )

        writer.writerow(
            [
                "",
                "",
                "",
                "Total Hours",
                f"{total:.2f}",
            ]
        )

        content = output.getvalue()

        output.close()

        response = StreamingResponse(
            iter(
                [content]
            ),
            media_type="text/csv",
        )

        response.headers[
            "Content-Disposition"
        ] = (
            'attachment; filename="timecard-summary.csv"'
        )

        return response

    except HTTPException:
        raise

    except Exception as exc:
        print(
            "CSV export error:",
            repr(exc),
        )

        raise HTTPException(
            status_code=500,
            detail="Could not export CSV.",
        ) from exc
