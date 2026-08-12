'use client'

import { useMemo, useRef, useState } from 'react'

type DetectedShift = {
  label: string
  clock_in: string
  clock_out: string
  break_minutes: number
  printed_hours?: number | null
  needs_review?: boolean
}

type ConvertedPage = {
  page_number: number
  width: number
  height: number
  image: string
}

const API =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://timecard-calculator-api.onrender.com'

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

function manualRows(): DetectedShift[] {
  return DAYS.map((day) => ({
    label: day,
    clock_in: '',
    clock_out: '',
    break_minutes: 0,
    printed_hours: null,
    needs_review: false,
  }))
}

/* ======================================================
   TIME HELPERS
====================================================== */

function normalizeTime(value: string) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/\./g, ':')
    .replace(/\s+/g, '')

  if (/^\d{3}$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  if (/^\d{4}$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  }

  return text
}

function parseTime(value: string): number | null {
  if (!value?.trim()) return null

  let text = normalizeTime(value)
  let meridiem = ''

  const meridiemMatch = text.match(/(AM|PM)$/)

  if (meridiemMatch) {
    meridiem = meridiemMatch[1]
    text = text.replace(/(AM|PM)$/, '')
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/)

  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2])

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    minutes > 59
  ) {
    return null
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null

    if (hours === 12) {
      hours = 0
    }

    if (meridiem === 'PM') {
      hours += 12
    }
  } else if (hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

function getShiftMinutes(
  clockIn: string,
  clockOut: string,
  breakMinutes = 0
) {
  const start = parseTime(clockIn)
  const end = parseTime(clockOut)

  if (start === null || end === null) {
    return 0
  }

  let duration = end - start

  if (duration < 0) {
    duration += 24 * 60
  }

  duration -= Math.max(0, breakMinutes)

  return Math.max(0, duration)
}

function isPlausibleShift(
  clockIn: string,
  clockOut: string
) {
  const start = parseTime(clockIn)
  const end = parseTime(clockOut)

  if (start === null || end === null) {
    return false
  }

  let duration = end - start

  if (duration < 0) {
    duration += 24 * 60
  }

  if (duration < 15) return false
  if (duration > 20 * 60) return false

  return true
}

function decimalHours(minutes: number) {
  return (minutes / 60).toFixed(2)
}

function readableHours(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (!hours) return `${mins}m`
  if (!mins) return `${hours}h`

  return `${hours}h ${mins}m`
}

/* ======================================================
   UNIVERSAL OCR PARSING
====================================================== */

function findTimes(text: string) {
  const cleaned = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/[–—−]/g, '-')

  const matches =
    cleaned.match(
      /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
    ) || []

  return matches
    .map(normalizeTime)
    .filter((time) => parseTime(time) !== null)
}

function detectLabel(text: string, index: number) {
  const dayMatch = text.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/i
  )

  if (dayMatch) {
    const day = dayMatch[1].toLowerCase()

    if (day.startsWith('mon')) return 'Monday'
    if (day.startsWith('tue')) return 'Tuesday'
    if (day.startsWith('wed')) return 'Wednesday'
    if (day.startsWith('thu')) return 'Thursday'
    if (day.startsWith('fri')) return 'Friday'
    if (day.startsWith('sat')) return 'Saturday'
    if (day.startsWith('sun')) return 'Sunday'
  }

  const dateMatch = text.match(
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/
  )

  if (dateMatch) {
    return dateMatch[0]
  }

  return `Shift ${index + 1}`
}

function detectBreak(text: string) {
  const first = text.match(
    /(?:break|meal)[^0-9]{0,20}(\d{1,3})\s*(?:min|mins|minutes)?/i
  )

  if (first) {
    const value = Number(first[1])

    if (value >= 0 && value <= 180) {
      return value
    }
  }

  const second = text.match(
    /(\d{1,2})\s*:\s*(\d{2})\s*(?:break|meal)/i
  )

  if (second) {
    const hours = Number(second[1])
    const minutes = Number(second[2])

    const total = hours * 60 + minutes

    if (total <= 180) {
      return total
    }
  }

  return 0
}

function detectPrintedHours(text: string) {
  const patterns = [
    /daily\s*total\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    /total\s*hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    /hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)

    if (!match) continue

    const value = Number(match[1])

    if (
      !Number.isNaN(value) &&
      value >= 0 &&
      value <= 24
    ) {
      return value
    }
  }

  return null
}

