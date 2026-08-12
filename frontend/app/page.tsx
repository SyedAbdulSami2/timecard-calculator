'use client'

import { useMemo, useRef, useState } from 'react'

type Meridiem = 'AM' | 'PM'

type TimeParts = {
  hour: string
  minute: string
  meridiem: Meridiem
}

type ShiftRow = {
  label: string
  start: TimeParts
  end: TimeParts
  breakHours: string
  breakMinutes: string
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

function emptyTime(): TimeParts {
  return {
    hour: '',
    minute: '',
    meridiem: 'AM',
  }
}

function defaultRows(): ShiftRow[] {
  return DAYS.map((day) => ({
    label: day,
    start: emptyTime(),
    end: {
      ...emptyTime(),
      meridiem: 'PM',
    },
    breakHours: '00',
    breakMinutes: '00',
  }))
}

function to24HourMinutes(time: TimeParts): number | null {
  const hour = Number(time.hour)
  const minute = Number(time.minute)

  if (
    !time.hour ||
    !time.minute ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  let h = hour

  if (time.meridiem === 'AM' && h === 12) {
    h = 0
  }

  if (time.meridiem === 'PM' && h !== 12) {
    h += 12
  }

  return h * 60 + minute
}

function getBreakMinutes(row: ShiftRow) {
  const hours = Number(row.breakHours || 0)
  const minutes = Number(row.breakMinutes || 0)

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    return 0
  }

  return Math.max(0, hours * 60 + minutes)
}

function getWorkedMinutes(row: ShiftRow) {
  const start = to24HourMinutes(row.start)
  const end = to24HourMinutes(row.end)

  if (start === null || end === null) {
    return 0
  }

  let minutes = end - start

  if (minutes < 0) {
    minutes += 24 * 60
  }

  minutes -= getBreakMinutes(row)

  return Math.max(0, minutes)
}

function decimalHours(minutes: number) {
  return (minutes / 60).toFixed(2)
}

function readableHours(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  return `${hours}:${String(mins).padStart(2, '0')}`
}

function normalizeDetectedTime(value: string) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')

  if (/^\d{3}$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  if (/^\d{4}$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  }

  return text
}

function parseDetectedTime(value: string): TimeParts | null {
  const text = normalizeDetectedTime(value)

  const match = text.match(
    /^(\d{1,2}):(\d{2})(AM|PM)?$/
  )

  if (!match) {
    return null
  }

  let hour = Number(match[1])
  const minute = Number(match[2])
  let meridiem = match[3] as Meridiem | undefined

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    minute > 59
  ) {
    return null
  }

  if (!meridiem) {
    if (hour > 23) {
      return null
    }

    if (hour === 0) {
      hour = 12
      meridiem = 'AM'
    } else if (hour === 12) {
      meridiem = 'PM'
    } else if (hour > 12) {
      hour -= 12
      meridiem = 'PM'
    } else {
      meridiem = 'AM'
    }
  }

  if (hour < 1 || hour > 12) {
    return null
  }

  return {
    hour: String(hour).padStart(2, '0'),
    minute: String(minute).padStart(2, '0'),
    meridiem,
  }
}

function detectAllTimes(text: string) {
  const cleaned = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/[–—−]/g, '-')

  const matches =
    cleaned.match(
      /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
    ) || []

  return matches
    .map(normalizeDetectedTime)
    .filter(Boolean)
}

function detectLabel(text: string, index: number) {
  const dayMatch = text.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/i
  )

  if (dayMatch) {
    const value = dayMatch[1].toLowerCase()

    if (value.startsWith('mon')) return 'Monday'
    if (value.startsWith('tue')) return 'Tuesday'
    if (value.startsWith('wed')) return 'Wednesday'
    if (value.startsWith('thu')) return 'Thursday'
    if (value.startsWith('fri')) return 'Friday'
    if (value.startsWith('sat')) return 'Saturday'
    if (value.startsWith('sun')) return 'Sunday'
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
  const match = text.match(
    /(?:break|meal)[^0-9]{0,15}(\d{1,3})\s*(?:min|mins|minutes)?/i
  )

  if (!match) {
    return 0
  }

  const value = Number(match[1])

  if (
    Number.isNaN(value) ||
    value < 0 ||
    value > 180
  ) {
    return 0
  }

  return value
}

