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
  ocr_image?: string
  table_image?: string
}

const API = (
  process.env.NEXT_PUBLIC_API_URL ||
  'https://timecard-calculator-api.onrender.com'
).replace(/\/+$/, '')

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
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

function parseTime(
  value: string
): number | null {
  if (!value?.trim()) {
    return null
  }

  let text =
    normalizeTime(value)

  let meridiem = ''

  const meridiemMatch =
    text.match(/(AM|PM)$/)

  if (meridiemMatch) {
    meridiem =
      meridiemMatch[1]

    text =
      text.replace(
        /(AM|PM)$/,
        ''
      )
  }

  const match =
    text.match(
      /^(\d{1,2}):(\d{2})$/
    )

  if (!match) {
    return null
  }

  let hours =
    Number(match[1])

  const minutes =
    Number(match[2])

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null
  }

  if (meridiem) {
    if (
      hours < 1 ||
      hours > 12
    ) {
      return null
    }

    if (hours === 12) {
      hours = 0
    }

    if (
      meridiem === 'PM'
    ) {
      hours += 12
    }
  } else if (
    hours > 23
  ) {
    return null
  }

  return (
    hours * 60 +
    minutes
  )
}

function getShiftMinutes(
  clockIn: string,
  clockOut: string,
  breakMinutes = 0
) {
  const start =
    parseTime(clockIn)

  const end =
    parseTime(clockOut)

  if (
    start === null ||
    end === null
  ) {
    return 0
  }

  let duration =
    end - start

  if (duration < 0) {
    duration +=
      24 * 60
  }

  duration -= Math.max(
    0,
    Number(
      breakMinutes || 0
    )
  )

  return Math.max(
    0,
    duration
  )
}

function isPlausibleShift(
  clockIn: string,
  clockOut: string
) {
  const start =
    parseTime(clockIn)

  const end =
    parseTime(clockOut)

  if (
    start === null ||
    end === null
  ) {
    return false
  }

  let duration =
    end - start

  if (duration < 0) {
    duration +=
      24 * 60
  }

  if (
    duration < 15
  ) {
    return false
  }

  if (
    duration >
    20 * 60
  ) {
    return false
  }

  return true
}

function decimalHours(
  minutes: number
) {
  return (
    minutes / 60
  ).toFixed(2)
}

function hoursMinutes(
  minutes: number
) {
  const hours =
    Math.floor(
      minutes / 60
    )

  const mins =
    minutes % 60

  return `${hours}:${String(
    mins
  ).padStart(2, '0')}`
}

/* ======================================================
   DATE → WEEKDAY
====================================================== */

function dateToWeekday(
  dateText: string
): string | null {
  const match =
    dateText.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/
    )

  if (!match) {
    return null
  }

  const month =
    Number(match[1])

  const day =
    Number(match[2])

  let year =
    Number(match[3])

  if (year < 100) {
    year += 2000
  }

  const date =
    new Date(
      year,
      month - 1,
      day
    )

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null
  }

  const weekday =
    date.toLocaleDateString(
      'en-US',
      {
        weekday:
          'long',
      }
    )

  return DAYS.includes(
    weekday
  )
    ? weekday
    : null
}

/* ======================================================
   OCR HELPERS
====================================================== */

function normalizeDay(
  value: string
) {
  const day =
    value.toLowerCase()

  if (
    day.startsWith('sun')
  ) {
    return 'Sunday'
  }

  if (
    day.startsWith('mon')
  ) {
    return 'Monday'
  }

  if (
    day.startsWith('tue')
  ) {
    return 'Tuesday'
  }

  if (
    day.startsWith('wed')
  ) {
    return 'Wednesday'
  }

  if (
    day.startsWith('thu')
  ) {
    return 'Thursday'
  }

  if (
    day.startsWith('fri')
  ) {
    return 'Friday'
  }

  if (
    day.startsWith('sat')
  ) {
    return 'Saturday'
  }

  return value
}

