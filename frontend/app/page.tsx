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
  full_ocr_image?: string
  ocr_image?: string
  table_image?: string
  upper_table_image?: string
  source_width?: number
  source_height?: number
  full_ocr_width?: number
  full_ocr_height?: number
  ocr_width?: number
  ocr_height?: number
  table_width?: number
  table_height?: number
  upper_table_width?: number
  upper_table_height?: number
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

/* ======================================================
   EMPTY WEEK
====================================================== */

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
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
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
   DAY HELPERS
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

/* ======================================================
   FIND TIMES
====================================================== */

function findTimes(
  text: string
) {
  const cleaned = text
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[;,]/g, ':')
    .replace(/[–—−]/g, '-')

  const candidates =
    cleaned.match(
      /(?:\b\d{1,2}\s*[:.]\s*\d{2}\b|\b\d{3,4}\b)\s*(?:A\s*M|P\s*M|AM|PM)?/g
    ) || []

  const result:
    string[] = []

  for (
    const candidate
    of candidates
  ) {
    let value =
      candidate
        .replace(
          /\s+/g,
          ''
        )
        .replace(
          '.',
          ':'
        )
        .replace(
          /A\s*M/i,
          'AM'
        )
        .replace(
          /P\s*M/i,
          'PM'
        )

    const threeDigit =
      value.match(
        /^(\d)(\d{2})(AM|PM)?$/
      )

    if (threeDigit) {
      value =
        `${threeDigit[1]}:${threeDigit[2]}${threeDigit[3] || ''}`
    }

    const fourDigit =
      value.match(
        /^(\d{2})(\d{2})(AM|PM)?$/
      )

    if (fourDigit) {
      value =
        `${fourDigit[1]}:${fourDigit[2]}${fourDigit[3] || ''}`
    }

    const normalized =
      normalizeTime(
        value
      )

    if (
      parseTime(
        normalized
      ) !== null
    ) {
      result.push(
        normalized
      )
    }
  }

  return result
}

/* ======================================================
   DETECT LABEL
====================================================== */

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

  return `Shift ${index + 1}`
}

/* ======================================================
   BREAK
====================================================== */

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

/* ======================================================
   PRINTED HOURS
====================================================== */

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

/* ======================================================
   ADD DETECTED SHIFT
====================================================== */

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
   BUILD WEEK
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
      label:
        weekday,
    }
  }

  return week
}

/* ======================================================
   HIGH-RESOLUTION OCR
====================================================== */

type OcrSource = {
  label: string
  image: string
}

async function recognizeImageSource(
  source: OcrSource,
  pageNumber: number
) {
  const Tesseract =
    await import(
      'tesseract.js'
    )

  /*
   * PASS 1
   * General OCR reads weekday/date labels and printed text.
   */
  const general =
    await Tesseract.recognize(
      source.image,
      'eng',
      {
        logger: (
          progress: any
        ) => {
          if (
            progress.status ===
            'recognizing text'
          ) {
            console.log(
              `General OCR page ${pageNumber} / ${source.label}:`,
              Math.round(
                (
                  progress.progress ||
                  0
                ) * 100
              ),
              '%'
            )
          }
        },
      }
    )

  /*
   * PASS 2
   * Restricted OCR gives Tesseract a much smaller alphabet
   * for clock values and dates.
   */
  const timeWorker =
    await Tesseract.createWorker(
      'eng'
    )

  try {
    await timeWorker.setParameters({
      tessedit_char_whitelist:
        '0123456789:/.-AMPamp ',

      preserve_interword_spaces:
        '1',

      user_defined_dpi:
        '300',
    })

    const timeResult =
      await timeWorker.recognize(
        source.image
      )

    const generalText =
      general.data.text ||
      ''

    const timeText =
      timeResult.data.text ||
      ''

    console.log(
      `GENERAL OCR page ${pageNumber} / ${source.label}:`,
      generalText
    )

    console.log(
      `TIME OCR page ${pageNumber} / ${source.label}:`,
      timeText
    )

    return [
      generalText,
      timeText,
    ]
      .filter(Boolean)
      .join('\n')
      .trim()
  } finally {
    await timeWorker.terminate()
  }
}