function parseAnyTimecardText(text: string): ShiftRow[] {
  const cleaned = text
    .replace(/\r/g, '\n')
    .replace(/[–—−]/g, '-')

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const detected: ShiftRow[] = []

  for (const line of lines) {
    const times = detectAllTimes(line)

    if (times.length >= 2) {
      const start = parseDetectedTime(times[0])
      const end = parseDetectedTime(times[1])

      if (!start || !end) {
        continue
      }

      const breakTotal = detectBreak(line)

      detected.push({
        label: detectLabel(line, detected.length),
        start,
        end,
        breakHours: String(
          Math.floor(breakTotal / 60)
        ).padStart(2, '0'),
        breakMinutes: String(
          breakTotal % 60
        ).padStart(2, '0'),
      })
    }
  }

  if (detected.length === 0) {
    const allTimes = detectAllTimes(cleaned)

    for (
      let index = 0;
      index + 1 < allTimes.length;
      index += 2
    ) {
      const start = parseDetectedTime(allTimes[index])
      const end = parseDetectedTime(allTimes[index + 1])

      if (!start || !end) {
        continue
      }

      detected.push({
        label: `Shift ${detected.length + 1}`,
        start,
        end,
        breakHours: '00',
        breakMinutes: '00',
      })
    }
  }

  return detected
}

async function prepareImage(file: File) {
  const bitmap = await createImageBitmap(file)

  const scale = 2.5

  const canvas = document.createElement('canvas')

  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to process image.')
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

  const data = imageData.data

  for (
    let index = 0;
    index < data.length;
    index += 4
  ) {
    const gray = Math.round(
      data[index] * 0.299 +
        data[index + 1] * 0.587 +
        data[index + 2] * 0.114
    )

    const contrast =
      gray < 170
        ? Math.max(0, gray - 35)
        : Math.min(255, gray + 20)

    data[index] = contrast
    data[index + 1] = contrast
    data[index + 2] = contrast
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
    'eng'
  )

  return result.data.text || ''
}

async function runImageOcr(file: File) {
  const canvas = await prepareImage(file)
  return recognizeCanvas(canvas)
}

async function runPdfOcr(file: File) {
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

    const viewport = page.getViewport({
      scale: 2.5,
    })

    const canvas =
      document.createElement('canvas')

    const context =
      canvas.getContext('2d')

    if (!context) {
      continue
    }

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise

    allText +=
      '\n' +
      (await recognizeCanvas(canvas))
  }

  return allText
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
    'Please upload a PDF, JPG, JPEG, or PNG.'
  )
}

