'use client'

import { useMemo, useRef, useState } from 'react'

type Row = {
  date: string
  day: string
  clock_in: string
  clock_out: string
  break_minutes: number
  regular_hours: number
  overtime_hours: number
  holiday_hours: number
  on_call_hours: number
  call_back_hours: number
  total_hours: number
  warning?: string
}

const emptyRow = (): Row => ({
  date: '',
  day: '',
  clock_in: '',
  clock_out: '',
  break_minutes: 0,
  regular_hours: 0,
  overtime_hours: 0,
  holiday_hours: 0,
  on_call_hours: 0,
  call_back_hours: 0,
  total_hours: 0,
})

const API =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function enhanceCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  cropTop = 0,
  cropHeight = 1
) {
  const top = Math.floor(sourceHeight * cropTop)
  const height = Math.floor(sourceHeight * cropHeight)

  const scale = 2

  const canvas = document.createElement('canvas')

  canvas.width = sourceWidth * scale
  canvas.height = height * scale

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not prepare image for OCR.')
  }

  ctx.drawImage(
    source,
    0,
    top,
    sourceWidth,
    height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const image = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  )

  const pixels = image.data

  // Grayscale + stronger contrast.
  for (let i = 0; i < pixels.length; i += 4) {
    const gray =
      pixels[i] * 0.299 +
      pixels[i + 1] * 0.587 +
      pixels[i + 2] * 0.114

    const contrast = 1.65

    const adjusted =
      (gray - 128) * contrast + 128

    const value = Math.max(
      0,
      Math.min(255, adjusted)
    )

    pixels[i] = value
    pixels[i + 1] = value
    pixels[i + 2] = value
  }

  ctx.putImageData(image, 0, 0)

  return canvas
}

async function ocrCanvas(
  canvas: HTMLCanvasElement
): Promise<string> {
  const Tesseract = await import('tesseract.js')

  const result = await Tesseract.recognize(
    canvas,
    'eng'
  )

  return result.data.text || ''
}

async function ocrImageFile(
  file: File
): Promise<string> {
  const bitmap = await createImageBitmap(file)

  try {
    // Full page: best chance to detect employee name/header.
    const fullCanvas = enhanceCanvas(
      bitmap,
      bitmap.width,
      bitmap.height
    )

    const fullText = await ocrCanvas(fullCanvas)

    // Middle of page: usually where time-entry rows are located.
    const tableCanvas = enhanceCanvas(
      bitmap,
      bitmap.width,
      bitmap.height,
      0.18,
      0.62
    )

    const tableText = await ocrCanvas(tableCanvas)

    return `${fullText}\n${tableText}`.trim()
  } finally {
    bitmap.close()
  }
}

async function ocrPdfFile(
  file: File
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')

  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

  const data = new Uint8Array(
    await file.arrayBuffer()
  )

  const pdf = await pdfjs.getDocument({
    data,
  }).promise

  let allText = ''

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page = await pdf.getPage(pageNumber)

    const content = await page.getTextContent()

    const embeddedText = content.items
      .map((item: any) => item.str || '')
      .join(' ')
      .trim()

    if (embeddedText.length > 100) {
      allText += '\n' + embeddedText
      continue
    }

    try {
      const viewport = page.getViewport({
        scale: 2,
      })

      const originalCanvas =
        document.createElement('canvas')

      originalCanvas.width = viewport.width
      originalCanvas.height = viewport.height

      const originalCtx =
        originalCanvas.getContext('2d')

      if (!originalCtx) continue

      await page.render({
        canvas: originalCanvas,
        canvasContext: originalCtx,
        viewport,
      }).promise

      const enhancedCanvas = enhanceCanvas(
        originalCanvas,
        originalCanvas.width,
        originalCanvas.height
      )

      const text =
        await ocrCanvas(enhancedCanvas)

      allText += '\n' + text
    } catch (error) {
      console.warn(
        'Could not OCR PDF page:',
        error
      )
    }
  }

  return allText.trim()
}

async function runBrowserOcr(
  file: File
): Promise<string> {
  const ext = file.name
    .toLowerCase()
    .split('.')
    .pop()

  if (
    ['jpg', 'jpeg', 'png'].includes(ext || '')
  ) {
    return ocrImageFile(file)
  }

  if (ext === 'pdf') {
    return ocrPdfFile(file)
  }

  return ''
}

function parseEmployeeName(text: string) {
  const match = text.match(
    /Employee\s*Name\s*:\s*([^\n\r]+)/i
  )

  if (!match) return ''

  let value = match[1].trim()

  // Stop if another known label ended up on the same OCR line.
  value = value.split(
    /Agency\s*Name|Facility\s*(?:Name|Namo)|Week\s*Ending/i
  )[0]

  return value.trim()
}

