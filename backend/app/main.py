from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .models import CalculationRequest
from .calculator import calculate
from .extractor import extract_document
import csv, io

app = FastAPI(title="TimeCard Calculator API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://timecard-calculator-xi.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/health")
def health(): return {"status":"ok"}

@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 15 * 1024 * 1024: raise HTTPException(413, "File too large (15 MB max).")
    try: return extract_document(file.filename or "upload", data)
    except ValueError as e: raise HTTPException(400, str(e))

@app.post("/calculate")
def calc(req: CalculationRequest): return calculate(req)

@app.post("/export/csv")
def export_csv(req: CalculationRequest):
    result = calculate(req)
    out = io.StringIO(); w = csv.writer(out)
    w.writerow(["Employee", result["employee_name"]]); w.writerow(["Week", f'{result["week_start"]} - {result["week_end"]}'])
    w.writerow([]); w.writerow(["Date","Day","Clock In","Clock Out","Break (min)","Regular","OT","Holiday","On-Call","Call-Back","Total"])
    for r in result["rows"]: w.writerow([r[k] for k in ["date","day","clock_in","clock_out","break_minutes","regular_hours","overtime_hours","holiday_hours","on_call_hours","call_back_hours","total_hours"]])
    w.writerow([]); s=result["summary"]
    for label,key in [("Regular","regular_hours"),("Overtime","overtime_hours"),("Holiday","holiday_hours"),("On-Call","on_call_hours"),("Call-Back","call_back_hours"),("Total","total_hours")]: w.writerow([label,s[key]])
    return StreamingResponse(iter([out.getvalue()]), media_type="text/csv", headers={"Content-Disposition":"attachment; filename=timecard-summary.csv"})
