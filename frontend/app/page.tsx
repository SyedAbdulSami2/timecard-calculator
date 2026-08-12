'use client'

import { useMemo, useRef, useState } from 'react'

type Row = {
  day: string
  clock_in: string
  clock_out: string
  break_minutes: number
  reported_hours?: number | null
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

const DAY_PATTERNS: Record<string, RegExp> = {
  Monday: /\b(?:mon|monday)\b/i,
  Tuesday: /\b(?:tue|tues|tuesday)\b/i,
  Wednesday: /\b(?:wed|wednesday)\b/i,
  Thursday: /\b(?:thu|thur|thurs|thursday)\b/i,
  Friday: /\b(?:fri|friday)\b/i,
  Saturday: /\b(?:sat|saturday)\b/i,
  Sunday: /\b(?:sun|sunday)\b/i,
}

const defaultRows = (): Row[] =>
  DAYS.map((day) => ({
    day,
    clock_in: '',
    clock_out: '',
    break_minutes: 0,
    reported_hours: null,
  }))

function parseTime(value: string): number | null {
  if (!value?.trim()) return null

  let text = value
    .trim()
    .toUpperCase()
    .replace(/[.]/g, ':')
    .replace(/\s+/g, '')

  let meridiem = ''
  const meridiemMatch = text.match(/(AM|PM)$/)

  if (meridiemMatch) {
    meridiem = meridiemMatch[1]
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

  if (hours > 12 && hours <= 23) {
    meridiem = ''
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null

    if (meridiem === 'AM' && hours === 12) hours = 0
    if (meridiem === 'PM' && hours !== 12) hours += 12
  } else if (hours < 0 || hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

function getWorkedMinutes(row: Row) {
  const start = parseTime(row.clock_in)
  const end = parseTime(row.clock_out)

  if (start === null || end === null) return 0

  let worked = end - start

  if (worked < 0) {
    worked += 24 * 60
  }

  worked -= Number(row.break_minutes || 0)

  return Math.max(0, worked)
}

function decimalHours(minutes: number) {
  return (minutes / 60).toFixed(2)
}

function readableHours(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`

  return `${hours}h ${mins}m`
}

/*
 * OCR cleanup.
 * Different timecard apps can produce:
 * 06:48, 06.48, 0648, 6:48 AM, 19:31, etc.
 */
function cleanOcrText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[–—−]/g, '-')
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[|]/g, '1')
}

function normalizeDetectedTime(value: string) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

  text = text.replace(/[.]/g, ':')

  if (/^\d{4}$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  } else if (/^\d{3}$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  return text
}

function extractDailyTotal(text: string) {
  const match = text.match(
    /(?:daily\s*total|total\s*(?:for\s*the\s*day|today))\s*:?\s*(\d+(?:\.\d+)?)/i
  )

  if (!match) return null

  const value = Number(match[1])

  if (!Number.isFinite(value) || value < 0 || value > 24) {
    return null
  }

  return value
}

function extractBreakMinutes(text: string) {
  const match = text.match(
    /(?:break|meal)[^0-9]{0,20}(\d{1,3})\s*(?:min|mins|minutes)?/i
  )

  if (!match) return 0

  const value = Number(match[1])

  if (!Number.isFinite(value) || value < 0 || value > 180) {
    return 0
  }

  return value
}

/*
 * Find a clock-in / clock-out pair.
 *
 * Accepted examples:
 * 06:48 - 19:31
 * 06.48 - 19.31
 * 0648 - 1931
 * 6:48 AM to 7:31 PM
 * 06:48 → 19:31
 */
function findTimeRange(text: string) {
  const normalized = cleanOcrText(text)

  const timeToken =
    String.raw`(?:\d{1,2}[:.]\d{2}\s*(?:AM|PM)?|\b\d{3,4}\b)`

  const rangePatterns = [
    new RegExp(
      `(${timeToken})\\s*(?:-|to|→|~)\\s*(${timeToken})`,
      'i'
    ),
    /(\d{1,2}\s*(?:AM|PM))\s*(?:-|to|→|~)\s*(\d{1,2}\s*(?:AM|PM))/i,
  ]

  for (const pattern of rangePatterns) {
    const match = normalized.match(pattern)

    if (!match) continue

    const start = normalizeDetectedTime(match[1])
    const end = normalizeDetectedTime(match[2])

    if (
      parseTime(start) !== null &&
      parseTime(end) !== null
    ) {
      return {
        clock_in: start,
        clock_out: end,
      }
    }
  }

  /*
   * Fallback for OCR that removes the dash/separator.
   */
  const tokenPattern =
    /(?:\b\d{1,2}[:.]\d{2}\s*(?:AM|PM)?\b|\b\d{3,4}\b)/gi

  const candidates = (normalized.match(tokenPattern) || [])
    .map(normalizeDetectedTime)
    .filter((value) => parseTime(value) !== null)

  for (let i = 0; i < candidates.length - 1; i += 1) {
    const start = candidates[i]
    const end = candidates[i + 1]

    if (
      parseTime(start) !== null &&
      parseTime(end) !== null &&
      start !== end
    ) {
      return {
        clock_in: start,
        clock_out: end,
      }
    }
  }

  return null
}

/*
 * Main OCR extractor.
 *
 * IMPORTANT FIX:
 * We no longer assume that the OCR text has a specific number of lines
 * around each weekday. Every weekday is treated as its own section, from
 * that weekday marker until the next weekday marker.
 *
 * This makes the parser much more tolerant of different timecard layouts.
 */
function extractMobileRows(rawText: string): Row[] {
  const rows = defaultRows()
  const text = cleanOcrText(rawText)

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const markers: Array<{
    day: string
    lineIndex: number
  }> = []

  lines.forEach((line, index) => {
    for (const day of DAYS) {
      if (DAY_PATTERNS[day].test(line)) {
        markers.push({
          day,
          lineIndex: index,
        })
        break
      }
    }
  })

  /*
   * Remove duplicate weekday detections caused by OCR repeating a label.
   */
  const uniqueMarkers: Array<{
    day: string
    lineIndex: number
  }> = []

  for (const marker of markers) {
    const previous =
      uniqueMarkers[uniqueMarkers.length - 1]

    if (
      previous &&
      previous.day === marker.day &&
      marker.lineIndex - previous.lineIndex <= 2
    ) {
      continue
    }

    uniqueMarkers.push(marker)
  }

  /*
   * PASS 1:
   * Parse the section belonging to each explicit weekday.
   */
  for (
    let i = 0;
    i < uniqueMarkers.length;
    i += 1
  ) {
    const marker = uniqueMarkers[i]
    const nextMarker = uniqueMarkers[i + 1]

    const start = Math.max(
      0,
      marker.lineIndex
    )

    const end = nextMarker
      ? nextMarker.lineIndex
      : lines.length

    const section = lines
      .slice(start, end)
      .join(' ')

    const rowIndex = DAYS.indexOf(marker.day)

    if (rowIndex < 0) continue

    const timeRange = findTimeRange(section)

    if (timeRange) {
      rows[rowIndex].clock_in =
        timeRange.clock_in

      rows[rowIndex].clock_out =
        timeRange.clock_out
    }

    const dailyTotal =
      extractDailyTotal(section)

    if (dailyTotal !== null) {
      rows[rowIndex].reported_hours =
        dailyTotal
    }

    const breakMinutes =
      extractBreakMinutes(section)

    if (breakMinutes > 0) {
      rows[rowIndex].break_minutes =
        breakMinutes
    }
  }

  /*
   * PASS 2:
   * Wider search around each weekday for screenshots where OCR places
   * the weekday and shift times on separate blocks.
   */
  for (const marker of uniqueMarkers) {
    const rowIndex = DAYS.indexOf(marker.day)

    if (rowIndex < 0) continue

    if (
      rows[rowIndex].clock_in &&
      rows[rowIndex].clock_out
    ) {
      continue
    }

    const windowStart = Math.max(
      0,
      marker.lineIndex - 2
    )

    const windowEnd = Math.min(
      lines.length,
      marker.lineIndex + 10
    )

    const nearbyText = lines
      .slice(windowStart, windowEnd)
      .join(' ')

    const timeRange =
      findTimeRange(nearbyText)

    if (timeRange) {
      rows[rowIndex].clock_in =
        timeRange.clock_in

      rows[rowIndex].clock_out =
        timeRange.clock_out
    }

    const dailyTotal =
      extractDailyTotal(nearbyText)

    if (
      dailyTotal !== null &&
      rows[rowIndex].reported_hours == null
    ) {
      rows[rowIndex].reported_hours =
        dailyTotal
    }

    const breakMinutes =
      extractBreakMinutes(nearbyText)

    if (
      breakMinutes > 0 &&
      rows[rowIndex].break_minutes === 0
    ) {
      rows[rowIndex].break_minutes =
        breakMinutes
    }
  }

  /*
   * PASS 3:
   * Last-resort fallback for screenshots where OCR completely misses
   * one or more weekday labels. We fill only rows that are still empty,
   * in the order the shift ranges appear in the OCR.
   */
  const rangePattern =
    /(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?|\b\d{3,4}\b)\s*(?:-|to|→|~)\s*(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?|\b\d{3,4}\b)/gi

  const ranges = [
    ...text.matchAll(rangePattern),
  ]
    .map((match) => ({
      clock_in:
        normalizeDetectedTime(match[1]),
      clock_out:
        normalizeDetectedTime(match[2]),
    }))
    .filter(
      (range) =>
        parseTime(range.clock_in) !== null &&
        parseTime(range.clock_out) !== null
    )

  let rangeCursor = 0

  for (
    let rowIndex = 0;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    if (
      rows[rowIndex].clock_in &&
      rows[rowIndex].clock_out
    ) {
      continue
    }

    while (rangeCursor < ranges.length) {
      const range =
        ranges[rangeCursor]

      rangeCursor += 1

      if (
        parseTime(range.clock_in) !== null &&
        parseTime(range.clock_out) !== null
      ) {
        rows[rowIndex].clock_in =
          range.clock_in

        rows[rowIndex].clock_out =
          range.clock_out

        break
      }
    }
  }

  return rows
}

async function preprocessImage(
  file: File
): Promise<HTMLCanvasElement> {
  const bitmap =
    await createImageBitmap(file)

  /*
   * Upscale mobile screenshots before OCR.
   */
  const scale = 3

  const canvas =
    document.createElement('canvas')

  canvas.width =
    bitmap.width * scale

  canvas.height =
    bitmap.height * scale

  const context =
    canvas.getContext('2d')

  if (!context) {
    throw new Error(
      'Could not prepare image.'
    )
  }

  context.drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const image =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )

  const pixels = image.data

  /*
   * Grayscale + stronger contrast improves recognition of small
   * numbers in mobile timecard screenshots.
   */
  for (
    let i = 0;
    i < pixels.length;
    i += 4
  ) {
    const gray =
      Math.round(
        pixels[i] * 0.299 +
        pixels[i + 1] * 0.587 +
        pixels[i + 2] * 0.114
      )

    const contrasted =
      gray < 160
        ? Math.max(
            0,
            gray - 45
          )
        : Math.min(
            255,
            gray + 25
          )

    pixels[i] =
      contrasted

    pixels[i + 1] =
      contrasted

    pixels[i + 2] =
      contrasted
  }

  context.putImageData(
    image,
    0,
    0
  )

  return canvas
}

async function ocrCanvas(
  canvas: HTMLCanvasElement
) {
  const Tesseract =
    await import('tesseract.js')

  const result =
    await Tesseract.recognize(
      canvas,
      'eng',
      {
        logger: (
          message: any
        ) => {
          console.log(
            'OCR:',
            message
          )
        },
      }
    )

  return (
    result.data.text ||
    ''
  )
}

async function runImageOcr(
  file: File
) {
  const canvas =
    await preprocessImage(
      file
    )

  return ocrCanvas(
    canvas
  )
}

async function runPdfOcr(
  file: File
) {
  const pdfjs =
    await import(
      'pdfjs-dist'
    )

  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

  const data =
    new Uint8Array(
      await file.arrayBuffer()
    )

  const pdf =
    await pdfjs.getDocument({
      data,
    }).promise

  let allText = ''

  for (
    let pageNumber = 1;
    pageNumber <=
    pdf.numPages;
    pageNumber += 1
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      )

    /*
     * First try embedded PDF text.
     */
    try {
      const textContent =
        await page.getTextContent()

      const embeddedText =
        textContent.items
          .map(
            (item: any) =>
              item.str || ''
          )
          .join(' ')
          .trim()

      if (
        embeddedText.length >
        30
      ) {
        allText +=
          `\n${embeddedText}`

        continue
      }
    } catch (error) {
      console.warn(
        'Embedded PDF text error:',
        error
      )
    }

    /*
     * Scanned PDF fallback.
     */
    try {
      const viewport =
        page.getViewport({
          scale: 2.5,
        })

      const canvas =
        document.createElement(
          'canvas'
        )

      const context =
        canvas.getContext(
          '2d'
        )

      if (!context) {
        continue
      }

      canvas.width =
        Math.ceil(
          viewport.width
        )

      canvas.height =
        Math.ceil(
          viewport.height
        )

      await page.render({
        canvas,
        canvasContext:
          context,
        viewport,
      }).promise

      allText +=
        `\n${await ocrCanvas(
          canvas
        )}`
    } catch (error) {
      console.warn(
        'PDF OCR error:',
        error
      )
    }
  }

  return allText
}

async function runBrowserOcr(
  file: File
) {
  const ext =
    file.name
      .toLowerCase()
      .split('.')
      .pop()

  if (
    [
      'jpg',
      'jpeg',
      'png',
    ].includes(ext || '')
  ) {
    return runImageOcr(
      file
    )
  }

  if (
    ext === 'pdf'
  ) {
    return runPdfOcr(
      file
    )
  }

  throw new Error(
    'Please upload a PDF, JPG, JPEG, or PNG.'
  )
}

export default function Home() {
  const [
    rows,
    setRows,
  ] =
    useState<Row[]>(
      defaultRows()
    )

  const [
    entryMode,
    setEntryMode,
  ] =
    useState<
      'upload' | 'manual'
    >('manual')

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
    useRef<HTMLInputElement>(
      null
    )

  const dailyMinutes =
    useMemo(
      () =>
        rows.map(
          getWorkedMinutes
        ),
      [rows]
    )

  const weeklyMinutes =
    useMemo(
      () =>
        dailyMinutes.reduce(
          (
            total,
            minutes
          ) =>
            total +
            minutes,
          0
        ),
      [dailyMinutes]
    )

  function updateRow(
    index: number,
    key: keyof Row,
    value:
      | string
      | number
      | null
  ) {
    if (
      entryMode ===
      'manual'
    ) {
      setSubmitted(
        false
      )
    }

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
  }

  function startManualEntry() {
    setEntryMode(
      'manual'
    )

    setSubmitted(
      false
    )

    setMessage('')

    document
      .getElementById(
        'entries'
      )
      ?.scrollIntoView({
        behavior:
          'smooth',
      })
  }

  async function upload(
    file?: File
  ) {
    if (!file) {
      return
    }

    setEntryMode(
      'upload'
    )

    setSubmitted(
      false
    )

    setReadingFile(
      true
    )

    setMessage(
      'Reading your timecard. This may take several seconds…'
    )

    try {
      const text =
        await runBrowserOcr(
          file
        )

      console.log(
        'OCR TEXT:',
        text
      )

      if (
        !text ||
        text.trim()
          .length < 10
      ) {
        throw new Error(
          'No readable text was detected.'
        )
      }

      const detectedRows =
        extractMobileRows(
          text
        )

      setRows(
        detectedRows
      )

      const detectedCount =
        detectedRows.filter(
          (row) =>
            row.clock_in &&
            row.clock_out
        ).length

      if (
        detectedCount >
        0
      ) {
        setMessage(
          `OCR detected ${detectedCount} worked day(s). Please verify the detected values.`
        )

        setSubmitted(
          true
        )

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
      } else {
        setMessage(
          'OCR completed, but the shift times were not clear enough. Please enter or correct them manually.'
        )

        setEntryMode(
          'manual'
        )
      }
    } catch (
      error: any
    ) {
      console.error(
        error
      )

      setRows(
        defaultRows()
      )

      setMessage(
        error?.message ||
          'The timecard could not be read automatically. Please enter the times manually.'
      )

      setEntryMode(
        'manual'
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

  function submitManual() {
    const completed =
      rows.filter(
        (row) =>
          row.clock_in.trim() &&
          row.clock_out.trim()
      )

    if (
      completed.length ===
      0
    ) {
      setMessage(
        'Please enter at least one Clock In and Clock Out.'
      )

      return
    }

    const invalid =
      completed.find(
        (row) =>
          parseTime(
            row.clock_in
          ) === null ||
          parseTime(
            row.clock_out
          ) === null
      )

    if (invalid) {
      setMessage(
        `Please check ${invalid.day}. Use time formats such as 6:40AM, 5:50PM, 06:40, or 17:50.`
      )

      return
    }

    setMessage('')

    setSubmitted(
      true
    )

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
      100
    )
  }

  function reset() {
    setRows(
      defaultRows()
    )

    setEntryMode(
      'manual'
    )

    setSubmitted(
      false
    )

    setMessage('')

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

  return (
    <main className="calculatorPage">
      <section className="topBar">
        <div className="brandBlock">
          <div className="brandIcon">
            TC
          </div>

          <div>
            <div className="brandTitle">
              TimeCard Calculator
            </div>

            <div className="brandSubtitle">
              Simple weekly hour calculations
            </div>
          </div>
        </div>

        <div className="privacyBadge">
          No account required
        </div>
      </section>

      <section className="heroCard">
        <div className="heroContent">
          <span className="eyebrow">
            WEEKLY HOURS
          </span>

          <h1>
            Calculate your timecard
          </h1>

          <p>
            Upload a screenshot,
            photo, or PDF of your
            timecard, or enter your
            shifts manually.
          </p>

          <div className="heroActions">
            <button
              className="primaryButton"
              disabled={
                readingFile
              }
              onClick={() =>
                fileRef.current?.click()
              }
            >
              {readingFile
                ? 'Reading Timecard…'
                : 'Upload Timecard'}
            </button>

            <button
              className="secondaryButton"
              disabled={
                readingFile
              }
              onClick={
                startManualEntry
              }
            >
              Enter Manually
            </button>

            <input
              ref={fileRef}
              hidden
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(
                event
              ) =>
                upload(
                  event.target
                    .files?.[0]
                )
              }
            />
          </div>
        </div>

        <div className="heroStat">
          <span>
            Supports
          </span>

          <strong>
            Screenshots & photos
          </strong>

          <small>
            Plus PDF timecards
          </small>
        </div>
      </section>

      <section
        className="mainCard"
        id="entries"
      >
        <div className="sectionHeading">
          <span className="sectionLabel">
            TIME ENTRIES
          </span>

          <h2>
            Weekly shifts
          </h2>

          <p>
            Review OCR values or
            enter times manually.
          </p>
        </div>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="desktopTable">
          <div className="tableHeader">
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
            ) => {
              const minutes =
                dailyMinutes[
                  index
                ]

              return (
                <div
                  className="timeRow"
                  key={
                    row.day
                  }
                >
                  <div className="dayCell">
                    {
                      row.day
                    }
                  </div>

                  <input
                    className="timeInput"
                    value={
                      row.clock_in
                    }
                    placeholder="e.g. 06:48"
                    onChange={(
                      event
                    ) =>
                      updateRow(
                        index,
                        'clock_in',
                        event.target
                          .value
                      )
                    }
                  />

                  <input
                    className="timeInput"
                    value={
                      row.clock_out
                    }
                    placeholder="e.g. 19:31"
                    onChange={(
                      event
                    ) =>
                      updateRow(
                        index,
                        'clock_out',
                        event.target
                          .value
                      )
                    }
                  />

                  <div className="breakInputWrap">
                    <input
                      className="timeInput"
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
                            event.target
                              .value
                          )
                        )
                      }
                    />

                    <span>
                      min
                    </span>
                  </div>

                  <div className="hoursPreview">
                    {row.clock_in &&
                    row.clock_out
                      ? decimalHours(
                          minutes
                        )
                      : '—'}

                    {row.reported_hours !=
                      null && (
                      <small
                        style={{
                          display:
                            'block',
                          fontWeight:
                            400,
                          opacity:
                            0.65,
                          marginTop:
                            3,
                        }}
                      >
                        Card:{' '}
                        {row.reported_hours.toFixed(
                          2
                        )}
                      </small>
                    )}
                  </div>
                </div>
              )
            }
          )}
        </div>

        {entryMode ===
          'manual' && (
          <div className="formActions">
            <button
              className="primaryButton"
              onClick={
                submitManual
              }
            >
              Calculate Hours
            </button>

            <button
              className="secondaryButton"
              onClick={
                reset
              }
            >
              Reset
            </button>
          </div>
        )}

        {entryMode ===
          'upload' && (
          <div className="formActions">
            <button
              className="secondaryButton"
              onClick={
                reset
              }
            >
              Reset
            </button>
          </div>
        )}
      </section>

      {submitted && (
        <section
          className="resultCard"
          id="results"
        >
          <div className="resultHeader">
            <div>
              <span className="sectionLabel">
                RESULTS
              </span>

              <h2>
                Weekly Summary
              </h2>
            </div>

            <div className="weeklyTotalHero">
              <span>
                Weekly Total
              </span>

              <strong>
                {decimalHours(
                  weeklyMinutes
                )}
              </strong>

              <small>
                {readableHours(
                  weeklyMinutes
                )}
              </small>
            </div>
          </div>

          <div className="resultTable">
            <div className="resultTableHeader">
              <div>
                Day
              </div>

              <div>
                Shift
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

                const minutes =
                  dailyMinutes[
                    index
                  ]

                return (
                  <div
                    className="resultRow"
                    key={`result-${row.day}`}
                  >
                    <div>
                      <strong>
                        {
                          row.day
                        }
                      </strong>
                    </div>

                    <div>
                      {
                        row.clock_in
                      }
                      {' → '}
                      {
                        row.clock_out
                      }
                    </div>

                    <div>
                      {row.break_minutes >
                      0
                        ? `${row.break_minutes} min`
                        : '—'}
                    </div>

                    <div className="resultHours">
                      <strong>
                        {decimalHours(
                          minutes
                        )}
                      </strong>

                      <small>
                        {readableHours(
                          minutes
                        )}
                      </small>
                    </div>
                  </div>
                )
              }
            )}
          </div>

          <div className="resultFooter">
            <div>
              <span>
                Total weekly hours
              </span>

              <strong>
                {decimalHours(
                  weeklyMinutes
                )}{' '}
                hours
              </strong>
            </div>

            <button
              className="primaryButton"
              onClick={() =>
                window.print()
              }
            >
              Print Summary
            </button>
          </div>
        </section>
      )}

      <section className="infoGrid">
        <div className="infoCard">
          <span className="infoNumber">
            01
          </span>

          <h3>
            Decimal hours
          </h3>

          <p>
            33 minutes divided by
            60 equals 0.55 hours.
          </p>
        </div>

        <div className="infoCard">
          <span className="infoNumber">
            02
          </span>

          <h3>
            Overnight shifts
          </h3>

          <p>
            Shifts continuing into
            the following day are
            calculated automatically.
          </p>
        </div>

        <div className="infoCard">
          <span className="infoNumber">
            03
          </span>

          <h3>
            OCR review
          </h3>

          <p>
            Always verify OCR-detected
            times before relying on the
            final result.
          </p>
        </div>
      </section>

      <footer className="siteFooter">
        TimeCard Calculator
      </footer>
    </main>
  )
}
