from app.calculator import worked_hours, calculate
from app.models import CalculationRequest, TimecardData, TimeRow, OvertimeSettings

def test_normal_shift_break(): assert worked_hours("7:00 AM", "7:30 PM", 30) == 12.0

def test_overnight(): assert worked_hours("7:00 PM", "7:00 AM", 0) == 12.0

def test_missing(): assert worked_hours("", "7:00 PM", 0) is None

def test_daily_ot():
    req = CalculationRequest(timecard=TimecardData(rows=[TimeRow(clock_in="7:00 AM", clock_out="7:00 PM")]), overtime=OvertimeSettings(mode="daily", daily_threshold=8))
    res = calculate(req)
    assert res["summary"]["regular_hours"] == 8
    assert res["summary"]["overtime_hours"] == 4
