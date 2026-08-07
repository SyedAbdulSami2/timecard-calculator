# TimeCard Calculator MVP

A privacy-first public web application for uploading or manually entering timecards, reviewing extracted information, calculating daily/weekly hours, and exporting a summary.

## Architecture
- **Frontend:** Next.js/React. Handles public UI, editable review table, overtime settings, results, print/copy actions.
- **Backend:** FastAPI. Owns file validation/extraction, time arithmetic, category handling, and export.
- **Calculation engine:** Pure Python functions. Supports AM/PM, 24-hour input, overnight shifts, break deductions, missing values, and configurable overtime.
- **Extraction layer:** CSV/XLSX parsing is implemented. PDF/image uploads are accepted but intentionally return `manual_review_required` until a production OCR/document AI provider is configured. This prevents low-confidence guessing.
- **Storage:** No database is required. Files are processed in memory by the API and not persisted by the app.

## Project structure
```
timecard-calculator/
  frontend/               Next.js UI
    app/page.tsx
    app/globals.css
  backend/
    app/main.py            API routes
    app/models.py          request/response models
    app/calculator.py      time + overtime logic
    app/extractor.py       CSV/XLSX + OCR adapter point
    tests/test_calculator.py
```

## Time calculation logic
1. Parse clock-in/out as 12-hour or 24-hour time.
2. If clock-out <= clock-in, treat it as an overnight shift and add one day.
3. Subtract break minutes.
4. Never return a negative duration.
5. Missing/unparseable clock-in/out is flagged for manual review.
6. Overtime can be disabled, calculated after a daily threshold, after a weekly threshold, or with a custom weekly threshold.
7. Holiday, on-call and call-back categories are not automatically assumed to overlap with regular hours. The API includes overlap flags to avoid double counting when the user knows they do.

## OCR / extraction plan
For public production use, add one OCR/document extraction provider behind `extract_document()` (for example Azure Document Intelligence, Google Document AI, AWS Textract, or a private OCR pipeline). Normalize provider output into the `TimecardData` model and attach confidence to each field. Values below the chosen confidence threshold must be blank/flagged and require user review.

The MVP already parses well-structured CSV and Excel files. Image/PDF uploads deliberately do **not** guess values.

## Run locally
### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:3000

## Run tests
```bash
cd backend
pytest -q
```

## Sample test data
- 7:00 AM → 7:30 PM with a 30-minute break = **12.00 hours**
- 7:00 PM → 7:00 AM = **12.00 hours** (overnight)
- 7:00 AM → 7:00 PM with daily OT after 8 hours = **8 regular + 4 overtime**

## Before public launch
- Integrate production OCR with field-level confidence.
- Add PDF and Excel export (CSV + print are in the MVP).
- Add explicit user controls for category overlap/double-counting rules.
- Add malware scanning, MIME sniffing, rate limits, logging redaction and upload abuse controls.
- Add reviewed Privacy Policy and Terms of Use.
- Deploy frontend and backend behind HTTPS with a restrictive CORS policy.
