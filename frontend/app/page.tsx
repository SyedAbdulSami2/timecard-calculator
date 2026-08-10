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
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

const emptyRow = (day = ''): Row => ({
  date: '',
  day,
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

const defaultRows = () => DAYS.map((day) => emptyRow(day))

const API =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function parseTime(value: string): number | null {
  if (!value || !value.trim()) {
    return null
  }

  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, '')

  const meridiemMatch = text.match(/(AM|PM)$/)
  const meridiem = meridiemMatch?.[1] || ''

  if (meridiem) {
    text = text.replace(/(AM|PM)$/, '')
  }

  let hours = 0
  let minutes = 0

  if (text.includes(':')) {
    const parts = text.split(':')

    if (parts.length !== 2) {
      return null
    }

    hours = Number(parts[0])
    minutes = Number(parts[1])
  } else {
    const digits = text.replace(/\D/g, '')

    if (digits.length <= 2) {
      hours = Number(digits)
      minutes = 0
    } else if (digits.length === 3) {
      hours = Number(digits.slice(0, 1))
      minutes = Number(digits.slice(1))
    } else if (digits.length === 4) {
      hours = Number(digits.slice(0, 2))
      minutes = Number(digits.slice(2))
    } else {
      return null
    }
  }

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null
    }

    if (meridiem === 'AM') {
      if (hours === 12) {
        hours = 0
      }
    }

    if (meridiem === 'PM') {
      if (hours !== 12) {
        hours += 12
      }
    }
  } else {
    if (hours < 0 || hours > 23) {
      return null
    }
  }

  return hours * 60 + minutes
}

function calculateRow(row: Row): Row {
  const start = parseTime(row.clock_in)
  const end = parseTime(row.clock_out)

  if (start === null || end === null) {
    return {
      ...row,
      regular_hours: 0,
      overtime_hours: 0,
      total_hours: 0,
    }
  }

  let workedMinutes = end - start

  // Handle overnight shifts.
  // Example: 6:40 PM -> 7:13 AM
  if (workedMinutes < 0) {
    workedMinutes += 24 * 60
  }

  workedMinutes -= Number(row.break_minutes || 0)

  if (workedMinutes < 0) {
    workedMinutes = 0
  }

  const workedHours = workedMinutes / 60

  return {
    ...row,
    regular_hours: workedHours,
    overtime_hours: 0,
    total_hours: workedHours,
  }
}

function applyOvertime(
  rows: Row[],
  mode: string,
  dailyThreshold: number,
  weeklyThreshold: number
) {
  let weeklyRegularUsed = 0

  return rows.map((row) => {
    const base = calculateRow(row)

    const hours = base.total_hours

    let regular = hours
    let overtime = 0

    if (mode === 'daily') {
      regular = Math.min(hours, dailyThreshold)
      overtime = Math.max(0, hours - dailyThreshold)
    }

    if (mode === 'weekly' || mode === 'custom') {
      const remainingRegular = Math.max(
        0,
        weeklyThreshold - weeklyRegularUsed
      )

      regular = Math.min(hours, remainingRegular)
      overtime = Math.max(0, hours - remainingRegular)

      weeklyRegularUsed += regular
    }

    return {
      ...base,
      regular_hours: regular,
      overtime_hours: overtime,
      total_hours: regular + overtime,
    }
  })
}

function decimalHoursToText(hours: number) {
  const totalMinutes = Math.round(hours * 60)

  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60

  if (h === 0) {
    return `${m}m`
  }

  if (m === 0) {
    return `${h}h`
  }

  return `${h}h ${m}m`
}

function parseEmployee(text: string) {
  const match = text.match(
    /Employee\s*Name\s*:\s*([^\n\r]+)/i
  )

  if (!match) {
    return ''
  }

  return match[1]
    .split(
      /Agency\s*Name|Facility\s*(?:Name|Namo)|Week\s*Ending/i
    )[0]
    .trim()
}

async function runBrowserOcr(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop()

  if (['jpg', 'jpeg', 'png'].includes(ext || '')) {
    const Tesseract = await import('tesseract.js')

    const result = await Tesseract.recognize(file, 'eng')

    return result.data.text || ''
  }

  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist')

    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

    const data = new Uint8Array(await file.arrayBuffer())

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

      if (embeddedText.length > 40) {
        allText += '\n' + embeddedText
        continue
      }

      try {
        const viewport = page.getViewport({
          scale: 2,
        })

        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          continue
        }

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise

        const Tesseract = await import('tesseract.js')

        const result = await Tesseract.recognize(
          canvas,
          'eng'
        )

        allText += '\n' + (result.data.text || '')
      } catch (error) {
        console.warn(
          'Could not OCR PDF page:',
          error
        )
      }
    }

    return allText.trim()
  }

  return ''
}

