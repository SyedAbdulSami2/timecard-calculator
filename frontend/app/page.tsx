'use client'

import {
  useMemo,
  useRef,
  useState,
} from 'react'

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
  if (!value?.trim()) {
    return null
  }

  let text = value
    .trim()
    .toUpperCase()
    .replace(/[.\u2024]/g, ':')
    .replace(/\s+/g, '')

  text = text
    .replace(/O/g, '0')
    .replace(/I(?=\d)/g, '1')
    .replace(/L(?=\d)/g, '1')

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

    if (parts.length !== 2) {
      return null
    }

    hours = Number(parts[0])
    minutes = Number(parts[1])
  } else {
    const digits = text.replace(/\D/g, '')

    if (digits.length === 3) {
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

    if (meridiem === 'AM' && hours === 12) {
      hours = 0
    }

    if (meridiem === 'PM' && hours !== 12) {
      hours += 12
    }
  } else if (hours < 0 || hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

function getWorkedMinutes(row: Row) {
  const start = parseTime(row.clock_in)
  const end = parseTime(row.clock_out)

  if (start === null || end === null) {
    return 0
  }

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

  if (hours === 0) {
    return `${mins}m`
  }

  if (mins === 0) {
    return `${hours}h`
  }

  return `${hours}h ${mins}m`
}

/*
 * OCR cleanup.
 *
 * We intentionally DO NOT globally replace every O with 0 because
 * doing that can damage words such as "Monday".
 */
function cleanOcrText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[–—−]/g, '-')
    .replace(/[|]/g, ' ')
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/(?<=\d)[Il](?=\d)/g, '1')
    .replace(/[ \t]+/g, ' ')
}

/*
 * Converts OCR variants into a usable time.
 */
