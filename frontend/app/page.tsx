'use client'

import { useMemo, useRef, useState } from 'react'

type Row = {
  day: string
  clock_in: string
  clock_out: string
  break_minutes: number
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

const defaultRows = (): Row[] =>
  DAYS.map((day) => ({
    day,
    clock_in: '',
    clock_out: '',
    break_minutes: 0,
  }))

function parseTime(value: string): number | null {
  if (!value || !value.trim()) return null

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

    if (parts.length !== 2) return null

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
      if (hours === 12) hours = 0
    }

    if (meridiem === 'PM') {
      if (hours !== 12) hours += 12
    }
  } else {
    if (hours < 0 || hours > 23) {
      return null
    }
  }

  return hours * 60 + minutes
}

function getWorkedMinutes(row: Row): number {
  const start = parseTime(row.clock_in)
  const end = parseTime(row.clock_out)

  if (start === null || end === null) {
    return 0
  }

  let minutes = end - start

  // Overnight shift
  if (minutes < 0) {
    minutes += 24 * 60
  }

  minutes -= Number(row.break_minutes || 0)

  if (minutes < 0) {
    return 0
  }

  return minutes
}

function minutesToDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2)
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

        if (!context) continue

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
        console.warn('PDF OCR failed:', error)
      }
    }

    return allText.trim()
  }

  return ''
}

function normalizeOcrTime(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .trim()
}

function extractTimesFromLine(line: string) {
  const cleaned = line
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')

  const matches =
    cleaned.match(
      /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
    ) || []

  return matches
    .map(normalizeOcrTime)
    .filter((value) => parseTime(value) !== null)
}