export default function Home() {
  const [employee, setEmployee] = useState('')

  const [rows, setRows] = useState<Row[]>(
    defaultRows()
  )

  const [otMode, setOtMode] = useState('none')

  const [dailyThreshold, setDailyThreshold] =
    useState(8)

  const [weeklyThreshold, setWeeklyThreshold] =
    useState(40)

  const [message, setMessage] = useState('')

  const [summary, setSummary] = useState<any>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const calculatedRows = useMemo(
    () =>
      applyOvertime(
        rows,
        otMode,
        dailyThreshold,
        weeklyThreshold
      ),
    [
      rows,
      otMode,
      dailyThreshold,
      weeklyThreshold,
    ]
  )

  const totals = useMemo(() => {
    return calculatedRows.reduce(
      (total, row) => ({
        regular:
          total.regular + row.regular_hours,

        overtime:
          total.overtime + row.overtime_hours,

        total:
          total.total + row.total_hours,
      }),
      {
        regular: 0,
        overtime: 0,
        total: 0,
      }
    )
  }, [calculatedRows])

  const payload = useMemo(
    () => ({
      timecard: {
        employee_name: employee,

        // Keep these for backend compatibility.
        week_start: '',
        week_end: '',

        rows: calculatedRows,
      },

      overtime: {
        mode: otMode,
        daily_threshold: dailyThreshold,
        weekly_threshold: weeklyThreshold,
        custom_threshold: weeklyThreshold,
      },

      holiday_in_regular: false,
      on_call_in_regular: false,
      call_back_in_regular: false,
    }),
    [
      employee,
      calculatedRows,
      otMode,
      dailyThreshold,
      weeklyThreshold,
    ]
  )

  function updateRow(
    index: number,
    key: keyof Row,
    value: any
  ) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: value,
            }
          : row
      )
    )
  }

  async function upload(file?: File) {
    if (!file) {
      return
    }

    setSummary(null)
    setMessage('Reading timecard…')

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
          'Reading timecard with OCR. This can take several seconds…'
        )

        const text = await runBrowserOcr(file)

        console.log('OCR TEXT:', text)

        if (!text || text.trim().length < 10) {
          setMessage(
            "We couldn't confidently read this timecard. Please enter the information manually."
          )

          return
        }

        const name = parseEmployee(text)

        if (name) {
          setEmployee(name)

          setMessage(
            'OCR completed. Employee name was detected. Please review and enter any missing time entries.'
          )
        } else {
          setMessage(
            'OCR completed, but the employee name could not be identified. Please enter it manually.'
          )
        }

        return
      }

      const form = new FormData()

      form.append('file', file)

      const response = await fetch(
        `${API}/extract`,
        {
          method: 'POST',
          body: form,
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail || 'Upload failed'
        )
      }

      setEmployee(
        data.employee_name || ''
      )

      if (data.rows?.length) {
        setRows(data.rows)
      }

      setMessage(
        data.warnings?.[0] ||
          'Extraction complete. Please review all values.'
      )
    } catch (error: any) {
      console.error(error)

      setMessage(
        error?.message ||
          'Could not read timecard.'
      )
    }
  }

  async function calculateWithBackend() {
    setMessage('')

    try {
      const response = await fetch(
        `${API}/calculate`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify(payload),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail ||
            'Calculation failed'
        )
      }

      setSummary(data.summary)
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not calculate hours'
      )
    }
  }

  async function downloadCsv() {
    try {
      const response = await fetch(
        `${API}/export/csv`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify(payload),
        }
      )

      if (!response.ok) {
        throw new Error(
          'Could not export CSV'
        )
      }

      const blob = await response.blob()

      const url =
        URL.createObjectURL(blob)

      const link =
        document.createElement('a')

      link.href = url

      link.download =
        'timecard-summary.csv'

      link.click()

      URL.revokeObjectURL(url)
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not export CSV'
      )
    }
  }

  function reset() {
    setEmployee('')
    setRows(defaultRows())

    setOtMode('none')
    setDailyThreshold(8)
    setWeeklyThreshold(40)

    setMessage('')
    setSummary(null)

    if (fileRef.current) {
      fileRef.current.value = ''
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
          Upload a timecard or enter your
          hours manually. Daily and weekly
          totals update automatically.
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
                .getElementById('review')
                ?.scrollIntoView({
                  behavior: 'smooth',
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
            onChange={(event) =>
              upload(
                event.target.files?.[0]
              )
            }
          />
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
            onChange={(event) =>
              setEmployee(
                event.target.value
              )
            }
          />
        </div>

        <h3>
          Time entries
        </h3>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Break (min)</th>
                <th>Regular</th>
                <th>OT</th>
                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              {calculatedRows.map(
                (row, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        value={row.day}
                        onChange={(event) =>
                          updateRow(
                            index,
                            'day',
                            event.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          rows[index].clock_in
                        }
                        placeholder=""
                        onChange={(event) =>
                          updateRow(
                            index,
                            'clock_in',
                            event.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          rows[index].clock_out
                        }
                        placeholder=""
                        onChange={(event) =>
                          updateRow(
                            index,
                            'clock_out',
                            event.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min="0"
                        value={
                          rows[index].break_minutes
                        }
                        onChange={(event) =>
                          updateRow(
                            index,
                            'break_minutes',
                            Number(
                              event.target.value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      {decimalHoursToText(
                        row.regular_hours
                      )}

                      <div
                        style={{
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        {row.regular_hours.toFixed(
                          2
                        )}
                      </div>
                    </td>

                    <td>
                      {decimalHoursToText(
                        row.overtime_hours
                      )}

                      <div
                        style={{
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        {row.overtime_hours.toFixed(
                          2
                        )}
                      </div>
                    </td>

                    <td>
                      <b>
                        {decimalHoursToText(
                          row.total_hours
                        )}
                      </b>

                      <div
                        style={{
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        {row.total_hours.toFixed(
                          2
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
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
              onChange={(event) =>
                setOtMode(
                  event.target.value
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
              onChange={(event) => {
                const value =
                  Number(
                    event.target.value
                  )

                if (
                  otMode === 'daily'
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
          contract, facility and jurisdiction.
          Select the rule that applies to you.
        </p>

        <div className="summary">
          <div className="metric">
            <span>
              Regular
            </span>

            <strong>
              {decimalHoursToText(
                totals.regular
              )}
            </strong>

            <small>
              {totals.regular.toFixed(2)}
            </small>
          </div>

          <div className="metric">
            <span>
              Overtime
            </span>

            <strong>
              {decimalHoursToText(
                totals.overtime
              )}
            </strong>

            <small>
              {totals.overtime.toFixed(2)}
            </small>
          </div>

          <div className="metric">
            <span>
              Total
            </span>

            <strong>
              {decimalHoursToText(
                totals.total
              )}
            </strong>

            <small>
              {totals.total.toFixed(2)}
            </small>
          </div>
        </div>

        <div className="actions">
          <button
            className="btn primary"
            onClick={
              calculateWithBackend
            }
          >
            Finalize Calculation
          </button>

          <button
            className="btn secondary"
            onClick={
              downloadCsv
            }
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
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </section>

      {summary && (
        <section className="card">
          <h2>
            Final summary
          </h2>

          <p>
            <b>
              {employee ||
                'Employee'}
            </b>
          </p>

          <div className="summary">
            <div className="metric">
              <span>
                Regular
              </span>

              <strong>
                {decimalHoursToText(
                  Number(
                    summary.regular_hours
                  )
                )}
              </strong>
            </div>

            <div className="metric">
              <span>
                Overtime
              </span>

              <strong>
                {decimalHoursToText(
                  Number(
                    summary.overtime_hours
                  )
                )}
              </strong>
            </div>

            <div className="metric">
              <span>
                Total
              </span>

              <strong>
                {decimalHoursToText(
                  Number(
                    summary.total_hours
                  )
                )}
              </strong>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>
          Privacy & trust
        </h2>

        <p>
          Uploaded documents are processed
          temporarily. OCR can make mistakes,
          particularly with handwriting.
          Review every detected value before
          using the final calculation.
        </p>
      </section>

      <footer className="footer">
        TimeCard Calculator MVP
      </footer>
    </main>
  )
}
