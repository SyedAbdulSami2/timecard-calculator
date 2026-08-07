from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Literal

class TimeRow(BaseModel):
    date: str = ""
    day: str = ""
    clock_in: str = ""
    clock_out: str = ""
    break_minutes: int = 0
    regular_hours: float = 0.0
    overtime_hours: float = 0.0
    holiday_hours: float = 0.0
    on_call_hours: float = 0.0
    call_back_hours: float = 0.0
    total_hours: float = 0.0
    confidence: Optional[float] = None
    warning: Optional[str] = None

class TimecardData(BaseModel):
    employee_name: str = ""
    week_start: str = ""
    week_end: str = ""
    rows: List[TimeRow] = Field(default_factory=list)

class OvertimeSettings(BaseModel):
    mode: Literal["none", "daily", "weekly", "custom"] = "none"
    daily_threshold: float = 8.0
    weekly_threshold: float = 40.0
    custom_threshold: float = 40.0

class CalculationRequest(BaseModel):
    timecard: TimecardData
    overtime: OvertimeSettings = Field(default_factory=OvertimeSettings)
    holiday_in_regular: bool = False
    on_call_in_regular: bool = False
    call_back_in_regular: bool = False
