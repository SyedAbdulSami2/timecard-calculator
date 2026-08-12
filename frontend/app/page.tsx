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
  if (!value?.trim()) return null

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

  // Allow input such as 17:50PM by treating it as 17:50.
  if (hours > 12 && hours <= 23) {
    meridiem = ''
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null
    }

    if (meridiem === 'AM') {
      if (hours === 12) {
        hours = 0
      }
    }

    if (meridiem === 'PM') {
      if (hours !== 12) {
        hours += 12
      }
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

  let workedMinutes = end - start

  // Overnight shift.
  // Example: 6:40PM -> 7:13AM
  if (workedMinutes < 0) {
    workedMinutes += 24 * 60
  }

  workedMinutes -= Number(row.break_minutes || 0)

  return Math.max(0, workedMinutes)
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

function extractRowsFromOcr(text: string): Row[] {
  const detectedRows = defaultRows()

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const dayPatterns = [
    ['Monday', /\b(mon|monday)\b/i],
    ['Tuesday', /\b(tue|tues|tuesday)\b/i],
    ['Wednesday', /\b(wed|wednesday)\b/i],
    ['Thursday', /\b(thu|thur|thurs|thursday)\b/i],
    ['Friday', /\b(fri|friday)\b/i],
    ['Saturday', /\b(sat|saturday)\b/i],
    ['Sunday', /\b(sun|sunday)\b/i],
  ] as const

  function findTimes(line: string) {
    const cleaned = line
      .replace(/[Oo]/g, '0')
      .replace(/[Il|]/g, '1')

    const matches =
      cleaned.match(
        /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
      ) || []

    return matches
      .map((value) =>
        value
          .toUpperCase()
          .replace(/\s+/g, '')
          .replace(/\./g, ':')
      )
      .filter((value) => parseTime(value) !== null)
  }

  dayPatterns.forEach(([day, pattern], index) => {
    const matchingLineIndex = lines.findIndex((line) =>
      pattern.test(line)
    )

    if (matchingLineIndex === -1) return

    /*
      Sometimes OCR splits a row across multiple lines.
      Combine the weekday line with the next two lines.
    */
    const combinedLine = [
      lines[matchingLineIndex] || '',
      lines[matchingLineIndex + 1] || '',
      lines[matchingLineIndex + 2] || '',
    ].join(' ')

    const times = findTimes(combinedLine)

    if (times.length >= 2) {
      detectedRows[index].clock_in = times[0]
      detectedRows[index].clock_out = times[1]
    }

    /*
      Break detection is intentionally conservative.
      It looks for explicit break/minute text first.
    */
    const breakMatch = combinedLine.match(
      /break[^0-9]{0,12}(\d{1,3})\s*(?:min|mins|minutes)?/i
    )

    if (breakMatch) {
      const value = Number(breakMatch[1])

      if (value >= 0 && value <= 180) {
        detectedRows[index].break_minutes = value
      }
    }

    detectedRows[index].day = day
  })

  return detectedRows
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

      /*
        First try embedded PDF text.
      */
      const content = await page.getTextContent()

      const embeddedText = content.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim()

      if (embeddedText.length > 80) {
        allText += '\n' + embeddedText
        continue
      }

      /*
        If there is not enough embedded text,
        render the page and use Tesseract OCR.
      */
      try {
        const viewport = page.getViewport({
          scale: 2.2,
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

        const Tesseract =
          await import('tesseract.js')

        const result =
          await Tesseract.recognize(
            canvas,
            'eng'
          )

        allText +=
          '\n' + (result.data.text || '')
      } catch (error) {
        console.warn(
          'PDF page OCR failed:',
          error
        )
      }
    }

    return allText.trim()
  }

  return ''
}

export default function Home() {
  const [rows, setRows] =
    useState<Row[]>(defaultRows())

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
    () => rows.map(getWorkedMinutes),
    [rows]
  )

  const weeklyMinutes = useMemo(
    () =>
      dailyMinutes.reduce(
        (sum, minutes) =>
          sum + minutes,
        0
      ),
    [dailyMinutes]
  )

  function updateRow(
    index: number,
    key: keyof Row,
    value: string | number
  ) {
    /*
      For manual entry, changing a value hides the
      previous submitted result until Submit is clicked again.
    */
    if (entryMode === 'manual') {
      setSubmitted(false)
    }

    /*
      For uploaded OCR results, allow corrections
      while continuing to show live calculations.
    */
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
    setReadingFile(true)

    setMessage(
      'Reading your timecard. OCR may take several seconds…'
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
        setRows(defaultRows())

        setMessage(
          "The timecard couldn't be read clearly. Please enter the times manually."
        )

        setEntryMode('manual')
        return
      }

      const detectedRows =
        extractRowsFromOcr(text)

      setRows(detectedRows)

      const detectedCount =
        detectedRows.filter(
          (row) =>
            row.clock_in &&
            row.clock_out
        ).length

      if (detectedCount > 0) {
        setMessage(
          `OCR detected ${detectedCount} day(s). Please review the Clock In, Clock Out, and Break values before relying on the result.`
        )

        /*
          Upload mode calculates automatically.
        */
        setSubmitted(true)

        setTimeout(() => {
          document
            .getElementById('entries')
            ?.scrollIntoView({
              behavior: 'smooth',
            })
        }, 100)
      } else {
        setMessage(
          'OCR completed, but the daily times were not clear enough. Please enter or correct the values manually.'
        )

        /*
          Keep OCR result visible but allow manual corrections.
        */
        setEntryMode('manual')
      }
    } catch (error) {
      console.error(error)

      setRows(defaultRows())

      setMessage(
        'The timecard could not be read automatically. Please enter the times manually.'
      )

      setEntryMode('manual')
    } finally {
      setReadingFile(false)

      if (fileRef.current) {
        fileRef.current.value = ''
      }
    }
  }

  function submitManual() {
    const completedRows =
      rows.filter(
        (row) =>
          row.clock_in.trim() &&
          row.clock_out.trim()
      )

    if (
      completedRows.length === 0
    ) {
      setMessage(
        'Please enter at least one Clock In and Clock Out.'
      )

      return
    }

    const invalidRow =
      completedRows.find(
        (row) =>
          parseTime(
            row.clock_in
          ) === null ||
          parseTime(
            row.clock_out
          ) === null
      )

    if (invalidRow) {
      setMessage(
        `Please check the time format for ${invalidRow.day}. Use formats like 6:40AM, 5:50PM, 06:40, or 17:50.`
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
            Calculate your timecard in seconds
          </h1>

          <p>
            Upload a timecard or enter your shifts
            manually. Breaks, decimal hours, and
            overnight shifts are handled automatically.
          </p>

          <div className="heroActions">
            <button
              className="primaryButton"
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
              className="secondaryButton"
              disabled={readingFile}
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
              onChange={(event) =>
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
            AM/PM & 24-hour
          </strong>

          <small>
            Overnight shifts supported
          </small>
        </div>
      </section>

      <section
        className="mainCard"
        id="entries"
      >
        <div className="sectionHeading">
          <div>
            <span className="sectionLabel">
              TIME ENTRIES
            </span>

            <h2>
              Enter your weekly shifts
            </h2>

            <p>
              Use formats like 6:40AM,
              5:50PM, 06:40, or 17:50.
            </p>
          </div>
        </div>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="desktopTable">
          <div className="tableHeader">
            <div>Day</div>
            <div>Clock In</div>
            <div>Clock Out</div>
            <div>Break</div>
            <div>Hours</div>
          </div>

          {rows.map(
            (row, index) => (
              <div
                className="timeRow"
                key={row.day}
              >
                <div className="dayCell">
                  {row.day}
                </div>

                <input
                  className="timeInput"
                  value={
                    row.clock_in
                  }
                  placeholder="e.g. 6:40AM"
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
                  placeholder="e.g. 5:50PM"
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
                  {dailyMinutes[
                    index
                  ] > 0
                    ? decimalHours(
                        dailyMinutes[
                          index
                        ]
                      )
                    : '—'}
                </div>
              </div>
            )
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
              (row, index) => {
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
                        {row.day}
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
            Minutes are divided
            by 60. For example,
            33 minutes equals
            0.55 hours.
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
            Clocking out the
            following morning is
            handled automatically.
          </p>
        </div>

        <div className="infoCard">
          <span className="infoNumber">
            03
          </span>

          <h3>
            Break deduction
          </h3>

          <p>
            Break minutes are
            deducted before
            decimal hours are
            calculated.
          </p>
        </div>
      </section>

      <footer className="siteFooter">
        TimeCard Calculator
      </footer>
    </main>
  )
}