function getPageOcrSources(
  page: ConvertedPage
): OcrSource[] {
  const candidates: Array<
    OcrSource | null
  > = [
    page.table_image
      ? {
          label: 'table',
          image: page.table_image,
        }
      : null,

    page.upper_table_image
      ? {
          label: 'upper-table',
          image: page.upper_table_image,
        }
      : null,

    page.ocr_image
      ? {
          label: 'timecard',
          image: page.ocr_image,
        }
      : null,

    page.full_ocr_image
      ? {
          label: 'full-ocr',
          image: page.full_ocr_image,
        }
      : null,

    page.image
      ? {
          label: 'preview',
          image: page.image,
        }
      : null,
  ]

  const unique: OcrSource[] = []
  const seen =
    new Set<string>()

  for (
    const candidate
    of candidates
  ) {
    if (!candidate) {
      continue
    }

    if (
      seen.has(
        candidate.image
      )
    ) {
      continue
    }

    seen.add(
      candidate.image
    )

    unique.push(
      candidate
    )
  }

  return unique
}

/* ======================================================
   READ CONVERTED PAGES
====================================================== */

async function readConvertedPages(
  pages: ConvertedPage[],
  onProgress?: (
    current: number,
    total: number
  ) => void
) {
  const allTexts:
    string[] = []

  for (
    let pageIndex = 0;
    pageIndex <
      pages.length;
    pageIndex++
  ) {
    const page =
      pages[
        pageIndex
      ]

    onProgress?.(
      pageIndex + 1,
      pages.length
    )

    const sources =
      getPageOcrSources(
        page
      )

    let pageDetectedTimes = 0

    for (
      let sourceIndex = 0;
      sourceIndex <
        sources.length;
      sourceIndex++
    ) {
      const source =
        sources[
          sourceIndex
        ]

      /*
       * The backend now returns high-resolution PNG crops.
       * OCR those directly. Do not resize/threshold them again
       * in the browser because that previously destroyed thin
       * digits and colons.
       */
      try {
        const text =
          await recognizeImageSource(
            source,
            pageIndex + 1
          )

        if (
          text &&
          text.trim()
        ) {
          const sourceTimes =
            findTimes(
              text
            )

          pageDetectedTimes +=
            sourceTimes.length

          console.log(
            `OCR TIMES page ${pageIndex + 1} / ${source.label}:`,
            sourceTimes
          )

          allTexts.push(
            [
              `OCR_REGION_page-${pageIndex + 1}-${source.label}`,
              text.trim(),
              'END_OCR_REGION',
            ].join('\n')
          )
        }
      } catch (
        error
      ) {
        console.warn(
          `Could not OCR page ${pageIndex + 1} / ${source.label}:`,
          error
        )
      }

      /*
       * Preview JPEG is only a final fallback.
       * If the high-resolution sources already produced
       * several clock-like values, skip the preview.
       */
      const nextSource =
        sources[
          sourceIndex + 1
        ]

      if (
        nextSource?.label ===
          'preview' &&
        pageDetectedTimes >= 4
      ) {
        break
      }
    }
  }

  return allTexts.join(
    '\n\n'
  )
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

  const detected:
    DetectedShift[] = []

  /*
   * ================================================
   * PASS 1
   * Parse individual OCR regions.
   * ================================================
   */

  const regionMatches =
    cleaned.match(
      /OCR_REGION_[^\n]+\n([\s\S]*?)\nEND_OCR_REGION/g
    ) || []

  for (
    const regionBlock
    of regionMatches
  ) {
    const regionText =
      regionBlock
        .replace(
          /^OCR_REGION_[^\n]+\n/,
          ''
        )
        .replace(
          /\nEND_OCR_REGION$/,
          ''
        )
        .trim()

    if (!regionText) {
      continue
    }

    const times =
      findTimes(
        regionText
      )

    console.log(
      'REGION TEXT:',
      regionText
    )

    console.log(
      'REGION TIMES:',
      times
    )

    if (
      times.length <
      2
    ) {
      continue
    }

    /*
     * Test every adjacent pair.
     */
    for (
      let index = 0;
      index + 1 <
        times.length;
      index++
    ) {
      const start =
        times[
          index
        ]

      const end =
        times[
          index + 1
        ]

      if (
        !isPlausibleShift(
          start,
          end
        )
      ) {
        continue
      }

      addCandidate(
        detected,
        regionText,
        start,
        end
      )

      break
    }
  }

  /*
   * ================================================
   * PASS 2
   * Normal individual lines.
   * ================================================
   */

  const lines =
    cleaned
      .replace(
        /OCR_REGION_[^\n]+/g,
        ''
      )
      .replace(
        /END_OCR_REGION/g,
        ''
      )
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(
        Boolean
      )

  for (
    const line
    of lines
  ) {
    const times =
      findTimes(
        line
      )

    if (
      times.length <
      2
    ) {
      continue
    }

    for (
      let index = 0;
      index + 1 <
        times.length;
      index++
    ) {
      const start =
        times[
          index
        ]

      const end =
        times[
          index + 1
        ]

      if (
        !isPlausibleShift(
          start,
          end
        )
      ) {
        continue
      }

      addCandidate(
        detected,
        line,
        start,
        end
      )

      break
    }
  }

  /*
   * ================================================
   * PASS 3
   * Nearby lines with day/date.
   * ================================================
   */

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
          index + 7
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
      findTimes(
        block
      )

    if (
      times.length <
      2
    ) {
      continue
    }

    for (
      let timeIndex = 0;
      timeIndex + 1 <
        times.length;
      timeIndex++
    ) {
      const start =
        times[
          timeIndex
        ]

      const end =
        times[
          timeIndex + 1
        ]

      if (
        !isPlausibleShift(
          start,
          end
        )
      ) {
        continue
      }

      addCandidate(
        detected,
        block,
        start,
        end
      )

      break
    }
  }

  console.log(
    'ALL RAW DETECTED ROWS:',
    detected
  )

  return buildWeeklyRows(
    detected
  )
}

