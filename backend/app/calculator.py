from __future__ import annotations
from datetime import datetime, timedelta
from typing import Iterable
from .models import TimeRow, CalculationRequest

FORMATS = ["%I:%M %p", "%I%M %p", "%H:%M", "%H%M"]


def parse_time(value: str) -> datetime | None:
    value = (value or "").strip().upper().replace(".", "")
    if not value:
        return None
    for fmt in FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    return None


def worked_hours(clock_in: str, clock_out: str, break_minutes: int = 0) -> float | None:
    start = parse_time(clock_in)
    end = parse_time(clock_out)
    if not start or not end:
        return None
    if end <= start:
        end += timedelta(days=1)
    hours = (end - start).total_seconds() / 3600 - max(0, break_minutes) / 60
    return round(max(0.0, hours), 2)


def calculate(req: CalculationRequest):
    rows = []
    raw_worked = []
    for row in req.timecard.rows:
        row = row.model_copy(deep=True)
        computed = worked_hours(row.clock_in, row.clock_out, row.break_minutes)
        if computed is None:
            row.warning = "Unable to confidently read this time. Please review and enter it manually."
            base = max(0.0, row.regular_hours)
        else:
            base = computed
            row.total_hours = computed
        raw_worked.append(base)
        rows.append(row)

    mode = req.overtime.mode
    if mode == "daily":
        for row, base in zip(rows, raw_worked):
            threshold = max(0.0, req.overtime.daily_threshold)
            row.regular_hours = round(min(base, threshold), 2)
            row.overtime_hours = round(max(0.0, base - threshold), 2)
    elif mode in ("weekly", "custom"):
        threshold = req.overtime.weekly_threshold if mode == "weekly" else req.overtime.custom_threshold
        remaining_regular = max(0.0, threshold)
        for row, base in zip(rows, raw_worked):
            regular = min(base, remaining_regular)
            overtime = max(0.0, base - regular)
            row.regular_hours = round(regular, 2)
            row.overtime_hours = round(overtime, 2)
            remaining_regular = max(0.0, remaining_regular - regular)
    else:
        for row, base in zip(rows, raw_worked):
            # Preserve explicit categorized hours if supplied; otherwise treat worked time as regular.
            if not any([row.regular_hours, row.overtime_hours, row.holiday_hours, row.on_call_hours, row.call_back_hours]):
                row.regular_hours = round(base, 2)

    regular = sum(r.regular_hours for r in rows)
    overtime = sum(r.overtime_hours for r in rows)
    holiday = sum(r.holiday_hours for r in rows)
    on_call = sum(r.on_call_hours for r in rows)
    call_back = sum(r.call_back_hours for r in rows)

    # Prevent double counting when categories are known to overlap regular worked hours.
    total = regular + overtime
    total += 0 if req.holiday_in_regular else holiday
    total += 0 if req.on_call_in_regular else on_call
    total += 0 if req.call_back_in_regular else call_back

    return {
        "employee_name": req.timecard.employee_name,
        "week_start": req.timecard.week_start,
        "week_end": req.timecard.week_end,
        "rows": [r.model_dump() for r in rows],
        "summary": {
            "regular_hours": round(regular, 2),
            "overtime_hours": round(overtime, 2),
            "holiday_hours": round(holiday, 2),
            "on_call_hours": round(on_call, 2),
            "call_back_hours": round(call_back, 2),
            "total_hours": round(total, 2),
        },
    }