function addCandidate(
  result: DetectedShift[],
  text: string,
  start: string,
  end: string
) {
  if (!isPlausibleShift(start, end)) {
    return
  }

  const normalizedStart = normalizeTime(start)
  const normalizedEnd = normalizeTime(end)

  const duplicate = result.some(
    (row) =>
      row.clock_in === normalizedStart &&
      row.clock_out === normalizedEnd
  )

  if (duplicate) return

  const breakMinutes = detectBreak(text)
  const printedHours = detectPrintedHours(text)

  const calculated =
    getShiftMinutes(
      normalizedStart,
      normalizedEnd,
      breakMinutes
    ) / 60

  const needsReview =
    printedHours !== null &&
    Math.abs(calculated - printedHours) > 0.25

  result.push({
    label: detectLabel(text, result.length),
    clock_in: normalizedStart,
    clock_out: normalizedEnd,
    break_minutes: breakMinutes,
    printed_hours: printedHours,
    needs_review: needsReview,
  })
}

function parseUniversalTimecard(text: string) {
  const cleaned = text
    .replace(/\r/g, '\n')
    .replace(/[–—−]/g, '-')

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const detected: DetectedShift[] = []

  // Pass 1: same OCR line
  for (const line of lines) {
    const times = findTimes(line)

    if (times.length >= 2) {
      for (let i = 0; i + 1 < times.length; i += 2) {
        addCandidate(
          detected,
          line,
          times[i],
          times[i + 1]
        )
      }
    }
  }

  // Pass 2: nearby OCR lines
  if (detected.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const block = lines
        .slice(i, i + 4)
        .join(' ')

      const times = findTimes(block)

      if (times.length < 2) continue

      for (let j = 0; j + 1 < times.length; j += 2) {
        addCandidate(
          detected,
          block,
          times[j],
          times[j + 1]
        )
      }
    }
  }

  // Pass 3: completely unlabeled document
  if (detected.length === 0) {
    const allTimes = findTimes(cleaned)

    for (
      let index = 0;
      index + 1 < allTimes.length;
      index += 2
    ) {
      addCandidate(
        detected,
        '',
        allTimes[index],
        allTimes[index + 1]
      )
    }
  }

  return detected.map((row, index) => ({
    ...row,
    label:
      row.label.startsWith('Shift ')
        ? `Shift ${index + 1}`
        : row.label,
  }))
}

/* ======================================================
   BACKEND CONVERTER
====================================================== */

async function convertUploadedDocument(
  file: File
): Promise<ConvertedPage[]> {
  const form = new FormData()

  form.append('file', file)

  const response = await fetch(
    `${API}/convert-timecard`,
    {
      method: 'POST',
      body: form,
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.detail ||
        'Could not prepare this document.'
    )
  }

  if (
    !Array.isArray(data.pages) ||
    data.pages.length === 0
  ) {
    throw new Error(
      'The document was converted, but no pages were returned.'
    )
  }

  return data.pages
}

/* ======================================================
   OCR CONVERTED PAGES
====================================================== */

async function recognizeConvertedPage(
  imageUrl: string
) {
  const Tesseract = await import('tesseract.js')

  const result = await Tesseract.recognize(
    imageUrl,
    'eng',
    {
      logger: (progress: any) => {
        console.log('OCR:', progress)
      },
    }
  )

  return result.data.text || ''
}

async function readConvertedPages(
  pages: ConvertedPage[],
  onProgress?: (
    current: number,
    total: number
  ) => void
) {
  let fullText = ''

  for (
    let index = 0;
    index < pages.length;
    index++
  ) {
    onProgress?.(
      index + 1,
      pages.length
    )

    const text =
      await recognizeConvertedPage(
        pages[index].image
      )

    fullText += `\n${text}`
  }

  return fullText.trim()
}

/* ======================================================
   PAGE
====================================================== */