/* ======================================================
   BACKEND CONVERTER
====================================================== */

async function convertUploadedDocument(
  file: File
): Promise<ConvertedPage[]> {
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

        body:
          form,
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
    useState(
      false
    )

  const [
    message,
    setMessage,
  ] =
    useState(
      ''
    )

  const [
    readingFile,
    setReadingFile,
  ] =
    useState(
      false
    )

  const fileRef =
    useRef<HTMLInputElement>(
      null
    )

  /* ======================================================
     EMPLOYEE
  ====================================================== */

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

  /* ======================================================
     PAY
  ====================================================== */

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

  /* ======================================================
     PAY PERIOD
  ====================================================== */

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
          (
            row
          ) =>
            getShiftMinutes(
              row.clock_in,
              row.clock_out,
              row.break_minutes
            )
        ),
      [
        rows,
      ]
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
      [
        workedMinutes,
      ]
    )

  /* ======================================================
     UPDATE ROW
  ====================================================== */

  function updateRow(
    index: number,
    key:
      keyof DetectedShift,
    value: any
  ) {
    setRows(
      (
        current
      ) =>
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

  /* ======================================================
     MANUAL
  ====================================================== */

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

    setMessage(
      ''
    )

    setTimeout(
      () => {
        document
          .getElementById(
            'calculator'
          )
          ?.scrollIntoView({
            behavior:
              'smooth',
          })
      },
      50
    )
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
        findTimes(
          text
        )
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
          (
            row
          ) =>
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

        setSubmitted(
          false
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
          (
            row
          ) =>
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

      setTimeout(
        () => {
          document
            .getElementById(
              'results'
            )
            ?.scrollIntoView({
              behavior:
                'smooth',
            })
        },
        150
      )
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
        (
          row
        ) =>
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
        (
          row
        ) =>
          !isPlausibleShift(
            row.clock_in,
            row.clock_out
          )
      )

    if (
      invalid
    ) {
      setMessage(
        `Please check ${invalid.label}. The start and end times do not form a valid shift.`
      )

      return
    }

    setMessage(
      ''
    )

    setSubmitted(
      true
    )
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

    setMessage(
      ''
    )

    setEmployeeName(
      ''
    )

    setEmployeeId(
      ''
    )

    setManager(
      ''
    )

    setDepartment(
      ''
    )

    setHourlyRate(
      ''
    )

    setCurrency(
      '$'
    )

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

    setWeekStartDate(
      ''
    )

    setWeekEndDate(
      ''
    )

    setPayPeriod(
      'weekly'
    )

    setNotes(
      ''
    )

    if (
      fileRef.current
    ) {
      fileRef.current.value =
        ''
    }
  }

  return (
    <main className="pageShell">

      {/* HERO */}

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
            ref={
              fileRef
            }
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

      {/* CALCULATOR */}

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

        {/* TIME TABLE */}

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

        {/* EMPLOYEE DETAILS */}

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

          {/* PAY */}

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

          {/* PAY PERIOD */}

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

          {/* NOTES */}

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

        {/* ACTIONS */}

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

      {/* RESULTS */}

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