function normalizeTime(value: string) {
  let result = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')

  result = result.replace(
    /\s*(AM|PM)$/i,
    ' $1'
  )

  return result
}

function dayFromDate(value: string) {
  const match = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/
  )

  if (!match) return ''

  let year = Number(match[3])

  if (year < 100) {
    year += 2000
  }

  const month = Number(match[1]) - 1
  const day = Number(match[2])

  const date = new Date(
    year,
    month,
    day
  )

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleDateString(
    'en-US',
    {
      weekday: 'short',
    }
  )
}

function parseTimeRows(
  text: string
): Row[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/[|[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)

  const rows: Row[] = []

  const dateRegex =
    /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/

  const dayRegex =
    /\b(Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)\b/i

  const timeRegex =
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:AM|PM)?\b/gi

  for (const line of lines) {
    const dateMatch = line.match(dateRegex)

    if (!dateMatch) {
      continue
    }

    // Don't mistake signature dates for work rows.
    if (
      /signature|manager|supervisor|employee\s*name/i.test(
        line
      )
    ) {
      continue
    }

    const withoutDate = line.replace(
      dateMatch[0],
      ' '
    )

    const times =
      withoutDate.match(timeRegex) || []

    // Do not guess unless we clearly see
    // at least clock-in and clock-out.
    if (times.length < 2) {
      continue
    }

    const dayMatch =
      line.match(dayRegex)

    const row: Row = {
      ...emptyRow(),

      date: dateMatch[1],

      day:
        dayMatch?.[1] ||
        dayFromDate(dateMatch[1]),

      clock_in:
        normalizeTime(times[0]),

      clock_out:
        normalizeTime(
          times[times.length - 1]
        ),

      warning:
        times.length > 2
          ? 'Multiple time values were detected. Please review this row.'
          : undefined,
    }

    rows.push(row)
  }

  // Remove duplicate OCR rows.
  const unique = new Map<string, Row>()

  for (const row of rows) {
    const key = [
      row.date,
      row.clock_in,
      row.clock_out,
    ].join('|')

    if (!unique.has(key)) {
      unique.set(key, row)
    }
  }

  return Array.from(unique.values())
}

function parseOcr(text: string) {
  return {
    employee_name:
      parseEmployeeName(text),

    rows:
      parseTimeRows(text),
  }
}