function findTimes(
  text: string
) {
  const cleaned =
    text
      .replace(
        /[Oo]/g,
        '0'
      )
      .replace(
        /[Il]/g,
        '1'
      )
      .replace(
        /[–—−]/g,
        '-'
      )

  const matches =
    cleaned.match(
      /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
    ) || []

  return matches
    .map(
      normalizeTime
    )
    .filter(
      (time) =>
        parseTime(
          time
        ) !== null
    )
}

function detectLabel(
  text: string,
  index: number
) {
  const dayMatch =
    text.match(
      /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)\b/i
    )

  if (dayMatch) {
    return normalizeDay(
      dayMatch[1]
    )
  }

  const dateMatch =
    text.match(
      /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/
    )

  if (dateMatch) {
    const weekday =
      dateToWeekday(
        dateMatch[0]
      )

    if (weekday) {
      return weekday
    }
  }

  return `Shift ${
    index + 1
  }`
}

function detectBreak(
  text: string
) {
  const minuteMatch =
    text.match(
      /(?:break|meal|lunch)[^0-9]{0,20}(\d{1,3})\s*(?:min|mins|minutes)?/i
    )

  if (minuteMatch) {
    const value =
      Number(
        minuteMatch[1]
      )

    if (
      !Number.isNaN(
        value
      ) &&
      value >= 0 &&
      value <= 180
    ) {
      return value
    }
  }

  const timeMatch =
    text.match(
      /(\d{1,2})\s*:\s*(\d{2})\s*(?:break|meal|lunch)/i
    )

  if (timeMatch) {
    const hours =
      Number(
        timeMatch[1]
      )

    const minutes =
      Number(
        timeMatch[2]
      )

    const total =
      hours * 60 +
      minutes

    if (
      total >= 0 &&
      total <= 180
    ) {
      return total
    }
  }

  return 0
}