function parseOcrRows(text: string): Row[] {
  const rows = defaultRows()

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  DAYS.forEach((day, index) => {
    const shortDay = day.slice(0, 3)

    const line = lines.find((item) =>
      new RegExp(`\\b${shortDay}`, 'i').test(item)
    )

    if (!line) return

    const times = extractTimesFromLine(line)

    if (times.length >= 2) {
      rows[index] = {
        ...rows[index],
        clock_in: times[0],
        clock_out: times[1],
      }
    }

    const breakMatch = line.match(
      /\b(?:break\s*)?(\d{1,3})\s*(?:min|mins|minutes)?\b/i
    )

    if (breakMatch) {
      const value = Number(breakMatch[1])

      if (value >= 0 && value <= 180) {
        rows[index].break_minutes = value
      }
    }
  })

  return rows
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>(defaultRows())

  const [entryMode, setEntryMode] =
    useState<'upload' | 'manual'>('manual')

  const [submitted, setSubmitted] = useState(false)

  const [message, setMessage] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const dailyMinutes = useMemo(
    () => rows.map((row) => getWorkedMinutes(row)),
    [rows]
  )

  const weeklyMinutes = useMemo(
    () =>
      dailyMinutes.reduce(
        (sum, minutes) => sum + minutes,
        0
      ),
    [dailyMinutes]
  )

  function updateRow(
    index: number,
    key: keyof Row,
    value: string | number
  ) {
    if (entryMode === 'manual') {
      setSubmitted(false)
    }

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

  function startManualEntry() {
    setEntryMode('manual')
    setSubmitted(false)
    setMessage('')

    document
      .getElementById('entries')
      ?.scrollIntoView({
        behavior: 'smooth',
      })
  }

  async function upload(file?: File) {
    if (!file) return

    setEntryMode('upload')
    setSubmitted(false)

    setMessage(
      'Reading timecard with OCR. Please wait…'
    )

    try {
      const text = await runBrowserOcr(file)

      console.log('OCR TEXT:', text)

      if (!text || text.trim().length < 10) {
        setRows(defaultRows())

        setMessage(
          "OCR couldn't confidently read the timecard. Please review and correct the blank fields manually."
        )

        setSubmitted(true)
        return
      }

      const detectedRows = parseOcrRows(text)

      setRows(detectedRows)

      const detectedCount = detectedRows.filter(
        (row) => row.clock_in && row.clock_out
      ).length

      if (detectedCount > 0) {
        setMessage(
          `OCR completed. ${detectedCount} day(s) were detected. Please verify the values.`
        )
      } else {
        setMessage(
          'OCR completed, but the daily times were not clear enough. Please correct the fields manually.'
        )
      }

      // Uploaded timecard calculates automatically
      setSubmitted(true)
    } catch (error) {
      console.error(error)

      setMessage(
        'Could not read the uploaded timecard. Please enter the times manually.'
      )

      setSubmitted(true)
    }
  }

  function submitManual() {
    setSubmitted(true)

    const completedDays = rows.filter(
      (row) => row.clock_in && row.clock_out
    ).length

    if (completedDays === 0) {
      setMessage(
        'Enter at least one Clock In and Clock Out pair.'
      )

      setSubmitted(false)
      return
    }

    setMessage('')
  }

  function reset() {
    setRows(defaultRows())
    setEntryMode('manual')
    setSubmitted(false)
    setMessage('')

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
          No account required
        </div>
      </nav>

      <section className="hero">
        <h1>TimeCard Calculator</h1>

        <p>
          Upload a timecard or enter your daily times manually.
          Hours are calculated in decimal format.
        </p>

        <div className="actions">
          <button
            className="btn primary"
            onClick={() => fileRef.current?.click()}
          >
            Upload Timecard
          </button>

          <button
            className="btn secondary"
            onClick={startManualEntry}
          >
            Enter Time Manually
          </button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(event) =>
              upload(event.target.files?.[0])
            }
          />
        </div>
      </section>

      <section className="card" id="entries">
        <h2>Time entries</h2>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Break (min)</th>
                <th>Hours</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={row.day}>
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
                      value={row.clock_in}
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
                      value={row.clock_out}
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
                      value={row.break_minutes}
                      onChange={(event) =>
                        updateRow(
                          index,
                          'break_minutes',
                          Number(event.target.value)
                        )
                      }
                    />
                  </td>

                  <td>
                    <strong>
                      {submitted
                        ? minutesToDecimalHours(
                            dailyMinutes[index]
                          )
                        : '—'}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {entryMode === 'manual' && (
          <div className="actions">
            <button
              className="btn primary"
              onClick={submitManual}
            >
              Submit
            </button>

            <button
              className="btn secondary"
              onClick={reset}
            >
              Reset
            </button>
          </div>
        )}

        {entryMode === 'upload' && (
          <div className="actions">
            <button
              className="btn secondary"
              onClick={reset}
            >
              Reset
            </button>
          </div>
        )}
      </section>

      {submitted && (
        <section className="card">
          <h2>Result</h2>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Summary</th>
                  <th>Hours</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  const minutes = dailyMinutes[index]

                  if (
                    !row.clock_in ||
                    !row.clock_out
                  ) {
                    return null
                  }

                  return (
                    <tr key={`result-${row.day}`}>
                      <td>
                        {row.day}
                      </td>

                      <td>
                        {row.clock_in}
                        {' - '}
                        {row.clock_out}

                        {row.break_minutes > 0 && (
                          <>
                            <br />
                            {row.break_minutes} minutes break
                          </>
                        )}
                      </td>

                      <td>
                        <strong>
                          {minutesToDecimalHours(minutes)}
                        </strong>
                      </td>
                    </tr>
                  )
                })}

                <tr>
                  <td />

                  <td>
                    <strong>
                      Weekly Total:
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {minutesToDecimalHours(
                        weeklyMinutes
                      )}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="actions">
            <button
              className="btn primary"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>How hours are calculated</h2>

        <p>
          Minutes are converted to decimal hours by dividing
          by 60. For example, 33 minutes equals 0.55 hours.
        </p>

        <p>
          Overnight shifts are supported automatically.
          For example, 6:40 PM to 7:13 AM continues into
          the following day.
        </p>
      </section>

      <footer className="footer">
        TimeCard Calculator
      </footer>
    </main>
  )
}
