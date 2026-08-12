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

type OcrWord = {
  text: string
  confidence: number
  x0: number
  y0: number
  x1: number
  y1: number
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

const DAY_SHORT: Record<string, string> = {
  mon: 'Monday',
  monday: 'Monday',

  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',

  wed: 'Wednesday',
  wednesday: 'Wednesday',

  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',

  fri: 'Friday',
  friday: 'Friday',

  sat: 'Saturday',
  saturday: 'Saturday',

  sun: 'Sunday',
  sunday: 'Sunday',
}

const defaultRows = (): Row[] =>
  DAYS.map((day) => ({
    day,
    clock_in: '',
    clock_out: '',
    break_minutes: 0,
    reported_hours: null,
  }))

function parseTime(
  value: string
): number | null {
  if (!value?.trim()) return null

  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, '')

  let meridiem = ''

  const meridiemMatch =
    text.match(/(AM|PM)$/)

  if (meridiemMatch) {
    meridiem =
      meridiemMatch[1]

    text = text.replace(
      /(AM|PM)$/,
      ''
    )
  }

  let hours = 0
  let minutes = 0

  if (text.includes(':')) {
    const parts =
      text.split(':')

    if (parts.length !== 2) {
      return null
    }

    hours =
      Number(parts[0])

    minutes =
      Number(parts[1])
  } else {
    const digits =
      text.replace(/\D/g, '')

    if (digits.length <= 2) {
      hours =
        Number(digits)

      minutes = 0
    } else if (
      digits.length === 3
    ) {
      hours =
        Number(
          digits.slice(0, 1)
        )

      minutes =
        Number(
          digits.slice(1)
        )
    } else if (
      digits.length === 4
    ) {
      hours =
        Number(
          digits.slice(0, 2)
        )

      minutes =
        Number(
          digits.slice(2)
        )
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

  /*
    Allow accidental input like:
    17:50PM

    Treat it as:
    17:50
  */
  if (
    hours > 12 &&
    hours <= 23
  ) {
    meridiem = ''
  }

  if (meridiem) {
    if (
      hours < 1 ||
      hours > 12
    ) {
      return null
    }

    if (
      meridiem === 'AM' &&
      hours === 12
    ) {
      hours = 0
    }

    if (
      meridiem === 'PM' &&
      hours !== 12
    ) {
      hours += 12
    }
  } else {
    if (
      hours < 0 ||
      hours > 23
    ) {
      return null
    }
  }

  return (
    hours * 60 +
    minutes
  )
}

function getWorkedMinutes(
  row: Row
) {
  const start =
    parseTime(
      row.clock_in
    )

  const end =
    parseTime(
      row.clock_out
    )

  if (
    start === null ||
    end === null
  ) {
    return 0
  }

  let minutes =
    end - start

  /*
    Overnight shift.

    Example:
    18:40 -> 07:13
  */
  if (minutes < 0) {
    minutes +=
      24 * 60
  }

  minutes -=
    Number(
      row.break_minutes || 0
    )

  return Math.max(
    0,
    minutes
  )
}

function decimalHours(
  minutes: number
) {
  return (
    minutes / 60
  ).toFixed(2)
}

function readableHours(
  minutes: number
) {
  const hours =
    Math.floor(
      minutes / 60
    )

  const mins =
    minutes % 60

  if (hours === 0) {
    return `${mins}m`
  }

  if (mins === 0) {
    return `${hours}h`
  }

  return `${hours}h ${mins}m`
}

function cleanOcrText(
  value: string
) {
  return value
    .replace(/–|—|−/g, '-')
    .replace(
      /(?<=\d)[Oo](?=\d)/g,
      '0'
    )
    .replace(
      /(?<=\d)[Il](?=\d)/g,
      '1'
    )
    .replace(/\r/g, '\n')
}

function normalizeDetectedTime(
  value: string
) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, ':')
    .replace(/[Oo]/g, '0')

  /*
    648 -> 6:48
  */
  if (
    /^\d{3}$/.test(text)
  ) {
    text =
      `${text.slice(
        0,
        1
      )}:${text.slice(1)}`
  }

  /*
    0648 -> 06:48
  */
  if (
    /^\d{4}$/.test(text)
  ) {
    text =
      `${text.slice(
        0,
        2
      )}:${text.slice(2)}`
  }

  return text
}