export default function Home() {
  const [employee, setEmployee] =
    useState('')

  const [rows, setRows] =
    useState<Row[]>([
      emptyRow(),
    ])

  const [otMode, setOtMode] =
    useState('none')

  const [
    dailyThreshold,
    setDailyThreshold,
  ] = useState(8)

  const [
    weeklyThreshold,
    setWeeklyThreshold,
  ] = useState(40)

  const [message, setMessage] =
    useState('')

  const [summary, setSummary] =
    useState<any>(null)

  const fileRef =
    useRef<HTMLInputElement>(null)

  const update = (
    index: number,
    key: keyof Row,
    value: any
  ) => {
    setRows((current) =>
      current.map(
        (row, rowIndex) =>
          rowIndex === index
            ? {
                ...row,
                [key]: value,
              }
            : row
      )
    )
  }

  const payload = useMemo(
    () => ({
      timecard: {
        employee_name: employee,

        // Backend compatibility.
        week_start: '',
        week_end: '',

        rows,
      },

      overtime: {
        mode: otMode,

        daily_threshold:
          dailyThreshold,

        weekly_threshold:
          weeklyThreshold,

        custom_threshold:
          weeklyThreshold,
      },

      holiday_in_regular: false,
      on_call_in_regular: false,
      call_back_in_regular: false,
    }),
    [
      employee,
      rows,
      otMode,
      dailyThreshold,
      weeklyThreshold,
    ]
  )

  async function upload(
    file?: File
  ) {
    if (!file) return

    setSummary(null)

    setMessage(
      'Reading timecard…'
    )

    const ext = file.name
      .toLowerCase()
      .split('.')
      .pop()

    try {
      if (
        ['pdf', 'jpg', 'jpeg', 'png'].includes(
          ext || ''
        )
      ) {
        setMessage(
          'Enhancing image and reading timecard with OCR. This can take several seconds…'
        )

        const text =
          await runBrowserOcr(file)

        console.log(
          'OCR TEXT:',
          text
        )

        if (
          !text ||
          text.trim().length < 10
        ) {
          setMessage(
            "We couldn't confidently read this timecard. Please enter or correct the information manually."
          )

          return
        }

        const parsed =
          parseOcr(text)

        console.log(
          'PARSED OCR:',
          parsed
        )

        if (
          parsed.employee_name
        ) {
          setEmployee(
            parsed.employee_name
          )
        }

        if (
          parsed.rows.length > 0
        ) {
          setRows(
            parsed.rows
          )
        } else {
          setRows([
            emptyRow(),
          ])
        }

        if (
          parsed.employee_name &&
          parsed.rows.length > 0
        ) {
          setMessage(
            `OCR completed. Employee name and ${parsed.rows.length} time row(s) were detected. Please review every value before calculating.`
          )
        } else if (
          parsed.employee_name
        ) {
          setMessage(
            'OCR completed. Employee name was detected, but the time rows were not clear enough to fill automatically. Please enter or correct them manually.'
          )
        } else if (
          parsed.rows.length > 0
        ) {
          setMessage(
            `OCR completed. ${parsed.rows.length} time row(s) were detected. Please enter the employee name and review every value.`
          )
        } else {
          setMessage(
            'OCR completed, but the document was not clear enough to identify the employee name or time rows confidently.'
          )
        }

        return
      }

      // CSV / XLSX
      const form =
        new FormData()

      form.append(
        'file',
        file
      )

      const response =
        await fetch(
          `${API}/extract`,
          {
            method: 'POST',
            body: form,
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail ||
            'Upload failed'
        )
      }

      setEmployee(
        data.employee_name || ''
      )

      setRows(
        data.rows?.length
          ? data.rows
          : [emptyRow()]
      )

      setMessage(
        data.warnings?.[0] ||
          'Extraction complete. Review all fields before calculating.'
      )
    } catch (error: any) {
      console.error(error)

      setMessage(
        error?.message ||
          'Could not read file'
      )
    }
  }

  async function calculate() {
    setMessage('')

    try {
      const response =
        await fetch(
          `${API}/calculate`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail ||
            'Calculation failed'
        )
      }

      setRows(
        data.rows || rows
      )

      setSummary(
        data.summary
      )
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not calculate hours'
      )
    }
  }

  async function downloadCsv() {
    try {
      const response =
        await fetch(
          `${API}/export/csv`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        )

      if (!response.ok) {
        throw new Error(
          'Could not export CSV'
        )
      }

      const blob =
        await response.blob()

      const url =
        URL.createObjectURL(
          blob
        )

      const link =
        document.createElement(
          'a'
        )

      link.href = url

      link.download =
        'timecard-summary.csv'

      link.click()

      URL.revokeObjectURL(
        url
      )
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not export CSV'
      )
    }
  }

  function reset() {
    setEmployee('')
    setRows([emptyRow()])
    setSummary(null)
    setMessage('')
    setOtMode('none')
    setDailyThreshold(8)
    setWeeklyThreshold(40)

    if (fileRef.current) {
      fileRef.current.value =
        ''
    }
  }

  return (
    <main className="wrap">
      <nav className="nav">
        <div className="brand">
          TimeCard Calculator
        </div>

        <div>
          Privacy-first • No account required
        </div>
      </nav>

      <section className="hero">
        <h1>
          TimeCard Calculator
        </h1>

        <p>
          Upload your timecard and
          automatically calculate your
          daily and weekly hours.
        </p>

        <div className="actions">
          <button
            className="btn primary"
            onClick={() =>
              fileRef.current?.click()
            }
          >
            Upload Timecard
          </button>

          <button
            className="btn secondary"
            onClick={() =>
              document
                .getElementById(
                  'review'
                )
                ?.scrollIntoView({
                  behavior:
                    'smooth',
                })
            }
          >
            Enter Time Manually
          </button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".pdf,.xlsx,.csv,.jpg,.jpeg,.png"
            onChange={(e) =>
              upload(
                e.target.files?.[0]
              )
            }
          />
        </div>
      </section>

      <section className="steps">
        <div className="step">
          <b>1. Upload</b>

          <p>
            PDF, Excel, CSV, JPG,
            JPEG or PNG.
          </p>
        </div>

        <div className="step">
          <b>2. Review</b>

          <p>
            Confirm extracted values.
            We never guess uncertain
            data.
          </p>
        </div>

        <div className="step">
          <b>3. Calculate</b>

          <p>
            Normal, overnight and
            break-deducted shifts.
          </p>
        </div>

        <div className="step">
          <b>4. Export</b>

          <p>
            Download, print or copy
            your summary.
          </p>
        </div>
      </section>

      <section
        className="card"
        id="review"
      >
        <h2>
          Timecard review
        </h2>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="field">
          <label>
            Employee Name
          </label>

          <input
            value={employee}
            onChange={(e) =>
              setEmployee(
                e.target.value
              )
            }
          />
        </div>

        <h3>
          Overtime settings
        </h3>

        <div className="grid2">
          <div className="field">
            <label>
              Rule
            </label>

            <select
              value={otMode}
              onChange={(e) =>
                setOtMode(
                  e.target.value
                )
              }
            >
              <option value="none">
                No overtime
              </option>

              <option value="daily">
                After daily threshold
              </option>

              <option value="weekly">
                After weekly threshold
              </option>

              <option value="custom">
                Custom weekly threshold
              </option>
            </select>
          </div>

          <div className="field">
            <label>
              {otMode === 'daily'
                ? 'Daily threshold'
                : 'Weekly/custom threshold'}
            </label>

            <input
              type="number"
              step="0.25"
              value={
                otMode === 'daily'
                  ? dailyThreshold
                  : weeklyThreshold
              }
              onChange={(e) => {
                const value =
                  Number(
                    e.target.value
                  )

                if (
                  otMode ===
                  'daily'
                ) {
                  setDailyThreshold(
                    value
                  )
                } else {
                  setWeeklyThreshold(
                    value
                  )
                }
              }}
            />
          </div>
        </div>

        <p
          style={{
            color: '#64748b',
            fontSize: 13,
          }}
        >
          Overtime rules vary by employer,
          facility, contract and jurisdiction.
          Choose the rule that applies to you.
        </p>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                {[
                  'Date',
                  'Day',
                  'Clock In',
                  'Clock Out',
                  'Break',
                  'Regular',
                  'OT',
                  'Holiday',
                  'On-Call',
                  'Call-Back',
                  'Total',
                  '',
                ].map((label) => (
                  <th key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map(
                (row, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        value={
                          row.date
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'date',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          row.day
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'day',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          row.clock_in
                        }
                        placeholder="7:00 AM"
                        onChange={(e) =>
                          update(
                            index,
                            'clock_in',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          row.clock_out
                        }
                        placeholder="7:30 PM"
                        onChange={(e) =>
                          update(
                            index,
                            'clock_out',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        value={
                          row.break_minutes
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'break_minutes',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="0.25"
                        value={
                          row.regular_hours
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'regular_hours',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="0.25"
                        value={
                          row.overtime_hours
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'overtime_hours',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="0.25"
                        value={
                          row.holiday_hours
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'holiday_hours',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="0.25"
                        value={
                          row.on_call_hours
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'on_call_hours',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="0.25"
                        value={
                          row.call_back_hours
                        }
                        onChange={(e) =>
                          update(
                            index,
                            'call_back_hours',
                            Number(
                              e.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      {row.total_hours?.toFixed?.(
                        2
                      ) || '0.00'}
                    </td>

                    <td>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setRows(
                            (current) =>
                              current.filter(
                                (
                                  _,
                                  rowIndex
                                ) =>
                                  rowIndex !==
                                  index
                              )
                          )
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        <div className="actions">
          <button
            className="btn secondary"
            onClick={() =>
              setRows(
                (current) => [
                  ...current,
                  emptyRow(),
                ]
              )
            }
          >
            + Add Row
          </button>

          <button
            className="btn primary"
            onClick={calculate}
          >
            Calculate Hours
          </button>

          <button
            className="btn secondary"
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </section>

      {summary && (
        <section className="card">
          <h2>
            Summary
          </h2>

          <p>
            <b>
              {employee ||
                'Employee'}
            </b>
          </p>

          <div className="summary">
            {[
              [
                'Regular',
                summary.regular_hours,
              ],
              [
                'Overtime',
                summary.overtime_hours,
              ],
              [
                'Holiday',
                summary.holiday_hours,
              ],
              [
                'On-Call',
                summary.on_call_hours,
              ],
              [
                'Call-Back',
                summary.call_back_hours,
              ],
              [
                'TOTAL',
                summary.total_hours,
              ],
            ].map(
              ([label, value]) => (
                <div
                  className="metric"
                  key={String(label)}
                >
                  <span>
                    {label}
                  </span>

                  <strong>
                    {Number(
                      value
                    ).toFixed(2)}
                  </strong>
                </div>
              )
            )}
          </div>

          <div className="actions">
            <button
              className="btn primary"
              onClick={downloadCsv}
            >
              Download CSV
            </button>

            <button
              className="btn secondary"
              onClick={() =>
                window.print()
              }
            >
              Print
            </button>

            <button
              className="btn secondary"
              onClick={() =>
                navigator.clipboard.writeText(
                  `Employee: ${employee}\nTotal Hours: ${Number(
                    summary.total_hours
                  ).toFixed(2)}`
                )
              }
            >
              Copy Summary
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>
          Privacy & trust
        </h2>

        <p>
          No account is required for the
          MVP. Uploaded documents are
          processed temporarily. The
          application is designed to flag
          uncertain data for manual review
          instead of inventing values.
        </p>
      </section>

      <footer className="footer">
        TimeCard Calculator MVP • Add a
        reviewed Privacy Policy and Terms
        of Use before public launch.
      </footer>
    </main>
  )
}