function normalizeDetectedTime(value: string) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')

  text = text
    .replace(/[;,.]/g, ':')
    .replace(/[^0-9:APM]/g, '')

  if (/^\d{4}(?:AM|PM)$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  }

  if (/^\d{3}(?:AM|PM)$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  if (/^\d{4}$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  }

  if (/^\d{3}$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  return text
}

/*
 * A time token should look like an actual clock time.
 *
 * This deliberately rejects decimal values such as:
 * 12.72
 * 25.72
 * 38.63
 *
 * Those are hours, not clock times.
 */
function isLikelyTimeToken(value: string) {
  const normalized = normalizeDetectedTime(value)
  return parseTime(normalized) !== null
}

/*
 * Finds all time ranges in text.
 *
 * Supported examples:
 * 06:48 - 19:31
 * 6:48 AM - 7:31 PM
 * 0648 - 1931
 * 648 AM - 731 PM
 * 06:48 to 19:31
 * 1st: 06:48 - 19:31
 */
function findAllTimeRanges(text: string) {
  const normalizedText = cleanOcrText(text)

  const patterns = [
    /(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?)\s*(?:-|~|to|–|—)\s*(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?)/gi,

    /(\d{3,4}\s*(?:AM|PM)?)\s*(?:-|~|to|–|—)\s*(\d{3,4}\s*(?:AM|PM)?)/gi,

    /(\d{1,2}\s*(?:AM|PM))\s*(?:-|~|to|–|—)\s*(\d{1,2}\s*(?:AM|PM))/gi,
  ]

  const ranges: {
    clock_in: string
    clock_out: string
    startMinute: number
    endMinute: number
    raw: string
  }[] = []

  for (const pattern of patterns) {
    let match: RegExpExecArray | null

    while ((match = pattern.exec(normalizedText)) !== null) {
      const clockIn = normalizeDetectedTime(match[1])
      const clockOut = normalizeDetectedTime(match[2])

      const startMinute = parseTime(clockIn)
      const endMinute = parseTime(clockOut)

      if (
        startMinute === null ||
        endMinute === null ||
        !isLikelyTimeToken(clockIn) ||
        !isLikelyTimeToken(clockOut)
      ) {
        continue
      }

      ranges.push({
        clock_in: clockIn,
        clock_out: clockOut,
        startMinute,
        endMinute,
        raw: match[0],
      })
    }
  }

  return dedupeTimeRanges(ranges)
}

function dedupeTimeRanges(
  ranges: ReturnType<typeof findAllTimeRanges>
) {
  const seen = new Set<string>()

  return ranges.filter((range) => {
    const key = `${range.clock_in}|${range.clock_out}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

/*
 * Converts OCR lines into a more useful stream.
 *
 * OCR sometimes returns:
 *
 * 1st:
 * 06:48
 * -
 * 19:31
 *
 * So we create overlapping groups of nearby lines.
 */
function buildTextWindows(lines: string[]) {
  const windows: {
    text: string
    start: number
    end: number
  }[] = []

  const windowSizes = [1, 2, 3, 4, 5, 7, 9, 12]

  for (let i = 0; i < lines.length; i++) {
    for (const size of windowSizes) {
      const end = Math.min(
        lines.length,
        i + size
      )

      windows.push({
        text: lines.slice(i, end).join(' '),
        start: i,
        end,
      })
    }
  }

  return windows
}

/*
 * Extracts a daily total such as:
 *
 * Daily total: 12.72
 * Total: 12.72
 * Hours: 12.72
 */
function extractDailyTotal(text: string) {
  const patterns = [
    /daily\s*total\s*:?\s*(\d+(?:\.\d+)?)/i,
    /(?:daily|worked|regular|total)\s*(?:hours?|hrs?)?\s*:?\s*(\d+(?:\.\d+)?)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)

    if (!match) {
      continue
    }

    const value = Number(match[1])

    if (
      Number.isNaN(value) ||
      value < 0 ||
      value > 24
    ) {
      continue
    }

    return value
  }

  return null
}

function extractBreakMinutes(text: string) {
  const match = text.match(
    /(?:break|meal|lunch|unpaid)[^0-9]{0,20}(\d{1,3})\s*(?:min|mins|minutes)?/i
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

function calculateRangeMinutes(
  clockIn: string,
  clockOut: string
) {
  const start = parseTime(clockIn)
  const end = parseTime(clockOut)

  if (start === null || end === null) {
    return null
  }

  let minutes = end - start

  if (minutes < 0) {
    minutes += 24 * 60
  }

  return minutes
}

/*
 * Scores a time range against a reported daily total.
 *
 * Example:
 *
 * 06:48 -> 19:31
 * = 12h 43m
 * = 12.72 decimal hours
 *
 * If the card says Daily total 12.72,
 * this range receives a very high score.
 */
function scoreTimeRange(
  range: {
    clock_in: string
    clock_out: string
  },
  reportedHours: number | null
) {
  const minutes = calculateRangeMinutes(
    range.clock_in,
    range.clock_out
  )

  if (minutes === null) {
    return -999
  }

  let score = 10

  /*
   * Normal healthcare shifts usually fall
   * between 4 and 18 hours.
   */
  if (minutes >= 240 && minutes <= 18 * 60) {
    score += 15
  }

  if (reportedHours !== null) {
    const calculatedHours =
      minutes / 60

    const difference =
      Math.abs(
        calculatedHours -
          reportedHours
      )

    if (difference < 0.02) {
      score += 100
    } else if (difference < 0.05) {
      score += 80
    } else if (difference < 0.15) {
      score += 50
    } else if (difference < 0.5) {
      score += 15
    } else {
      score -= 10
    }
  }

  return score
}

/*
 * Finds the best time range for a particular day.
 *
 * We look around the day label instead of requiring
 * the time range to be on the exact same OCR line.
 */
function findBestRangeForDay(
  lines: string[],
  day: string
) {
  const pattern = DAY_PATTERNS[day]

  const dayIndexes: number[] = []

  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      dayIndexes.push(index)
    }
  })

  if (dayIndexes.length === 0) {
    return null
  }

  let best:
    | {
        clock_in: string
        clock_out: string
        score: number
        reportedHours: number | null
      }
    | null = null

  for (const dayIndex of dayIndexes) {
    /*
     * Search a generous area around the day.
     *
     * This handles different card layouts where
     * the day, shift, and total may be separated.
     */
    const start = Math.max(
      0,
      dayIndex - 2
    )

    const end = Math.min(
      lines.length,
      dayIndex + 16
    )

    const localLines =
      lines.slice(start, end)

    const localText =
      localLines.join(' ')

    const reportedHours =
      extractDailyTotal(
        localText
      )

    const ranges =
      findAllTimeRanges(
        localText
      )

    for (const range of ranges) {
      const score =
        scoreTimeRange(
          range,
          reportedHours
        )

      /*
       * Prefer ranges physically closer
       * to the weekday label.
       */
      const rangePosition =
        localText.indexOf(
          range.clock_in
        )

      const dayPosition =
        localText.indexOf(
          localLines.find(
            (line) =>
              pattern.test(line)
          ) || ''
        )

      if (
        rangePosition >= 0 &&
        dayPosition >= 0
      ) {
        const distance =
          Math.abs(
            rangePosition -
              dayPosition
          )

        if (distance < 100) {
          if (score > -900) {
            if (!best || score > best.score) {
              best = {
                clock_in:
                  range.clock_in,
                clock_out:
                  range.clock_out,
                score:
                  score + 10,
                reportedHours,
              }
            }
          }
        } else if (
          !best ||
          score > best.score
        ) {
          best = {
            clock_in:
              range.clock_in,
            clock_out:
              range.clock_out,
            score,
            reportedHours,
          }
        }
      } else if (
        !best ||
        score > best.score
      ) {
        best = {
          clock_in:
            range.clock_in,
          clock_out:
            range.clock_out,
          score,
          reportedHours,
        }
      }
    }
  }

  return best
}

/*
 * Second-pass strategy:
 *
 * Some timecards are OCR'd without the weekday attached
 * to the time range. In that case we identify all valid
 * ranges and assign them to weekdays in document order.
 *
 * This is only used for days that were not already detected.
 */
function extractUnassignedRanges(
  lines: string[]
) {
  const allText =
    lines.join(' ')

  const ranges =
    findAllTimeRanges(
      allText
    )

  return ranges
}

/*
 * Main timecard parser.
 */
function extractMobileRows(
  rawText: string
): Row[] {
  const rows =
    defaultRows()

  const cleaned =
    cleanOcrText(
      rawText
    )

  const lines =
    cleaned
      .split('\n')
      .map((line) =>
        line.trim()
      )
      .filter(Boolean)

  /*
   * First pass:
   * Match weekday -> nearby shift.
   */
  const detectedIndexes =
    new Set<number>()

  DAYS.forEach(
    (day, rowIndex) => {
      const result =
        findBestRangeForDay(
          lines,
          day
        )

      if (!result) {
        return
      }

      /*
       * Avoid accepting a very weak match.
       */
      if (result.score < 5) {
        return
      }

      rows[rowIndex].clock_in =
        result.clock_in

      rows[rowIndex].clock_out =
        result.clock_out

      rows[rowIndex].reported_hours =
        result.reportedHours

      detectedIndexes.add(
        rowIndex
      )
    }
  )

  /*
   * Second pass:
   * If weekday-based detection missed some rows,
   * try assigning orphan ranges by document order.
   */
  const missingRows =
    rows
      .map((row, index) => ({
        row,
        index,
      }))
      .filter(
        ({ row }) =>
          !row.clock_in ||
          !row.clock_out
      )

  if (
    missingRows.length > 0
  ) {
    const ranges =
      extractUnassignedRanges(
        lines
      )

    const usedRanges =
      new Set<string>()

    rows.forEach((row) => {
      if (
        row.clock_in &&
        row.clock_out
      ) {
        usedRanges.add(
          `${row.clock_in}|${row.clock_out}`
        )
      }
    })

    for (
      const missing of missingRows
    ) {
      const candidate =
        ranges.find(
          (range) =>
            !usedRanges.has(
              `${range.clock_in}|${range.clock_out}`
            )
        )

      if (!candidate) {
        continue
      }

      const reportedHours =
        findReportedHoursNearRow(
          lines,
          missing.row.day
        )

      const score =
        scoreTimeRange(
          candidate,
          reportedHours
        )

      if (score >= 10) {
        rows[
          missing.index
        ].clock_in =
          candidate.clock_in

        rows[
          missing.index
        ].clock_out =
          candidate.clock_out

        rows[
          missing.index
        ].reported_hours =
          reportedHours

        usedRanges.add(
          `${candidate.clock_in}|${candidate.clock_out}`
        )
      }
    }
  }

  /*
   * Third pass:
   * Extract breaks from the same local area.
   */
  DAYS.forEach(
    (day, rowIndex) => {
      if (
        !rows[rowIndex].clock_in ||
        !rows[rowIndex].clock_out
      ) {
        return
      }

      const pattern =
        DAY_PATTERNS[day]

      const dayIndex =
        lines.findIndex(
          (line) =>
            pattern.test(line)
        )

      if (
        dayIndex < 0
      ) {
        return
      }

      const localText =
        lines
          .slice(
            Math.max(
              0,
              dayIndex - 2
            ),
            Math.min(
              lines.length,
              dayIndex + 16
            )
          )
          .join(' ')

      const breakMinutes =
        extractBreakMinutes(
          localText
        )

      if (
        breakMinutes > 0
      ) {
        rows[rowIndex].break_minutes =
          breakMinutes
      }
    }
  )

  return rows
}

function findReportedHoursNearRow(
  lines: string[],
  day: string
) {
  const pattern =
    DAY_PATTERNS[day]

  const index =
    lines.findIndex(
      (line) =>
        pattern.test(line)
    )

  if (index < 0) {
    return null
  }

  const text =
    lines
      .slice(
        Math.max(
          0,
          index - 2
        ),
        Math.min(
          lines.length,
          index + 16
        )
      )
      .join(' ')

  return extractDailyTotal(
    text
  )
}

/*
 * Creates multiple OCR versions of the image.
 *
 * Different timecards need different OCR preprocessing.
 */
async function createOcrCanvases(
  file: File
): Promise<HTMLCanvasElement[]> {
  const bitmap =
    await createImageBitmap(
      file
    )

  const sourceWidth =
    bitmap.width

  const sourceHeight =
    bitmap.height

  /*
   * Do not upscale excessively.
   *
   * 3x works well for mobile screenshots,
   * while limiting huge images avoids browser
   * memory problems.
   */
  const scale =
    Math.min(
      3,
      Math.max(
        2,
        2400 /
          Math.max(
            sourceWidth,
            sourceHeight
          )
      )
    )

  const width =
    Math.round(
      sourceWidth * scale
    )

  const height =
    Math.round(
      sourceHeight * scale
    )

  const canvases: HTMLCanvasElement[] =
    []

  /*
   * Version 1:
   * High-quality grayscale.
   */
  const grayCanvas =
    document.createElement(
      'canvas'
    )

  grayCanvas.width =
    width

  grayCanvas.height =
    height

  const grayContext =
    grayCanvas.getContext(
      '2d'
    )

  if (!grayContext) {
    throw new Error(
      'Could not prepare image.'
    )
  }

  grayContext.imageSmoothingEnabled =
    true

  grayContext.imageSmoothingQuality =
    'high'

  grayContext.drawImage(
    bitmap,
    0,
    0,
    width,
    height
  )

  const image =
    grayContext.getImageData(
      0,
      0,
      width,
      height
    )

  const pixels =
    image.data

  for (
    let i = 0;
    i < pixels.length;
    i += 4
  ) {
    const gray =
      Math.round(
        pixels[i] *
          0.299 +
          pixels[i + 1] *
            0.587 +
          pixels[i + 2] *
            0.114
      )

    pixels[i] =
      gray

    pixels[i + 1] =
      gray

    pixels[i + 2] =
      gray
  }

  grayContext.putImageData(
    image,
    0,
    0
  )

  canvases.push(
    grayCanvas
  )

  /*
   * Version 2:
   * Strong black/white threshold.
   *
   * Useful for small dark text.
   */
  const thresholdCanvas =
    document.createElement(
      'canvas'
    )

  thresholdCanvas.width =
    width

  thresholdCanvas.height =
    height

  const thresholdContext =
    thresholdCanvas.getContext(
      '2d'
    )

  if (thresholdContext) {
    thresholdContext.drawImage(
      bitmap,
      0,
      0,
      width,
      height
    )

    const thresholdImage =
      thresholdContext.getImageData(
        0,
        0,
        width,
        height
      )

    const thresholdPixels =
      thresholdImage.data

    for (
      let i = 0;
      i <
      thresholdPixels.length;
      i += 4
    ) {
      const gray =
        Math.round(
          thresholdPixels[i] *
            0.299 +
            thresholdPixels[
              i + 1
            ] *
              0.587 +
            thresholdPixels[
              i + 2
            ] *
              0.114
        )

      const value =
        gray < 170
          ? 0
          : 255

      thresholdPixels[i] =
        value

      thresholdPixels[
        i + 1
      ] = value

      thresholdPixels[
        i + 2
      ] = value
    }

    thresholdContext.putImageData(
      thresholdImage,
      0,
      0
    )

    canvases.push(
      thresholdCanvas
    )
  }

  /*
   * Version 3:
   * Contrast-enhanced.
   */
  const contrastCanvas =
    document.createElement(
      'canvas'
    )

  contrastCanvas.width =
    width

  contrastCanvas.height =
    height

  const contrastContext =
    contrastCanvas.getContext(
      '2d'
    )

  if (contrastContext) {
    contrastContext.drawImage(
      bitmap,
      0,
      0,
      width,
      height
    )

    const contrastImage =
      contrastContext.getImageData(
        0,
        0,
        width,
        height
      )

    const contrastPixels =
      contrastImage.data

    for (
      let i = 0;
      i <
      contrastPixels.length;
      i += 4
    ) {
      const gray =
        Math.round(
          contrastPixels[i] *
            0.299 +
            contrastPixels[
              i + 1
            ] *
              0.587 +
            contrastPixels[
              i + 2
            ] *
              0.114
        )

      /*
       * Contrast around the midpoint.
       */
      const contrasted =
        Math.max(
          0,
          Math.min(
            255,
            (gray - 128) *
              1.7 +
              128
          )
        )

      contrastPixels[i] =
        contrasted

      contrastPixels[
        i + 1
      ] = contrasted

      contrastPixels[
        i + 2
      ] = contrasted
    }

    contrastContext.putImageData(
      contrastImage,
      0,
      0
    )

    canvases.push(
      contrastCanvas
    )
  }

  return canvases
}

/*
 * Run Tesseract with several page segmentation modes.
 *
 * PSM 6:
 * Assumes a uniform block of text.
 *
 * PSM 11:
 * Sparse text.
 *
 * PSM 12:
 * Sparse text with OSD.
 */
async function ocrCanvas(
  canvas: HTMLCanvasElement,
  psm: number
) {
  const Tesseract =
    await import(
      'tesseract.js'
    )

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

        /*
         * Tesseract accepts config values
         * through the options object.
         */
        config: {
          tessedit_pageseg_mode:
            String(psm),
        },
      } as any
    )

  return (
    result.data.text ||
    ''
  )
}

/*
 * Combines multiple OCR passes.
 */
async function runImageOcr(
  file: File
) {
  const canvases =
    await createOcrCanvases(
      file
    )

  const allResults: string[] =
    []

  for (
    let canvasIndex = 0;
    canvasIndex <
      canvases.length;
    canvasIndex++
  ) {
    const canvas =
      canvases[
        canvasIndex
      ]

    for (
      const psm of [
        6,
        11,
        12,
      ]
    ) {
      try {
        const text =
          await ocrCanvas(
            canvas,
            psm
          )

        if (
          text &&
          text.trim()
            .length > 0
        ) {
          allResults.push(
            text
          )
        }
      } catch (
        error
      ) {
        console.warn(
          'OCR pass failed:',
          error
        )
      }
    }
  }

  /*
   * Put the most useful OCR result first,
   * but keep all passes available to the parser.
   */
  return allResults.join(
    '\n'
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
    pageNumber++
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
        20
      ) {
        allText +=
          '\n' +
          embeddedText
      }
    } catch (
      error
    ) {
      console.warn(
        'Embedded PDF text error:',
        error
      )
    }

    /*
     * Also OCR the page.
     *
     * This catches PDFs where embedded text is
     * incomplete or incorrectly ordered.
     */
    try {
      const viewport =
        page.getViewport({
          scale: 3,
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

      for (
        const psm of [
          6,
          11,
        ]
      ) {
        try {
          allText +=
            '\n' +
            (await ocrCanvas(
              canvas,
              psm
            ))
        } catch (
          error
        ) {
          console.warn(
            'PDF OCR pass error:',
            error
          )
        }
      }
    } catch (
      error
    ) {
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
    ].includes(
      ext || ''
    )
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
      'Reading your timecard. Using multiple OCR passes to detect different timecard layouts…'
    )

    try {
      const text =
        await runBrowserOcr(
          file
        )

      console.log(
        'COMBINED OCR TEXT:',
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

      console.log(
        'DETECTED ROWS:',
        detectedRows
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
          `OCR detected ${detectedCount} worked day(s). Please verify the detected values before relying on the result.`
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
          'OCR could not confidently identify the shift times. Please enter or correct them manually.'
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
                    {row.day}
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
            Multiple OCR passes are
            used to improve detection
            across different timecard
            layouts. Always verify
            detected values.
          </p>
        </div>
      </section>

      <footer className="siteFooter">
        TimeCard Calculator
      </footer>
    </main>
  )
}