function extractTimeRange(
  rawText: string
) {
  const text =
    cleanOcrText(
      rawText
    )

  const patterns = [
    /*
      06:48 - 19:31
    */
    /(\d{1,2}[:.]\d{2})\s*[-~]\s*(\d{1,2}[:.]\d{2})/i,

    /*
      6:48AM - 7:31PM
    */
    /(\d{1,2}[:.]\d{2}\s*(?:AM|PM))\s*[-~]\s*(\d{1,2}[:.]\d{2}\s*(?:AM|PM))/i,

    /*
      0648 - 1931
    */
    /(\d{3,4})\s*[-~]\s*(\d{3,4})/,
  ]

  for (
    const pattern of patterns
  ) {
    const match =
      text.match(pattern)

    if (!match) {
      continue
    }

    const start =
      normalizeDetectedTime(
        match[1]
      )

    const end =
      normalizeDetectedTime(
        match[2]
      )

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
    Sometimes OCR drops the dash.
    Example:
    "1st: 06:48 19:31"
  */
  const looseMatches =
    text.match(
      /\b\d{1,2}[:.]\d{2}\b/g
    ) || []

  if (
    looseMatches.length >= 2
  ) {
    const start =
      normalizeDetectedTime(
        looseMatches[0]
      )

    const end =
      normalizeDetectedTime(
        looseMatches[1]
      )

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

  return null
}

function extractDailyTotal(
  text: string
) {
  const cleaned =
    cleanOcrText(
      text
    )

  const patterns = [
    /daily\s*total\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i,

    /daily\s*total[^0-9]{0,10}(\d{1,2}(?:\.\d{1,2})?)/i,
  ]

  for (
    const pattern of patterns
  ) {
    const match =
      cleaned.match(pattern)

    if (!match) {
      continue
    }

    const value =
      Number(match[1])

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

function extractBreak(
  text: string
) {
  const match =
    text.match(
      /(?:break|meal)[^0-9]{0,15}(\d{1,3})\s*(?:min|mins|minutes)?/i
    )

  if (!match) {
    return 0
  }

  const value =
    Number(match[1])

  if (
    Number.isNaN(value) ||
    value < 0 ||
    value > 180
  ) {
    return 0
  }

  return value
}

function parseTsvWords(
  tsv: string
): OcrWord[] {
  if (!tsv) {
    return []
  }

  const lines =
    tsv.split('\n')

  if (
    lines.length < 2
  ) {
    return []
  }

  const header =
    lines[0].split('\t')

  const textIndex =
    header.indexOf('text')

  const confIndex =
    header.indexOf('conf')

  const leftIndex =
    header.indexOf('left')

  const topIndex =
    header.indexOf('top')

  const widthIndex =
    header.indexOf('width')

  const heightIndex =
    header.indexOf('height')

  if (
    textIndex === -1 ||
    leftIndex === -1 ||
    topIndex === -1 ||
    widthIndex === -1 ||
    heightIndex === -1
  ) {
    return []
  }

  const words: OcrWord[] =
    []

  for (
    let index = 1;
    index < lines.length;
    index++
  ) {
    const columns =
      lines[index].split(
        '\t'
      )

    const text =
      (
        columns[
          textIndex
        ] || ''
      ).trim()

    if (!text) {
      continue
    }

    const left =
      Number(
        columns[
          leftIndex
        ]
      )

    const top =
      Number(
        columns[
          topIndex
        ]
      )

    const width =
      Number(
        columns[
          widthIndex
        ]
      )

    const height =
      Number(
        columns[
          heightIndex
        ]
      )

    const confidence =
      confIndex >= 0
        ? Number(
            columns[
              confIndex
            ]
          )
        : 0

    if (
      Number.isNaN(left) ||
      Number.isNaN(top) ||
      Number.isNaN(width) ||
      Number.isNaN(height)
    ) {
      continue
    }

    words.push({
      text,
      confidence:
        Number.isNaN(
          confidence
        )
          ? 0
          : confidence,
      x0: left,
      y0: top,
      x1:
        left + width,
      y1:
        top + height,
    })
  }

  return words
}

function normalizeDayWord(
  value: string
) {
  return value
    .toLowerCase()
    .replace(
      /[^a-z]/g,
      ''
    )
}

function getDayFromWord(
  value: string
) {
  const cleaned =
    normalizeDayWord(
      value
    )

  return (
    DAY_SHORT[
      cleaned
    ] || null
  )
}

function cropCanvas(
  source:
    HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const crop =
    document.createElement(
      'canvas'
    )

  const safeX =
    Math.max(
      0,
      Math.floor(x)
    )

  const safeY =
    Math.max(
      0,
      Math.floor(y)
    )

  const safeWidth =
    Math.min(
      source.width -
        safeX,
      Math.floor(width)
    )

  const safeHeight =
    Math.min(
      source.height -
        safeY,
      Math.floor(height)
    )

  crop.width =
    Math.max(
      1,
      safeWidth
    )

  crop.height =
    Math.max(
      1,
      safeHeight
    )

  const context =
    crop.getContext(
      '2d'
    )

  if (!context) {
    throw new Error(
      'Unable to crop image.'
    )
  }

  context.drawImage(
    source,
    safeX,
    safeY,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  )

  return crop
}

async function prepareImage(
  file: File
) {
  const bitmap =
    await createImageBitmap(
      file
    )

  /*
    Upscale image.

    This is important for
    mobile screenshots.
  */
  const scale = 2.5

  const canvas =
    document.createElement(
      'canvas'
    )

  canvas.width =
    Math.round(
      bitmap.width *
        scale
    )

  canvas.height =
    Math.round(
      bitmap.height *
        scale
    )

  const context =
    canvas.getContext(
      '2d'
    )

  if (!context) {
    throw new Error(
      'Unable to process image.'
    )
  }

  context.drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height
  )

  /*
    Grayscale +
    contrast enhancement.
  */
  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )

  const data =
    imageData.data

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {
    const gray =
      Math.round(
        data[i] *
          0.299 +
          data[i + 1] *
            0.587 +
          data[i + 2] *
            0.114
      )

    /*
      Keep dark text dark
      and make background light.
    */
    const contrast =
      gray < 170
        ? Math.max(
            0,
            gray - 35
          )
        : Math.min(
            255,
            gray + 20
          )

    data[i] =
      contrast

    data[i + 1] =
      contrast

    data[i + 2] =
      contrast
  }

  context.putImageData(
    imageData,
    0,
    0
  )

  return canvas
}

async function recognizeCanvas(
  canvas:
    HTMLCanvasElement
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
          info: any
        ) => {
          console.log(
            'OCR:',
            info
          )
        },
      }
    )

  return {
    text:
      result.data.text ||
      '',

    /*
      Tesseract.js versions
      expose TSV here.
    */
    tsv:
      (
        result.data as any
      ).tsv || '',
  }
}