function detectPrintedHours(
  text: string
) {
  const patterns = [
    /daily\s*total\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    /hours?\s*(?:worked)?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    /total\s*hours?\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
  ]

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(
        pattern
      )

    if (!match) {
      continue
    }

    const value =
      Number(
        match[1]
      )

    if (
      !Number.isNaN(
        value
      ) &&
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
  sourceText: string,
  start: string,
  end: string
) {
  const normalizedStart =
    normalizeTime(start)

  const normalizedEnd =
    normalizeTime(end)

  if (
    !isPlausibleShift(
      normalizedStart,
      normalizedEnd
    )
  ) {
    return
  }

  const label =
    detectLabel(
      sourceText,
      result.length
    )

  const duplicate =
    result.some(
      (row) =>
        row.label ===
          label &&
        row.clock_in ===
          normalizedStart &&
        row.clock_out ===
          normalizedEnd
    )

  if (duplicate) {
    return
  }

  const breakMinutes =
    detectBreak(
      sourceText
    )

  const printedHours =
    detectPrintedHours(
      sourceText
    )

  const calculatedHours =
    getShiftMinutes(
      normalizedStart,
      normalizedEnd,
      breakMinutes
    ) / 60

  const needsReview =
    printedHours !==
      null &&
    Math.abs(
      calculatedHours -
        printedHours
    ) > 0.25

  result.push({
    label,

    clock_in:
      normalizedStart,

    clock_out:
      normalizedEnd,

    break_minutes:
      breakMinutes,

    printed_hours:
      printedHours,

    needs_review:
      needsReview,
  })
}

/* ======================================================
   BUILD SUNDAY → SATURDAY WEEK
====================================================== */

function buildWeeklyRows(
  detected: DetectedShift[]
): DetectedShift[] {
  const week =
    manualRows()

  for (
    const row
    of detected
  ) {
    const weekday =
      DAYS.find(
        (day) =>
          day.toLowerCase() ===
          row.label.toLowerCase()
      )

    if (!weekday) {
      continue
    }

    const index =
      DAYS.indexOf(
        weekday
      )

    week[index] = {
      ...row,
      label: weekday,
    }
  }

  return week
}

/* ======================================================
   UNIVERSAL PARSER
====================================================== */

function parseUniversalTimecard(
  text: string
) {
  const cleaned =
    text
      .replace(
        /\r/g,
        '\n'
      )
      .replace(
        /[–—−]/g,
        '-'
      )

  const lines =
    cleaned
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(
        Boolean
      )

  const detected:
    DetectedShift[] = []

  /* PASS 1 */
  for (
    const line
    of lines
  ) {
    const times =
      findTimes(line)

    if (
      times.length < 2
    ) {
      continue
    }

    for (
      let index = 0;
      index + 1 <
        times.length;
      index += 2
    ) {
      addCandidate(
        detected,
        line,
        times[index],
        times[
          index + 1
        ]
      )
    }
  }

  /* PASS 2 - always run */
  for (
    let index = 0;
    index <
      lines.length;
    index++
  ) {
    const block =
      lines
        .slice(
          index,
          index + 6
        )
        .join(' ')

    const hasDay =
      /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)\b/i.test(
        block
      )

    const hasDate =
      /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(
        block
      )

    if (
      !hasDay &&
      !hasDate
    ) {
      continue
    }

    const times =
      findTimes(block)

    if (
      times.length < 2
    ) {
      continue
    }

    for (
      let timeIndex = 0;
      timeIndex + 1 <
        times.length;
      timeIndex += 2
    ) {
      addCandidate(
        detected,
        block,
        times[
          timeIndex
        ],
        times[
          timeIndex + 1
        ]
      )
    }
  }

  /* PASS 3 */
  if (
    detected.length ===
    0
  ) {
    const allTimes =
      findTimes(
        cleaned
      )

    for (
      let index = 0;
      index + 1 <
        allTimes.length;
      index += 2
    ) {
      addCandidate(
        detected,
        '',
        allTimes[
          index
        ],
        allTimes[
          index + 1
        ]
      )
    }
  }

  return buildWeeklyRows(
    detected
  )
}

/* ======================================================
   BACKEND CONVERTER
====================================================== */

async function convertUploadedDocument(
  file: File
): Promise<
  ConvertedPage[]
> {
  const form =
    new FormData()

  form.append(
    'file',
    file
  )

  const response =
    await fetch(
      `${API}/convert-timecard`,
      {
        method:
          'POST',
        body: form,
      }
    )

  let data: any

  try {
    data =
      await response.json()
  } catch {
    throw new Error(
      'The document converter returned an invalid response.'
    )
  }

  if (
    !response.ok
  ) {
    throw new Error(
      data?.detail ||
        'Could not prepare this document.'
    )
  }

  if (
    !Array.isArray(
      data.pages
    ) ||
    data.pages.length ===
      0
  ) {
    throw new Error(
      'The document was converted, but no pages were returned.'
    )
  }

  return data.pages
}

/* ======================================================
   OCR
====================================================== */

async function recognizeConvertedPage(
  imageUrl: string
) {
  const Tesseract =
    await import(
      'tesseract.js'
    )

  const result =
    await Tesseract.recognize(
      imageUrl,
      'eng',
      {
        logger: (
          progress: any
        ) => {
          console.log(
            'OCR progress:',
            progress
          )
        },
      }
    )

  return (
    result.data.text ||
    ''
  )
}

/* ======================================================
   OCR ALL IMAGE VERSIONS
====================================================== */

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
    index <
      pages.length;
    index++
  ) {
    onProgress?.(
      index + 1,
      pages.length
    )

    const page =
      pages[index]

    const images = [
      page.table_image,
      page.ocr_image,
      page.image,
    ].filter(
      (
        value
      ): value is string =>
        Boolean(value)
    )

    const pageTexts:
      string[] = []

    for (
      const image
      of images
    ) {
      try {
        const text =
          await recognizeConvertedPage(
            image
          )

        if (
          text &&
          text.trim()
        ) {
          pageTexts.push(
            text.trim()
          )
        }
      } catch (
        error
      ) {
        console.warn(
          'OCR version failed:',
          error
        )
      }
    }

    fullText +=
      '\n' +
      pageTexts.join(
        '\n'
      )
  }

  return (
    fullText.trim()
  )
}

