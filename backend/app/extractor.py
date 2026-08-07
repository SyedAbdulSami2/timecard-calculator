from __future__ import annotations
import csv, io, re
from pathlib import Path
from typing import Any

SUPPORTED = {".pdf", ".xlsx", ".csv", ".jpg", ".jpeg", ".png"}

HEADER_MAP = {
    "employee name": "employee_name", "employee": "employee_name",
    "week start": "week_start", "week end": "week_end",
    "date": "date", "day": "day", "clock in": "clock_in", "time in": "clock_in",
    "clock out": "clock_out", "time out": "clock_out", "break": "break_minutes",
    "regular hours": "regular_hours", "hours": "regular_hours",
    "overtime hours": "overtime_hours", "ot": "overtime_hours",
    "holiday hours": "holiday_hours", "on-call hours": "on_call_hours", "on call": "on_call_hours",
    "call-back hours": "call_back_hours", "call back": "call_back_hours", "callback": "call_back_hours",
}


def _num(v: Any) -> float:
    try: return float(str(v).strip() or 0)
    except Exception: return 0.0


def _break(v: Any) -> int:
    s = str(v).strip().lower()
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else 0


def extract_csv(data: bytes):
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for raw in reader:
        normalized = {HEADER_MAP.get((k or "").strip().lower(), (k or "").strip().lower()): v for k, v in raw.items()}
        rows.append({
            "date": normalized.get("date", ""), "day": normalized.get("day", ""),
            "clock_in": normalized.get("clock_in", ""), "clock_out": normalized.get("clock_out", ""),
            "break_minutes": _break(normalized.get("break_minutes", 0)),
            "regular_hours": _num(normalized.get("regular_hours", 0)),
            "overtime_hours": _num(normalized.get("overtime_hours", 0)),
            "holiday_hours": _num(normalized.get("holiday_hours", 0)),
            "on_call_hours": _num(normalized.get("on_call_hours", 0)),
            "call_back_hours": _num(normalized.get("call_back_hours", 0)),
            "total_hours": 0.0,
        })
    return {"employee_name":"", "week_start":"", "week_end":"", "rows":rows, "warnings":[]}


def extract_xlsx(data: bytes):
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb.active
    values = list(ws.iter_rows(values_only=True))
    if not values: return {"employee_name":"", "week_start":"", "week_end":"", "rows":[], "warnings":[]}
    headers = [str(x or "").strip().lower() for x in values[0]]
    keys = [HEADER_MAP.get(h, h) for h in headers]
    rows = []
    for vals in values[1:]:
        raw = dict(zip(keys, vals))
        if not any(v not in (None, "") for v in vals): continue
        rows.append({
            "date": str(raw.get("date", "") or ""), "day": str(raw.get("day", "") or ""),
            "clock_in": str(raw.get("clock_in", "") or ""), "clock_out": str(raw.get("clock_out", "") or ""),
            "break_minutes": _break(raw.get("break_minutes", 0)),
            "regular_hours": _num(raw.get("regular_hours", 0)), "overtime_hours": _num(raw.get("overtime_hours", 0)),
            "holiday_hours": _num(raw.get("holiday_hours", 0)), "on_call_hours": _num(raw.get("on_call_hours", 0)),
            "call_back_hours": _num(raw.get("call_back_hours", 0)), "total_hours": 0.0,
        })
    return {"employee_name":"", "week_start":"", "week_end":"", "rows":rows, "warnings":[]}


def extract_document(filename: str, data: bytes):
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED: raise ValueError("Unsupported file type")
    if ext == ".csv": return extract_csv(data)
    if ext == ".xlsx": return extract_xlsx(data)
    # OCR/document parsing is deliberately conservative. Production deployments can plug in
    # a managed OCR/document AI provider. The MVP never invents values when confidence is low.
    return {
        "employee_name":"", "week_start":"", "week_end":"", "rows":[],
        "warnings":["We couldn't confidently read this timecard. Please enter or correct the information manually."],
        "ocr_status":"manual_review_required"
    }