async function readMobileCards(
  sourceCanvas:
    HTMLCanvasElement
): Promise<Row[]> {
  const fullResult =
    await recognizeCanvas(
      sourceCanvas
    )

  console.log(
    'FULL OCR:',
    fullResult.text
  )

  const words =
    parseTsvWords(
      fullResult.tsv
    )

  const output =
    defaultRows()

  /*
    Locate each weekday
    word in the screenshot.
  */
  const dayWords =
    words.filter(
      (word) => {
        const day =
          getDayFromWord(
            word.text
          )

        return (
          day !== null &&
          word.confidence >
            15
        )
      }
    )

  console.log(
    'DAY WORDS:',
    dayWords
  )

  /*
    If TSV did not give
    useful positions, use
    the old text parser as
    fallback.
  */
  if (
    dayWords.length === 0
  ) {
    return parseWholeTextFallback(
      fullResult.text
    )
  }

  const candidates:
    Record<
      string,
      Row[]
    > = {}

  for (
    const dayWord of dayWords
  ) {
    const day =
      getDayFromWord(
        dayWord.text
      )

    if (!day) {
      continue
    }

    /*
      Determine which half
      of the screenshot this
      card belongs to.

      Your example screenshot
      contains two phone screens
      side by side.
    */
    const middle =
      sourceCanvas.width /
      2

    const isWideComposite =
      sourceCanvas.width >
      sourceCanvas.height *
        0.8

    let columnLeft = 0
    let columnRight =
      sourceCanvas.width

    if (
      isWideComposite
    ) {
      if (
        dayWord.x0 <
        middle
      ) {
        columnLeft = 0
        columnRight =
          middle
      } else {
        columnLeft =
          middle

        columnRight =
          sourceCanvas.width
      }
    }

    /*
      Crop the entire card.

      The weekday appears
      toward the left side of
      each card, so extend
      above and below it.
    */
    const paddingTop = 45

    const paddingBottom =
      175

    const cropY =
      dayWord.y0 -
      paddingTop

    const cropHeight =
      dayWord.y1 -
      dayWord.y0 +
      paddingTop +
      paddingBottom

    const card =
      cropCanvas(
        sourceCanvas,
        columnLeft,
        cropY,
        columnRight -
          columnLeft,
        cropHeight
      )

    const cardResult =
      await recognizeCanvas(
        card
      )

    console.log(
      `${day} CARD OCR:`,
      cardResult.text
    )

    const timeRange =
      extractTimeRange(
        cardResult.text
      )

    const dailyTotal =
      extractDailyTotal(
        cardResult.text
      )

    const breakMinutes =
      extractBreak(
        cardResult.text
      )

    if (
      !timeRange &&
      dailyTotal === null
    ) {
      continue
    }

    const candidate: Row =
      {
        day,
        clock_in:
          timeRange
            ?.clock_in ||
          '',

        clock_out:
          timeRange
            ?.clock_out ||
          '',

        break_minutes:
          breakMinutes,

        reported_hours:
          dailyTotal,
      }

    if (
      !candidates[day]
    ) {
      candidates[day] =
        []
    }

    candidates[
      day
    ].push(
      candidate
    )
  }

  /*
    Choose best card
    candidate for each day.
  */
  DAYS.forEach(
    (day, index) => {
      const dayCandidates =
        candidates[day] ||
        []

      if (
        dayCandidates.length ===
        0
      ) {
        return
      }

      const best =
        dayCandidates.sort(
          (a, b) => {
            const scoreA =
              (a.clock_in &&
              a.clock_out
                ? 10
                : 0) +
              (a.reported_hours !=
              null
                ? 5
                : 0)

            const scoreB =
              (b.clock_in &&
              b.clock_out
                ? 10
                : 0) +
              (b.reported_hours !=
              null
                ? 5
                : 0)

            return (
              scoreB -
              scoreA
            )
          }
        )[0]

      output[index] =
        best
    }
  )

  return output
}