export default function Home() {
  const [rows, setRows] =
    useState<ShiftRow[]>(defaultRows())

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
      rows.map(getWorkedMinutes),
    [rows]
  )

  const totalMinutes = useMemo(
    () =>
      workedMinutes.reduce(
        (sum, value) => sum + value,
        0
      ),
    [workedMinutes]
  )

  function updateRow(
    index: number,
    updater: (row: ShiftRow) => ShiftRow
  ) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? updater(row)
          : row
      )
    )

    if (mode === 'manual') {
      setSubmitted(false)
    }
  }

  function startManual() {
    setMode('manual')
    setSubmitted(false)
    setMessage('')

    if (rows.length === 0) {
      setRows(defaultRows())
    }

    document
      .getElementById('calculator')
      ?.scrollIntoView({
        behavior: 'smooth',
      })
  }

  async function upload(file?: File) {
    if (!file) {
      return
    }

    setMode('upload')
    setSubmitted(false)
    setReadingFile(true)

    setMessage(
      'Reading your timecard and detecting work shifts…'
    )

    try {
      const text =
        await runBrowserOcr(file)

      console.log('OCR TEXT:', text)

      const detected =
        parseAnyTimecardText(text)

      if (detected.length === 0) {
        setRows(defaultRows())
        setMode('manual')

        setMessage(
          'The timecard was read, but complete shifts could not be detected. Please enter or correct the times manually.'
        )

        return
      }

      setRows(detected)
      setSubmitted(true)

      setMessage(
        `${detected.length} shift(s) detected. Please verify the extracted times.`
      )
    } catch (error: any) {
      console.error(error)

      setMode('manual')

      setMessage(
        error?.message ||
          'The timecard could not be read automatically.'
      )
    } finally {
      setReadingFile(false)

      if (fileRef.current) {
        fileRef.current.value = ''
      }
    }
  }

  function calculate() {
    const completed = rows.filter(
      (row) =>
        to24HourMinutes(row.start) !== null &&
        to24HourMinutes(row.end) !== null
    )

    if (completed.length === 0) {
      setMessage(
        'Please enter at least one complete work shift.'
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
    }, 100)
  }

  function reset() {
    setRows(defaultRows())
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
          Calculate daily and weekly work hours from
          clock-in and clock-out times. Account for
          breaks and overnight shifts, or upload a
          timecard to prefill detected entries.
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
          <div>
            <h2>
              Time Card Calculator
            </h2>

            <p>
              Enter start time, end time, and break
              duration for each workday.
            </p>
          </div>
        </div>

        {message && (
          <div className="statusNotice">
            {message}
          </div>
        )}

        <div className="timeTable">
          <div className="timeTableHeader">
            <div>Day / Shift</div>
            <div>Start Time</div>
            <div>End Time</div>
            <div>Break Duration</div>
            <div>Hours / Day</div>
          </div>

          {rows.map((row, index) => (
            <div
              className="timeTableRow"
              key={`${row.label}-${index}`}
            >
              <div className="shiftLabel">
                {row.label}
              </div>

              <TimePicker
                value={row.start}
                onChange={(value) =>
                  updateRow(
                    index,
                    (current) => ({
                      ...current,
                      start: value,
                    })
                  )
                }
              />

              <TimePicker
                value={row.end}
                onChange={(value) =>
                  updateRow(
                    index,
                    (current) => ({
                      ...current,
                      end: value,
                    })
                  )
                }
              />

              <div className="breakPicker">
                <input
                  value={row.breakHours}
                  maxLength={2}
                  inputMode="numeric"
                  onChange={(event) =>
                    updateRow(
                      index,
                      (current) => ({
                        ...current,
                        breakHours:
                          event.target.value.replace(
                            /\D/g,
                            ''
                          ),
                      })
                    )
                  }
                />

                <span>:</span>

                <input
                  value={row.breakMinutes}
                  maxLength={2}
                  inputMode="numeric"
                  onChange={(event) =>
                    updateRow(
                      index,
                      (current) => ({
                        ...current,
                        breakMinutes:
                          event.target.value.replace(
                            /\D/g,
                            ''
                          ),
                      })
                    )
                  }
                />
              </div>

              <div className="dailyHours">
                {to24HourMinutes(row.start) !== null &&
                to24HourMinutes(row.end) !== null
                  ? readableHours(
                      workedMinutes[index]
                    )
                  : '—'}
              </div>
            </div>
          ))}
        </div>

        <div className="calculatorActions">
          {mode === 'manual' && (
            <button
              className="calculateButton"
              onClick={calculate}
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
                Weekly Results
              </h2>
            </div>

            <div className="totalHoursBox">
              <small>
                Total Hours
              </small>

              <strong>
                {readableHours(totalMinutes)}
              </strong>

              <span>
                {decimalHours(totalMinutes)} decimal hours
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
                to24HourMinutes(row.start) === null ||
                to24HourMinutes(row.end) === null
              ) {
                return null
              }

              return (
                <div
                  className="summaryRow"
                  key={`summary-${row.label}-${index}`}
                >
                  <div>
                    <strong>
                      {row.label}
                    </strong>
                  </div>

                  <div>
                    {formatTime(row.start)}
                    {' → '}
                    {formatTime(row.end)}
                  </div>

                  <div>
                    {getBreakMinutes(row) > 0
                      ? `${getBreakMinutes(row)} min`
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

function TimePicker({
  value,
  onChange,
}: {
  value: TimeParts
  onChange: (value: TimeParts) => void
}) {
  return (
    <div className="timePicker">
      <input
        value={value.hour}
        maxLength={2}
        inputMode="numeric"
        placeholder="HH"
        onChange={(event) =>
          onChange({
            ...value,
            hour:
              event.target.value.replace(
                /\D/g,
                ''
              ),
          })
        }
      />

      <span>:</span>

      <input
        value={value.minute}
        maxLength={2}
        inputMode="numeric"
        placeholder="MM"
        onChange={(event) =>
          onChange({
            ...value,
            minute:
              event.target.value.replace(
                /\D/g,
                ''
              ),
          })
        }
      />

      <select
        value={value.meridiem}
        onChange={(event) =>
          onChange({
            ...value,
            meridiem:
              event.target.value as Meridiem,
          })
        }
      >
        <option value="AM">
          AM
        </option>

        <option value="PM">
          PM
        </option>
      </select>
    </div>
  )
}

function formatTime(time: TimeParts) {
  return `${time.hour}:${time.minute} ${time.meridiem}`
}
