'use client'

import { useMemo, useRef, useState } from 'react'

type Row = {
  label: string
  clock_in: string
  clock_out: string
  break_minutes: number
}

const DEFAULT_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

const createDefaultRows = (): Row[] =>
  DEFAULT_DAYS.map((day) => ({
    label: day,
    clock_in: '',
    clock_out: '',
    break_minutes: 0,
  }))

function parseTime(value: string): number | null {
  if (!value?.trim()) {
    return null
  }

  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
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

    if (parts.length !== 2) {
      return null
    }

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

  /*
    If somebody enters:
    17:50PM

    treat it as:
    17:50
  */
  if (hours > 12 && hours <= 23) {
    meridiem = ''
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

function calculateWorkedMinutes(row: Row): number {
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

  return Math.max(0, minutes)
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

function normalizeDetectedTime(value: string) {
  let text = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, ':')
    .replace(/[Oo]/g, '0')

  if (/^\d{3}$/.test(text)) {
    text = `${text.slice(0, 1)}:${text.slice(1)}`
  }

  if (/^\d{4}$/.test(text)) {
    text = `${text.slice(0, 2)}:${text.slice(2)}`
  }

  return text
}

function findAllTimes(text: string) {
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
    .filter((time) => parseTime(time) !== null)
}

function detectRowLabel(text: string, index: number) {
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

function detectBreakMinutes(text: string) {
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

function parseAnyTimecardText(text: string): Row[] {
  const cleaned = text
    .replace(/\r/g, '\n')
    .replace(/[–—−]/g, '-')

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const detected: Row[] = []

  /*
    PASS 1:
    Try to detect two times on the same OCR line.
  */
  for (const line of lines) {
    const times = findAllTimes(line)

    if (times.length >= 2) {
      detected.push({
        label: detectRowLabel(line, detected.length),
        clock_in: times[0],
        clock_out: times[1],
        break_minutes: detectBreakMinutes(line),
      })
    }
  }

  /*
    PASS 2:
    OCR often breaks one row/card into multiple lines.
  */
  if (detected.length === 0) {
    for (let index = 0; index < lines.length; index++) {
      const block = lines
        .slice(index, index + 5)
        .join(' ')

      const times = findAllTimes(block)

      if (times.length < 2) {
        continue
      }

      const alreadyExists = detected.some(
        (row) =>
          row.clock_in === times[0] &&
          row.clock_out === times[1]
      )

      if (alreadyExists) {
        continue
      }

      detected.push({
        label: detectRowLabel(block, detected.length),
        clock_in: times[0],
        clock_out: times[1],
        break_minutes: detectBreakMinutes(block),
      })
    }
  }

  /*
    PASS 3:
    No dates or weekdays?
    Pair valid times in document order.
  */
  if (detected.length === 0) {
    const allTimes = findAllTimes(cleaned)

    for (
      let index = 0;
      index + 1 < allTimes.length;
      index += 2
    ) {
      detected.push({
        label: `Shift ${detected.length + 1}`,
        clock_in: allTimes[index],
        clock_out: allTimes[index + 1],
        break_minutes: 0,
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
    'eng',
    {
      logger: (info: any) => {
        console.log('OCR:', info)
      },
    }
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

    try {
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

      canvas.width =
        Math.ceil(viewport.width)

      canvas.height =
        Math.ceil(viewport.height)

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise

      allText +=
        '\n' +
        (await recognizeCanvas(canvas))
    } catch (error) {
      console.warn(
        'PDF OCR error:',
        error
      )
    }
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
    'Please upload a PDF, JPG, JPEG, or PNG file.'
  )
}

export default function Home() {
  const [rows, setRows] =
    useState<Row[]>(createDefaultRows())

  const [entryMode, setEntryMode] =
    useState<'upload' | 'manual'>('manual')

  const [submitted, setSubmitted] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [readingFile, setReadingFile] =
    useState(false)

  const fileRef =
    useRef<HTMLInputElement>(null)

  const dailyMinutes = useMemo(
    () =>
      rows.map(
        calculateWorkedMinutes
      ),
    [rows]
  )

  const weeklyMinutes = useMemo(
    () =>
      dailyMinutes.reduce(
        (total, minutes) =>
          total + minutes,
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

    if (
      rows.length === 0 ||
      !rows.some(
        (row) =>
          DEFAULT_DAYS.includes(
            row.label
          )
      )
    ) {
      setRows(createDefaultRows())
    }

    setSubmitted(false)
    setMessage('')

    document
      .getElementById('entries')
      ?.scrollIntoView({
        behavior: 'smooth',
      })
  }

  async function upload(file?: File) {
    if (!file) {
      return
    }

    setEntryMode('upload')
    setSubmitted(false)
    setReadingFile(true)

    setMessage(
      'Reading your timecard and detecting work shifts…'
    )

    try {
      const text =
        await runBrowserOcr(file)

      console.log(
        'OCR TEXT:',
        text
      )

      if (
        !text ||
        text.trim().length < 10
      ) {
        throw new Error(
          'No readable timecard information was detected.'
        )
      }

      const detectedRows =
        parseAnyTimecardText(text)

      if (
        detectedRows.length === 0
      ) {
        setRows(
          createDefaultRows()
        )

        setEntryMode(
          'manual'
        )

        setMessage(
          'The timecard was read, but complete shifts could not be identified. Please enter or correct the times manually.'
        )

        return
      }

      setRows(detectedRows)

      setMessage(
        `${detectedRows.length} shift(s) detected. Please verify the extracted times before using the final total.`
      )

      setSubmitted(true)

      setTimeout(() => {
        document
          .getElementById('results')
          ?.scrollIntoView({
            behavior: 'smooth',
          })
      }, 150)
    } catch (error: any) {
      console.error(error)

      setRows(createDefaultRows())

      setEntryMode('manual')

      setMessage(
        error?.message ||
          'The timecard could not be read automatically. Please enter the times manually.'
      )
    } finally {
      setReadingFile(false)

      if (fileRef.current) {
        fileRef.current.value = ''
      }
    }
  }

  function submitManual() {
    const completed = rows.filter(
      (row) =>
        row.clock_in.trim() &&
        row.clock_out.trim()
    )

    if (completed.length === 0) {
      setMessage(
        'Please enter at least one Clock In and Clock Out.'
      )

      return
    }

    const invalid = completed.find(
      (row) =>
        parseTime(row.clock_in) === null ||
        parseTime(row.clock_out) === null
    )

    if (invalid) {
      setMessage(
        `Please check the time format for ${invalid.label}. Use formats such as 6:40AM, 5:50PM, 06:40, or 17:50.`
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
    setRows(createDefaultRows())
    setEntryMode('manual')
    setSubmitted(false)
    setMessage('')
    setReadingFile(false)

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  return (
    <main className="calculatorPage">
      <section className="calculatorHero">
        <div className="breadcrumb">
          <span>Home</span>

          <span className="breadcrumbArrow">
            ›
          </span>

          <span>Calculators</span>

          <span className="breadcrumbArrow">
            ›
          </span>

          <span className="breadcrumbActive">
            Time Card Calculator
          </span>
        </div>

        <div className="heroCenter">
          <div className="heroBadge">
            <span className="heroBadgeIcon">
              ◷
            </span>

            FREE WORK HOURS CALCULATOR
          </div>

          <h1 className="calculatorHeroTitle">
            Time Card Calculator

            <span>
              Calculate Work Hours Accurately
            </span>
          </h1>

          <p className="calculatorHeroText">
            Calculate daily and weekly work hours from
            clock-in and clock-out times. Account for
            breaks and overnight shifts, review detected
            timecard entries, and get accurate decimal-hour
            totals in seconds.
          </p>

          <div className="calculatorHeroActions">
            <button
              className="heroPrimaryButton"
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
              className="heroSecondaryButton"
              disabled={readingFile}
              onClick={startManualEntry}
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
            Review or enter work shifts
          </h2>

          <p>
            Use formats such as 6:40AM, 5:50PM,
            06:40, or 17:50. Overnight shifts are
            supported automatically.
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
              Day / Shift
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
            (row, index) => {
              const minutes =
                dailyMinutes[index]

              return (
                <div
                  className="timeRow"
                  key={`${row.label}-${index}`}
                >
                  <div className="dayCell">
                    {row.label}
                  </div>

                  <input
                    className="timeInput"
                    value={row.clock_in}
                    placeholder="e.g. 06:48"
                    onChange={(event) =>
                      updateRow(
                        index,
                        'clock_in',
                        event.target.value
                      )
                    }
                  />

                  <input
                    className="timeInput"
                    value={row.clock_out}
                    placeholder="e.g. 19:31"
                    onChange={(event) =>
                      updateRow(
                        index,
                        'clock_out',
                        event.target.value
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
                  </div>
                </div>
              )
            }
          )}
        </div>

        {entryMode === 'manual' && (
          <div className="formActions">
            <button
              className="primaryButton"
              onClick={submitManual}
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

        {entryMode === 'upload' && (
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
                Weekly Work Hours Summary
              </h2>
            </div>

            <div className="weeklyTotalHero">
              <span>
                Total Hours
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
                Day / Shift
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
              (row, index) => {
                if (
                  !row.clock_in ||
                  !row.clock_out
                ) {
                  return null
                }

                const minutes =
                  dailyMinutes[index]

                return (
                  <div
                    className="resultRow"
                    key={`result-${row.label}-${index}`}
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
                      {row.break_minutes > 0
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
                Total Weekly Hours
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
            Enter or upload shifts
          </h3>

          <p>
            Enter work times manually or upload a
            screenshot, photo, or PDF timecard for
            automatic text detection.
          </p>
        </div>

        <div className="infoCard">
          <span className="infoNumber">
            02
          </span>

          <h3>
            Automatic hour calculation
          </h3>

          <p>
            Breaks and overnight shifts are accounted
            for automatically when calculating net
            hours worked.
          </p>
        </div>

        <div className="infoCard">
          <span className="infoNumber">
            03
          </span>

          <h3>
            Review your weekly total
          </h3>

          <p>
            View each detected shift together with its
            decimal-hour total and your complete weekly
            work-hour summary.
          </p>
        </div>
      </section>

      <footer className="siteFooter">
        Time Card Calculator • Review uploaded timecard
        values before relying on the final result.
      </footer>
    </main>
  )
}