function parseWholeTextFallback(
  text: string
) {
  const output =
    defaultRows()

  const cleaned =
    cleanOcrText(
      text
    )

  const lines =
    cleaned
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(Boolean)

  DAYS.forEach(
    (day, index) => {
      const short =
        day
          .slice(0, 3)
          .toLowerCase()

      const lineIndex =
        lines.findIndex(
          (line) =>
            line
              .toLowerCase()
              .includes(short)
        )

      if (
        lineIndex === -1
      ) {
        return
      }

      const nearby =
        lines
          .slice(
            lineIndex,
            lineIndex + 8
          )
          .join(' ')

      const range =
        extractTimeRange(
          nearby
        )

      const total =
        extractDailyTotal(
          nearby
        )

      if (range) {
        output[
          index
        ].clock_in =
          range.clock_in

        output[
          index
        ].clock_out =
          range.clock_out
      }

      output[
        index
      ].reported_hours =
        total
    }
  )

  return output
}

async function processImageFile(
  file: File
) {
  const canvas =
    await prepareImage(
      file
    )

  return readMobileCards(
    canvas
  )
}

async function processPdfFile(
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

  const finalRows =
    defaultRows()

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

    const viewport =
      page.getViewport({
        scale: 2.4,
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

    const pageRows =
      await readMobileCards(
        canvas
      )

    pageRows.forEach(
      (
        row,
        index
      ) => {
        if (
          row.clock_in &&
          row.clock_out
        ) {
          finalRows[
            index
          ] =
            row
        }
      }
    )
  }

  return finalRows
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
  ] = useState<
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
            value
          ) =>
            total +
            value,
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
      'Reading each timecard entry separately. Please wait…'
    )

    try {
      const extension =
        file.name
          .toLowerCase()
          .split('.')
          .pop()

      let detectedRows:
        Row[]

      if (
        [
          'jpg',
          'jpeg',
          'png',
        ].includes(
          extension ||
            ''
        )
      ) {
        detectedRows =
          await processImageFile(
            file
          )
      } else if (
        extension ===
        'pdf'
      ) {
        detectedRows =
          await processPdfFile(
            file
          )
      } else {
        throw new Error(
          'Please upload a JPG, JPEG, PNG, or PDF.'
        )
      }

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
          `Detected ${detectedCount} worked day(s). Please verify each Clock In and Clock Out before using the total.`
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
          'The screenshot was read, but no complete shift ranges were identified. Please enter or correct the times manually.'
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

      setMessage(
        error?.message ||
          'Could not read the timecard automatically.'
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
          row.clock_in &&
          row.clock_out
      )

    if (
      completed.length ===
      0
    ) {
      setMessage(
        'Please enter at least one completed shift.'
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
        `Please check the time format for ${invalid.day}.`
      )

      return
    }

    setMessage('')
    setSubmitted(
      true
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
              Weekly hour calculator
            </div>
          </div>
        </div>

        <div className="privacyBadge">
          No account required
        </div>
      </section>

      <section className="heroCard">
        <div>
          <span className="eyebrow">
            WEEKLY HOURS
          </span>

          <h1>
            Calculate your timecard
          </h1>

          <p>
            Upload a screenshot,
            photo, or PDF, or enter
            your shifts manually.
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
            OCR
          </span>

          <strong>
            Card-by-card
          </strong>

          <small>
            Each shift is read separately
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
            Review the detected
            values before using
            the result.
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
                          opacity:
                            0.6,
                          marginTop:
                            2,
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
              onClick={reset}
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
              onClick={reset}
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
              <div>Day</div>
              <div>Shift</div>
              <div>Break</div>
              <div>Hours</div>
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

      <footer className="siteFooter">
        TimeCard Calculator
      </footer>
    </main>
  )
}
