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
   TIME PARSING
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
    if (hours < 1 || hours > 12) {
      return null
    }

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

  // Overnight
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

  // Reject status-bar times / identical values / OCR noise
  if (duration < 15) {
    return false
  }

  // Reject unlikely shift pairings
  if (duration > 20 * 60) {
    return false
  }

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
   OCR TEXT PARSING
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
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/
  )

  if (dateMatch) {
    return dateMatch[0]
  }

  return `Shift ${index + 1}`
}

function detectBreak(text: string) {
  const patterns = [
    /(?:break|meal)[^0-9]{0,20}(\d{1,3})\s*(?:min|mins|minutes)?/i,
    /(\d{1,2})\s*:\s*(\d{2})\s*(?:break|meal)/i,
  ]

  const first = text.match(patterns[0])

  if (first) {
    const value = Number(first[1])

    if (value >= 0 && value <= 180) {
      return value
    }
  }

  const second = text.match(patterns[1])

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
    /hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    /total\s*hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
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

  /*
   * PASS 1
   * Strongest case:
   * two times on the same OCR line.
   */
  for (const line of lines) {
    const times = findTimes(line)

    if (times.length >= 2) {
      addCandidate(
        detected,
        line,
        times[0],
        times[1]
      )
    }
  }

  /*
   * PASS 2
   * Timecard rows frequently span multiple OCR lines.
   */
  for (let i = 0; i < lines.length; i++) {
    const block = lines
      .slice(i, i + 6)
      .join(' ')

    const times = findTimes(block)

    if (times.length < 2) continue

    for (
      let timeIndex = 0;
      timeIndex + 1 < times.length;
      timeIndex += 2
    ) {
      addCandidate(
        detected,
        block,
        times[timeIndex],
        times[timeIndex + 1]
      )
    }
  }

  /*
   * PASS 3
   * No labels/dates/rows at all.
   * Pair valid times in reading order.
   */
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
   IMAGE OCR
====================================================== */

async function prepareImage(file: File) {
  const bitmap = await createImageBitmap(file)

  const scale = 3

  const canvas = document.createElement('canvas')

  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Could not prepare the image.')
  }

  context.drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  )

  const pixels = imageData.data

  for (
    let i = 0;
    i < pixels.length;
    i += 4
  ) {
    const gray = Math.round(
      pixels[i] * 0.299 +
        pixels[i + 1] * 0.587 +
        pixels[i + 2] * 0.114
    )

    const value =
      gray < 175
        ? Math.max(0, gray - 45)
        : Math.min(255, gray + 25)

    pixels[i] = value
    pixels[i + 1] = value
    pixels[i + 2] = value
  }

  context.putImageData(
    imageData,
    0,
    0
  )

  return canvas
}

async function recognizeCanvas(
  canvas: HTMLCanvasElement
) {
  const Tesseract = await import('tesseract.js')

  const result = await Tesseract.recognize(
    canvas,
    'eng',
    {
      logger: (message: any) => {
        console.log('OCR:', message)
      },
    }
  )

  return result.data.text || ''
}

async function runImageOcr(file: File) {
  const canvas = await prepareImage(file)

  return recognizeCanvas(canvas)
}

/* ======================================================
   PDF OCR
====================================================== */

async function runPdfOcr(file: File) {
  const pdfjs = await import('pdfjs-dist')

  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

  const bytes = new Uint8Array(
    await file.arrayBuffer()
  )

  let pdf: any

  try {
    pdf = await pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: true,
      isEvalSupported: false,
    }).promise
  } catch (error) {
    console.error('PDF load error:', error)

    throw new Error(
      'This PDF could not be opened in the browser. Try saving the page as an image (JPG/PNG) and upload it again.'
    )
  }

  let resultText = ''

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page = await pdf.getPage(pageNumber)

    /*
     * First get normal PDF text.
     */
    try {
      const content = await page.getTextContent()

      const embeddedText = content.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim()

      if (embeddedText.length > 80) {
        resultText += `\n${embeddedText}`
      }
    } catch {
      // Ignore and continue with rendered OCR.
    }

    /*
     * Always render scanned/document page as well.
     */
    try {
      const viewport = page.getViewport({
        scale: 3,
      })

      const canvas =
        document.createElement('canvas')

      const context =
        canvas.getContext('2d')

      if (!context) continue

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise

      const pageText =
        await recognizeCanvas(canvas)

      resultText += `\n${pageText}`
    } catch (error) {
      console.warn(
        `OCR failed on PDF page ${pageNumber}`,
        error
      )
    }
  }

  return resultText.trim()
}

async function runBrowserOcr(file: File) {
  const extension = file.name
    .toLowerCase()
    .split('.')
    .pop()

  if (
    ['jpg', 'jpeg', 'png'].includes(
      extension || ''
    )
  ) {
    return runImageOcr(file)
  }

  if (extension === 'pdf') {
    return runPdfOcr(file)
  }

  throw new Error(
    'Supported uploads are PDF, JPG, JPEG, and PNG.'
  )
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

    if (mode === 'manual') {
      setSubmitted(false)
    }
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
      'Reading the document and detecting work shifts…'
    )

    try {
      const text =
        await runBrowserOcr(file)

      console.log(
        'FULL OCR TEXT:',
        text
      )

      if (
        !text ||
        text.trim().length < 5
      ) {
        throw new Error(
          'No readable information was detected in this document.'
        )
      }

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
          'The document was read, but no reliable clock-in/clock-out pairs were detected. Please enter or correct the shifts manually.'
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
          `${detected.length} shift(s) detected. ${reviewCount} row(s) differ from the hours printed on the timecard and should be reviewed.`
        )
      } else {
        setMessage(
          `${detected.length} shift(s) detected. Please verify the extracted values before using the total.`
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

      setMode('manual')
      setRows(manualRows())

      setMessage(
        error?.message ||
          'This timecard could not be read automatically.'
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
  }

  function reset() {
    setRows(manualRows())
    setMode('manual')
    setSubmitted(false)
    setMessage('')
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
          Upload a PDF, scanned timecard, screenshot,
          or photo, or enter shifts manually. The
          calculator detects work periods, handles
          overnight shifts and breaks, and converts
          worked time into decimal hours.
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
              ? 'Reading Timecard…'
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
            accept=".pdf,.jpg,.jpeg,.png"
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
            Review automatically detected shifts or
            enter start time, end time, and break
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
                    Card: {row.printed_hours.toFixed(2)}
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