export default function Home() {
  const [rows, setRows] =
    useState<DetectedShift[]>(manualRows())

  const [mode, setMode] =
    useState<'manual' | 'upload'>('manual')

  const [submitted, setSubmitted] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [readingFile, setReadingFile] =
    useState(false)

  const fileRef =
    useRef<HTMLInputElement>(null)

  const workedMinutes = useMemo(
    () =>
      rows.map((row) =>
        getShiftMinutes(
          row.clock_in,
          row.clock_out,
          row.break_minutes
        )
      ),
    [rows]
  )

  const totalMinutes = useMemo(
    () =>
      workedMinutes.reduce(
        (total, value) =>
          total + value,
        0
      ),
    [workedMinutes]
  )

  function updateRow(
    index: number,
    key: keyof DetectedShift,
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

    setSubmitted(false)
  }

  function startManual() {
    setRows(manualRows())
    setMode('manual')
    setSubmitted(false)
    setMessage('')

    setTimeout(() => {
      document
        .getElementById('calculator')
        ?.scrollIntoView({
          behavior: 'smooth',
        })
    }, 50)
  }

  async function upload(file?: File) {
    if (!file) return

    setMode('upload')
    setSubmitted(false)
    setReadingFile(true)

    setMessage(
      'Preparing your timecard…'
    )

    try {
      // STEP 1: backend converts source document
      const pages =
        await convertUploadedDocument(file)

      setMessage(
        `Document prepared. Reading ${pages.length} page(s)…`
      )

      // STEP 2: OCR standardized images
      const text =
        await readConvertedPages(
          pages,
          (current, total) => {
            setMessage(
              `Reading timecard page ${current} of ${total}…`
            )
          }
        )

      console.log(
        'FULL OCR TEXT:',
        text
      )

      if (
        !text ||
        text.trim().length < 5
      ) {
        throw new Error(
          'The document was prepared successfully, but no readable text was detected.'
        )
      }

      // STEP 3: normalize into shifts
      const detected =
        parseUniversalTimecard(text)

      console.log(
        'DETECTED SHIFTS:',
        detected
      )

      if (!detected.length) {
        setRows(manualRows())
        setMode('manual')

        setMessage(
          'The timecard was read, but reliable work-time pairs were not detected. Please enter or correct the values manually.'
        )

        return
      }

      setRows(detected)
      setSubmitted(true)

      const reviewCount =
        detected.filter(
          (row) =>
            row.needs_review
        ).length

      if (reviewCount > 0) {
        setMessage(
          `${detected.length} shift(s) detected. ${reviewCount} should be reviewed before using the final total.`
        )
      } else {
        setMessage(
          `${detected.length} shift(s) detected. Please verify the extracted times.`
        )
      }

      setTimeout(() => {
        document
          .getElementById('results')
          ?.scrollIntoView({
            behavior: 'smooth',
          })
      }, 150)
    } catch (error: any) {
      console.error(error)

      setRows(manualRows())
      setMode('manual')

      setMessage(
        error?.message ||
          'This timecard could not be processed automatically.'
      )
    } finally {
      setReadingFile(false)

      if (fileRef.current) {
        fileRef.current.value = ''
      }
    }
  }

  function calculateManual() {
    const completeRows =
      rows.filter(
        (row) =>
          row.clock_in.trim() &&
          row.clock_out.trim()
      )

    if (!completeRows.length) {
      setMessage(
        'Please enter at least one complete work shift.'
      )

      return
    }

    const invalid =
      completeRows.find(
        (row) =>
          !isPlausibleShift(
            row.clock_in,
            row.clock_out
          )
      )

    if (invalid) {
      setMessage(
        `Please check ${invalid.label}. The start and end times do not form a valid shift.`
      )

      return
    }

    setMessage('')
    setSubmitted(true)

    setTimeout(() => {
      document
        .getElementById('results')
        ?.scrollIntoView({
          behavior: 'smooth',
        })
    }, 50)
  }

  function reset() {
    setRows(manualRows())
    setMode('manual')
    setSubmitted(false)
    setMessage('')

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  return (
    <main className="pageShell">
      <section className="pageHero">
        <div className="heroBadge">
          FREE WORK HOURS CALCULATOR
        </div>

        <h1>
          Time Card Calculator

          <span>
            Calculate Work Hours Accurately
          </span>
        </h1>

        <p>
          Upload a PDF, scan, screenshot, or photo,
          or enter shifts manually. Uploaded
          documents are prepared automatically
          before work-time detection.
        </p>

        <div className="heroActions">
          <button
            className="primaryAction"
            disabled={readingFile}
            onClick={() =>
              fileRef.current?.click()
            }
          >
            {readingFile
              ? 'Processing Timecard…'
              : 'Upload Timecard'}
          </button>

          <button
            className="secondaryAction"
            disabled={readingFile}
            onClick={startManual}
          >
            Enter Hours Manually
          </button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff"
            onChange={(event) =>
              upload(
                event.target.files?.[0]
              )
            }
          />
        </div>
      </section>

      <section
        className="calculatorCard"
        id="calculator"
      >
        <div className="calculatorCardHeader">
          <h2>
            Time Card Calculator
          </h2>

          <p>
            Review detected shifts or enter
            start time, end time, and break
            duration manually.
          </p>
        </div>

        {message && (
          <div className="statusNotice">
            {message}
          </div>
        )}

        <div className="timeTable">
          <div className="timeTableHeader">
            <div>Day / Shift</div>
            <div>Clock In</div>
            <div>Clock Out</div>
            <div>Break</div>
            <div>Hours</div>
          </div>

          {rows.map((row, index) => (
            <div
              className="timeTableRow"
              key={`${row.label}-${index}`}
            >
              <div className="shiftLabel">
                {row.label}

                {row.needs_review && (
                  <small
                    style={{
                      display: 'block',
                      color: '#9a6818',
                      marginTop: 3,
                    }}
                  >
                    Review
                  </small>
                )}
              </div>

              <input
                className="universalTimeInput"
                value={row.clock_in}
                placeholder="06:48"
                onChange={(event) =>
                  updateRow(
                    index,
                    'clock_in',
                    event.target.value
                  )
                }
              />

              <input
                className="universalTimeInput"
                value={row.clock_out}
                placeholder="19:31"
                onChange={(event) =>
                  updateRow(
                    index,
                    'clock_out',
                    event.target.value
                  )
                }
              />

              <div className="breakField">
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={row.break_minutes}
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

                <span>min</span>
              </div>

              <div className="dailyHours">
                {row.clock_in &&
                row.clock_out
                  ? decimalHours(
                      workedMinutes[index]
                    )
                  : '—'}

                {row.printed_hours != null && (
                  <small
                    style={{
                      display: 'block',
                      fontSize: 10,
                      marginTop: 3,
                      color: '#7a8d8b',
                    }}
                  >
                    Card:{' '}
                    {row.printed_hours.toFixed(2)}
                  </small>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="calculatorActions">
          {mode === 'manual' && (
            <button
              className="calculateButton"
              onClick={calculateManual}
            >
              Calculate Hours
            </button>
          )}

          <button
            className="resetButton"
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </section>

      {submitted && (
        <section
          className="resultsCard"
          id="results"
        >
          <div className="resultsHeading">
            <div>
              <span>
                WORK HOURS SUMMARY
              </span>

              <h2>
                Calculated Results
              </h2>
            </div>

            <div className="totalHoursBox">
              <small>
                Total Hours
              </small>

              <strong>
                {decimalHours(totalMinutes)}
              </strong>

              <span>
                {readableHours(totalMinutes)}
              </span>
            </div>
          </div>

          <div className="summaryTable">
            <div className="summaryHeader">
              <div>Day / Shift</div>
              <div>Work Period</div>
              <div>Break</div>
              <div>Hours</div>
            </div>

            {rows.map((row, index) => {
              if (
                !row.clock_in ||
                !row.clock_out
              ) {
                return null
              }

              return (
                <div
                  className="summaryRow"
                  key={`summary-${index}`}
                >
                  <div>
                    <strong>
                      {row.label}
                    </strong>
                  </div>

                  <div>
                    {row.clock_in}
                    {' → '}
                    {row.clock_out}
                  </div>

                  <div>
                    {row.break_minutes
                      ? `${row.break_minutes} min`
                      : '—'}
                  </div>

                  <div className="summaryHours">
                    <strong>
                      {decimalHours(
                        workedMinutes[index]
                      )}
                    </strong>

                    <small>
                      {readableHours(
                        workedMinutes[index]
                      )}
                    </small>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="resultsFooter">
            <div>
              <small>
                Total Weekly Hours
              </small>

              <strong>
                {decimalHours(totalMinutes)} hours
              </strong>
            </div>

            <button
              onClick={() =>
                window.print()
              }
            >
              Print Summary
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