/* ======================================================
   PAGE
====================================================== */

export default function Home() {
  const [
    rows,
    setRows,
  ] =
    useState<
      DetectedShift[]
    >(
      manualRows()
    )

  const [
    mode,
    setMode,
  ] =
    useState<
      'manual' |
      'upload'
    >(
      'manual'
    )

  const [
    submitted,
    setSubmitted,
  ] =
    useState(false)

  const [
    message,
    setMessage,
  ] =
    useState('')

  const [
    readingFile,
    setReadingFile,
  ] =
    useState(false)

  const fileRef =
    useRef<
      HTMLInputElement
    >(null)

  /* EMPLOYEE */

  const [
    employeeName,
    setEmployeeName,
  ] =
    useState('')

  const [
    employeeId,
    setEmployeeId,
  ] =
    useState('')

  const [
    manager,
    setManager,
  ] =
    useState('')

  const [
    department,
    setDepartment,
  ] =
    useState('')

  /* PAY */

  const [
    hourlyRate,
    setHourlyRate,
  ] =
    useState('')

  const [
    currency,
    setCurrency,
  ] =
    useState('$')

  const [
    standardWeeklyHours,
    setStandardWeeklyHours,
  ] =
    useState('40')

  const [
    standardDailyHours,
    setStandardDailyHours,
  ] =
    useState('8')

  const [
    overtimeRule,
    setOvertimeRule,
  ] =
    useState<
      'none' |
      'weekly' |
      'daily'
    >(
      'none'
    )

  const [
    overtimeMultiplier,
    setOvertimeMultiplier,
  ] =
    useState('1.5')

  /* PAY PERIOD */

  const [
    weekStartDate,
    setWeekStartDate,
  ] =
    useState('')

  const [
    weekEndDate,
    setWeekEndDate,
  ] =
    useState('')

  const [
    payPeriod,
    setPayPeriod,
  ] =
    useState<
      'weekly' |
      'biweekly' |
      'semimonthly'
    >(
      'weekly'
    )

  const [
    notes,
    setNotes,
  ] =
    useState('')

  /* ======================================================
     TOTALS
  ====================================================== */

  const workedMinutes =
    useMemo(
      () =>
        rows.map(
          (row) =>
            getShiftMinutes(
              row.clock_in,
              row.clock_out,
              row.break_minutes
            )
        ),
      [rows]
    )

  const totalMinutes =
    useMemo(
      () =>
        workedMinutes.reduce(
          (
            total,
            value
          ) =>
            total +
            value,
          0
        ),
      [workedMinutes]
    )

  function updateRow(
    index: number,
    key:
      keyof DetectedShift,
    value: any
  ) {
    setRows(
      (current) =>
        current.map(
          (
            row,
            rowIndex
          ) =>
            rowIndex ===
            index
              ? {
                  ...row,
                  [key]:
                    value,
                }
              : row
        )
    )

    setSubmitted(
      false
    )
  }

  function startManual() {
    setRows(
      manualRows()
    )

    setMode(
      'manual'
    )

    setSubmitted(
      false
    )

    setMessage('')
  }

  /* ======================================================
     UPLOAD
  ====================================================== */

  async function upload(
    file?: File
  ) {
    if (!file) {
      return
    }

    setMode(
      'upload'
    )

    setSubmitted(
      false
    )

    setReadingFile(
      true
    )

    setMessage(
      'Preparing your timecard…'
    )

    try {
      const pages =
        await convertUploadedDocument(
          file
        )

      setMessage(
        `Document prepared. Reading ${pages.length} page(s)…`
      )

      const text =
        await readConvertedPages(
          pages,
          (
            current,
            total
          ) => {
            setMessage(
              `Reading timecard page ${current} of ${total}…`
            )
          }
        )

      console.log(
        'FULL OCR TEXT:',
        text
      )

      console.log(
        'OCR LENGTH:',
        text.length
      )

      console.log(
        'OCR TIMES:',
        findTimes(text)
      )

      if (
        !text ||
        text.trim().length <
          5
      ) {
        throw new Error(
          'The document was prepared successfully, but no readable text was detected.'
        )
      }

      const detected =
        parseUniversalTimecard(
          text
        )

      console.log(
        'DETECTED WEEK:',
        detected
      )

      const detectedCount =
        detected.filter(
          (row) =>
            row.clock_in &&
            row.clock_out
        ).length

      if (
        detectedCount ===
        0
      ) {
        setRows(
          manualRows()
        )

        setMode(
          'manual'
        )

        setMessage(
          'The document was read successfully, but reliable clock-in and clock-out pairs were not detected. Please enter or correct the shifts manually.'
        )

        return
      }

      setRows(
        detected
      )

      setSubmitted(
        true
      )

      const reviewCount =
        detected.filter(
          (row) =>
            row.clock_in &&
            row.clock_out &&
            row.needs_review
        ).length

      if (
        reviewCount >
        0
      ) {
        setMessage(
          `${detectedCount} workday(s) detected. ${reviewCount} row(s) should be reviewed before using the final total.`
        )
      } else {
        setMessage(
          `${detectedCount} workday(s) detected. Please verify the extracted times.`
        )
      }
    } catch (
      error: any
    ) {
      console.error(
        error
      )

      setRows(
        manualRows()
      )

      setMode(
        'manual'
      )

      setSubmitted(
        false
      )

      setMessage(
        error?.message ||
          'This timecard could not be processed automatically.'
      )
    } finally {
      setReadingFile(
        false
      )

      if (
        fileRef.current
      ) {
        fileRef.current.value =
          ''
      }
    }
  }

  /* ======================================================
     CALCULATE MANUAL
  ====================================================== */

  function calculateManual() {
    const completeRows =
      rows.filter(
        (row) =>
          row.clock_in.trim() &&
          row.clock_out.trim()
      )

    if (
      !completeRows.length
    ) {
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

  /* ======================================================
     RESET
  ====================================================== */

  function reset() {
    setRows(
      manualRows()
    )

    setMode(
      'manual'
    )

    setSubmitted(
      false
    )

    setMessage('')

    setEmployeeName('')
    setEmployeeId('')
    setManager('')
    setDepartment('')

    setHourlyRate('')
    setCurrency('$')

    setStandardWeeklyHours(
      '40'
    )

    setStandardDailyHours(
      '8'
    )

    setOvertimeRule(
      'none'
    )

    setOvertimeMultiplier(
      '1.5'
    )

    setWeekStartDate('')
    setWeekEndDate('')

    setPayPeriod(
      'weekly'
    )

    setNotes('')

    if (
      fileRef.current
    ) {
      fileRef.current.value =
        ''
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
          Upload a PDF, scanned timecard,
          screenshot, or photo, or enter your
          shifts manually. Uploaded documents are
          prepared automatically before work-time
          detection.
        </p>

        <div className="heroActions">

          <button
            className="primaryAction"
            disabled={
              readingFile
            }
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
            disabled={
              readingFile
            }
            onClick={
              startManual
            }
          >
            Enter Hours Manually
          </button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff"
            onChange={(
              event
            ) =>
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
            Review automatically detected shifts
            or enter start time, end time, and break
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
            <div>
              Day
            </div>

            <div>
              Clock In
            </div>

            <div>
              Clock Out
            </div>

            <div>
              Break
            </div>

            <div>
              Hours
            </div>
          </div>

          {rows.map(
            (
              row,
              index
            ) => (
              <div
                className="timeTableRow"
                key={
                  row.label
                }
              >

                <div className="shiftLabel">
                  {row.label}
                </div>

                <input
                  className="universalTimeInput"
                  value={
                    row.clock_in
                  }
                  placeholder="HH:MM"
                  onChange={(
                    event
                  ) =>
                    updateRow(
                      index,
                      'clock_in',
                      event.target.value
                    )
                  }
                />

                <input
                  className="universalTimeInput"
                  value={
                    row.clock_out
                  }
                  placeholder="HH:MM"
                  onChange={(
                    event
                  ) =>
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
                    value={
                      row.break_minutes
                    }
                    onChange={(
                      event
                    ) =>
                      updateRow(
                        index,
                        'break_minutes',
                        Number(
                          event.target.value
                        )
                      )
                    }
                  />

                  <span>
                    min
                  </span>

                </div>

                <div className="dailyHours">
                  {row.clock_in &&
                  row.clock_out
                    ? hoursMinutes(
                        workedMinutes[
                          index
                        ]
                      )
                    : '—'}
                </div>

              </div>
            )
          )}

        </div>

        <div className="employeeDetailsSection">

          <div className="detailsSectionHeader">
            <div>
              <span className="detailsSectionLabel">
                EMPLOYEE INFORMATION
              </span>

              <h3>
                Employee Details
              </h3>
            </div>
          </div>

          <div className="employeeFields">

            <label>
              <span>
                Employee Name
              </span>

              <input
                type="text"
                value={
                  employeeName
                }
                placeholder="e.g. John Smith"
                onChange={(
                  event
                ) =>
                  setEmployeeName(
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              <span>
                Employee ID
              </span>

              <input
                type="text"
                value={
                  employeeId
                }
                placeholder="e.g. 3256"
                onChange={(
                  event
                ) =>
                  setEmployeeId(
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              <span>
                Manager
              </span>

              <input
                type="text"
                value={
                  manager
                }
                placeholder="e.g. Jane Smith"
                onChange={(
                  event
                ) =>
                  setManager(
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              <span>
                Department
              </span>

              <input
                type="text"
                value={
                  department
                }
                placeholder="e.g. Engineering"
                onChange={(
                  event
                ) =>
                  setDepartment(
                    event.target.value
                  )
                }
              />
            </label>

          </div>

          <div className="detailsSubSection">

            <div className="detailsSectionHeader">
              <div>
                <span className="detailsSectionLabel">
                  PAY & OVERTIME
                </span>

                <h3>
                  Pay Configuration
                </h3>
              </div>
            </div>

            <div className="payConfigurationGrid">

              <label>
                <span>
                  Hourly Rate
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    hourlyRate
                  }
                  placeholder="50.00"
                  onChange={(
                    event
                  ) =>
                    setHourlyRate(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Currency
                </span>

                <select
                  value={
                    currency
                  }
                  onChange={(
                    event
                  ) =>
                    setCurrency(
                      event.target.value
                    )
                  }
                >
                  <option value="$">
                    $ USD
                  </option>

                  <option value="€">
                    € EUR
                  </option>

                  <option value="£">
                    £ GBP
                  </option>

                  <option value="C$">
                    C$ CAD
                  </option>

                  <option value="A$">
                    A$ AUD
                  </option>
                </select>
              </label>

              <label>
                <span>
                  Standard Weekly Hours
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={
                    standardWeeklyHours
                  }
                  onChange={(
                    event
                  ) =>
                    setStandardWeeklyHours(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Standard Daily Hours
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={
                    standardDailyHours
                  }
                  onChange={(
                    event
                  ) =>
                    setStandardDailyHours(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Overtime Rule
                </span>

                <select
                  value={
                    overtimeRule
                  }
                  onChange={(
                    event
                  ) =>
                    setOvertimeRule(
                      event.target.value as
                        | 'none'
                        | 'weekly'
                        | 'daily'
                    )
                  }
                >
                  <option value="none">
                    No Overtime
                  </option>

                  <option value="weekly">
                    Weekly Overtime
                  </option>

                  <option value="daily">
                    Daily Overtime
                  </option>
                </select>
              </label>

              <label>
                <span>
                  Overtime Multiplier
                </span>

                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={
                    overtimeMultiplier
                  }
                  disabled={
                    overtimeRule ===
                    'none'
                  }
                  onChange={(
                    event
                  ) =>
                    setOvertimeMultiplier(
                      event.target.value
                    )
                  }
                />
              </label>

            </div>

          </div>

          <div className="detailsSubSection">

            <div className="detailsSectionHeader">
              <div>
                <span className="detailsSectionLabel">
                  PAY PERIOD
                </span>

                <h3>
                  Period Details
                </h3>
              </div>
            </div>

            <div className="payPeriodGrid">

              <label>
                <span>
                  Week Start Date
                </span>

                <input
                  type="date"
                  value={
                    weekStartDate
                  }
                  onChange={(
                    event
                  ) =>
                    setWeekStartDate(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Week End Date
                </span>

                <input
                  type="date"
                  value={
                    weekEndDate
                  }
                  onChange={(
                    event
                  ) =>
                    setWeekEndDate(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Pay Period
                </span>

                <select
                  value={
                    payPeriod
                  }
                  onChange={(
                    event
                  ) =>
                    setPayPeriod(
                      event.target.value as
                        | 'weekly'
                        | 'biweekly'
                        | 'semimonthly'
                    )
                  }
                >
                  <option value="weekly">
                    Weekly
                  </option>

                  <option value="biweekly">
                    Biweekly
                  </option>

                  <option value="semimonthly">
                    Semi-monthly
                  </option>
                </select>
              </label>

            </div>

          </div>

          <div className="detailsSubSection">

            <label className="notesField">

              <span>
                Notes
              </span>

              <textarea
                rows={4}
                value={
                  notes
                }
                placeholder="Optional payroll notes, corrections, PTO, holiday, training, or other comments."
                onChange={(
                  event
                ) =>
                  setNotes(
                    event.target.value
                  )
                }
              />

            </label>

          </div>

        </div>

        <div className="calculatorActions">

          {mode ===
            'manual' && (
            <button
              className="calculateButton"
              onClick={
                calculateManual
              }
            >
              Calculate Hours
            </button>
          )}

          <button
            className="resetButton"
            onClick={
              reset
            }
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
                {hoursMinutes(
                  totalMinutes
                )}
              </strong>

              <span>
                {decimalHours(
                  totalMinutes
                )}{' '}
                decimal hours
              </span>

            </div>

          </div>

          <div className="summaryTable">

            <div className="summaryHeader">
              <div>
                Day
              </div>

              <div>
                Work Period
              </div>

              <div>
                Break
              </div>

              <div>
                Hours
              </div>
            </div>

            {rows.map(
              (
                row,
                index
              ) => {
                if (
                  !row.clock_in ||
                  !row.clock_out
                ) {
                  return null
                }

                return (
                  <div
                    className="summaryRow"
                    key={`summary-${row.label}`}
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
                        {hoursMinutes(
                          workedMinutes[
                            index
                          ]
                        )}
                      </strong>

                      <small>
                        {decimalHours(
                          workedMinutes[
                            index
                          ]
                        )}{' '}
                        decimal
                      </small>

                    </div>

                  </div>
                )
              }
            )}

          </div>

          <div className="resultsFooter">

            <div>
              <small>
                Total Weekly Hours
              </small>

              <strong>
                {hoursMinutes(
                  totalMinutes
                )}
              </strong>

              <span className="decimalTotal">
                {decimalHours(
                  totalMinutes
                )}{' '}
                decimal hours
              </span>
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
