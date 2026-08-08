'use client'

import { useMemo, useRef, useState } from 'react'

type Row = {
  date: string
  day: string
  clock_in: string
  clock_out: string
  break_minutes: number
  regular_hours: number
  overtime_hours: number
  holiday_hours: number
  on_call_hours: number
  call_back_hours: number
  total_hours: number
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

const emptyRow = (day = ''): Row => ({
  date: '',
  day,
  clock_in: '',
  clock_out: '',
  break_minutes: 0,
  regular_hours: 0,
  overtime_hours: 0,
  holiday_hours: 0,
  on_call_hours: 0,
  call_back_hours: 0,
  total_hours: 0,
})

const defaultRows = () =>
  DAYS.map((day) => emptyRow(day))

const API =
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000'

function parseTime(value: string): number | null {
  if (!value.trim()) return null

  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')

  const meridiem =
    text.match(/\b(AM|PM)\b/)?.[1] || ''

  text = text
    .replace(/\s*(AM|PM)\s*/g, '')
    .trim()

  const digitsOnly = text.replace(/\D/g, '')

  let hours = 0
  let minutes = 0

  if (text.includes(':')) {
    const parts = text.split(':')

    hours = Number(parts[0])
    minutes = Number(parts[1] || 0)
  } else if (digitsOnly.length === 3) {
    hours = Number(digitsOnly.slice(0, 1))
    minutes = Number(digitsOnly.slice(1))
  } else if (digitsOnly.length === 4) {
    hours = Number(digitsOnly.slice(0, 2))
    minutes = Number(digitsOnly.slice(2))
  } else if (digitsOnly.length <= 2) {
    hours = Number(digitsOnly)
  } else {
    return null
  }

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

    if (hours === 12) hours = 0

    if (meridiem === 'PM') {
      hours += 12
    }
  } else if (hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

function formatDetectedTime(value: string) {
  let text = value
    .toUpperCase()
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .trim()

  const meridiem =
    text.match(/\b(AM|PM)\b/)?.[1] || ''

  text = text
    .replace(/\s*(AM|PM)\s*/g, '')
    .trim()

  const digits = text.replace(/\D/g, '')

  if (text.includes(':')) {
    const pieces = text.split(':')

    const hour = Number(
      pieces[0].replace(/\D/g, '')
    )

    const minute = Number(
      (pieces[1] || '').replace(/\D/g, '')
    )

    if (
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      minute > 59
    ) {
      return ''
    }

    return `${hour}:${String(minute).padStart(
      2,
      '0'
    )}${meridiem ? ` ${meridiem}` : ''}`
  }

  if (digits.length === 3) {
    return `${Number(digits[0])}:${digits.slice(
      1
    )}${meridiem ? ` ${meridiem}` : ''}`
  }

  if (digits.length === 4) {
    return `${Number(
      digits.slice(0, 2)
    )}:${digits.slice(2)}${
      meridiem ? ` ${meridiem}` : ''
    }`
  }

  return ''
}

function calculateRow(row: Row): Row {
  const start = parseTime(row.clock_in)
  const end = parseTime(row.clock_out)

  if (start === null || end === null) {
    return {
      ...row,
      regular_hours: 0,
      overtime_hours: 0,
      total_hours: 0,
    }
  }

  let workedMinutes = end - start

  // Overnight shifts
  if (workedMinutes < 0) {
    workedMinutes += 24 * 60
  }

  workedMinutes -= Number(
    row.break_minutes || 0
  )

  if (workedMinutes < 0) {
    workedMinutes = 0
  }

  const workedHours =
    workedMinutes / 60

  return {
    ...row,
    regular_hours: workedHours,
    overtime_hours: 0,
    total_hours: workedHours,
  }
}

function applyOvertime(
  rows: Row[],
  mode: string,
  dailyThreshold: number,
  weeklyThreshold: number
) {
  let weeklyRegularUsed = 0

  return rows.map((row) => {
    const base = calculateRow(row)

    const hours =
      base.total_hours

    let regular = hours
    let overtime = 0

    if (mode === 'daily') {
      regular = Math.min(
        hours,
        dailyThreshold
      )

      overtime = Math.max(
        0,
        hours - dailyThreshold
      )
    }

    if (
      mode === 'weekly' ||
      mode === 'custom'
    ) {
      const remainingRegular =
        Math.max(
          0,
          weeklyThreshold -
            weeklyRegularUsed
        )

      regular = Math.min(
        hours,
        remainingRegular
      )

      overtime = Math.max(
        0,
        hours - remainingRegular
      )

      weeklyRegularUsed += regular
    }

    return {
      ...base,
      regular_hours: regular,
      overtime_hours: overtime,
      total_hours:
        regular + overtime,
    }
  })
}

function parseEmployee(text: string) {
  const match = text.match(
    /Employee\s*Name\s*:\s*([^\n\r]+)/i
  )

  if (!match) return ''

  return match[1]
    .split(
      /Agency\s*Name|Facility\s*(?:Name|Namo)|Week\s*Ending/i
    )[0]
    .trim()
}

function findTimesInText(text: string) {
  const cleaned = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/\s+/g, ' ')

  const matches =
    cleaned.match(
      /\b(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:AM|PM)?\b/gi
    ) || []

  const result: string[] = []

  for (const item of matches) {
    const formatted =
      formatDetectedTime(item)

    if (!formatted) continue

    if (parseTime(formatted) === null) {
      continue
    }

    result.push(formatted)
  }

  return result
}

function plausibleShift(
  startText: string,
  endText: string
) {
  const start = parseTime(startText)
  const end = parseTime(endText)

  if (
    start === null ||
    end === null
  ) {
    return false
  }

  let duration = end - start

  if (duration < 0) {
    duration += 24 * 60
  }

  // Reject very short or implausibly
  // long shifts.
  return (
    duration >= 30 &&
    duration <= 18 * 60
  )
}

async function recognizeCanvas(
  canvas: HTMLCanvasElement
) {
  const Tesseract =
    await import('tesseract.js')

  const result =
    await Tesseract.recognize(
      canvas,
      'eng'
    )

  return result.data.text || ''
}

function createEnhancedCrop(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  xPercent: number,
  yPercent: number,
  widthPercent: number,
  heightPercent: number,
  scale = 2.5
) {
  const sourceX =
    imageWidth * xPercent

  const sourceY =
    imageHeight * yPercent

  const sourceWidth =
    imageWidth * widthPercent

  const sourceHeight =
    imageHeight * heightPercent

  const canvas =
    document.createElement('canvas')

  canvas.width =
    Math.round(sourceWidth * scale)

  canvas.height =
    Math.round(sourceHeight * scale)

  const context =
    canvas.getContext('2d')

  if (!context) {
    throw new Error(
      'Could not prepare OCR image.'
    )
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )

  const pixels =
    imageData.data

  for (
    let i = 0;
    i < pixels.length;
    i += 4
  ) {
    const gray =
      0.299 * pixels[i] +
      0.587 * pixels[i + 1] +
      0.114 * pixels[i + 2]

    // Increase contrast while keeping
    // handwriting visible.
    const adjusted =
      (gray - 128) * 1.6 + 128

    const value = Math.max(
      0,
      Math.min(255, adjusted)
    )

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

async function extractRowsFromImage(
  file: File
): Promise<Row[]> {
  const bitmap =
    await createImageBitmap(file)

  try {
    /*
      Your form appears to have the
      work-time table in the middle
      portion of the page.

      We scan roughly that region and
      divide it into seven horizontal
      bands.
    */

    const tableTop = 0.25
    const tableHeight = 0.50

    const bandHeight =
      tableHeight / 7

    const detectedRows =
      defaultRows()

    for (
      let index = 0;
      index < 7;
      index++
    ) {
      const y =
        tableTop +
        index * bandHeight

      const crop =
        createEnhancedCrop(
          bitmap,
          bitmap.width,
          bitmap.height,

          // Ignore the far-left and
          // far-right page margins.
          0.06,
          y,
          0.88,
          bandHeight,
          3
        )

      const rowText =
        await recognizeCanvas(crop)

      console.log(
        `OCR ROW ${DAYS[index]}:`,
        rowText
      )

      const times =
        findTimesInText(rowText)

      console.log(
        `TIMES ${DAYS[index]}:`,
        times
      )

      if (times.length < 2) {
        continue
      }

      let selectedIn = ''
      let selectedOut = ''

      // Find the first plausible pair
      // instead of blindly using numbers.
      for (
        let first = 0;
        first < times.length - 1;
        first++
      ) {
        for (
          let second = first + 1;
          second < times.length;
          second++
        ) {
          if (
            plausibleShift(
              times[first],
              times[second]
            )
          ) {
            selectedIn =
              times[first]

            selectedOut =
              times[second]

            break
          }
        }

        if (selectedIn) {
          break
        }
      }

      if (
        selectedIn &&
        selectedOut
      ) {
        detectedRows[index] = {
          ...detectedRows[index],

          clock_in:
            selectedIn,

          clock_out:
            selectedOut,
        }
      }
    }

    return detectedRows
  } finally {
    bitmap.close()
  }
}

async function runImageOcr(
  file: File
) {
  const Tesseract =
    await import('tesseract.js')

  const result =
    await Tesseract.recognize(
      file,
      'eng'
    )

  return result.data.text || ''
}

async function runPdfOcr(
  file: File
) {
  const pdfjs =
    await import('pdfjs-dist')

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
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      )

    const content =
      await page.getTextContent()

    const embedded =
      content.items
        .map(
          (item: any) =>
            item.str || ''
        )
        .join(' ')
        .trim()

    if (embedded.length > 40) {
      allText +=
        '\n' + embedded

      continue
    }

    try {
      const viewport =
        page.getViewport({
          scale: 2,
        })

      const canvas =
        document.createElement(
          'canvas'
        )

      const context =
        canvas.getContext('2d')

      if (!context) continue

      canvas.width =
        viewport.width

      canvas.height =
        viewport.height

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise

      const text =
        await recognizeCanvas(
          canvas
        )

      allText +=
        '\n' + text
    } catch (error) {
      console.warn(
        'PDF OCR page failed:',
        error
      )
    }
  }

  return allText.trim()
}

export default function Home() {
  const [
    employee,
    setEmployee,
  ] = useState('')

  const [
    rows,
    setRows,
  ] = useState<Row[]>(
    defaultRows()
  )

  const [
    otMode,
    setOtMode,
  ] = useState('none')

  const [
    dailyThreshold,
    setDailyThreshold,
  ] = useState(8)

  const [
    weeklyThreshold,
    setWeeklyThreshold,
  ] = useState(40)

  const [
    message,
    setMessage,
  ] = useState('')

  const [
    summary,
    setSummary,
  ] = useState<any>(null)

  const fileRef =
    useRef<HTMLInputElement>(
      null
    )

  const calculatedRows =
    useMemo(
      () =>
        applyOvertime(
          rows,
          otMode,
          dailyThreshold,
          weeklyThreshold
        ),
      [
        rows,
        otMode,
        dailyThreshold,
        weeklyThreshold,
      ]
    )

  const totals =
    useMemo(() => {
      return calculatedRows.reduce(
        (total, row) => ({
          regular:
            total.regular +
            row.regular_hours,

          overtime:
            total.overtime +
            row.overtime_hours,

          total:
            total.total +
            row.total_hours,
        }),
        {
          regular: 0,
          overtime: 0,
          total: 0,
        }
      )
    }, [calculatedRows])

  const payload =
    useMemo(
      () => ({
        timecard: {
          employee_name:
            employee,

          week_start: '',
          week_end: '',

          rows:
            calculatedRows,
        },

        overtime: {
          mode: otMode,

          daily_threshold:
            dailyThreshold,

          weekly_threshold:
            weeklyThreshold,

          custom_threshold:
            weeklyThreshold,
        },

        holiday_in_regular:
          false,

        on_call_in_regular:
          false,

        call_back_in_regular:
          false,
      }),
      [
        employee,
        calculatedRows,
        otMode,
        dailyThreshold,
        weeklyThreshold,
      ]
    )

  function updateRow(
    index: number,
    key: keyof Row,
    value: any
  ) {
    setRows((current) =>
      current.map(
        (row, rowIndex) =>
          rowIndex === index
            ? {
                ...row,
                [key]: value,
              }
            : row
      )
    )
  }

  async function upload(
    file?: File
  ) {
    if (!file) return

    setSummary(null)

    const ext = file.name
      .toLowerCase()
      .split('.')
      .pop()

    try {
      if (
        ['jpg', 'jpeg', 'png'].includes(
          ext || ''
        )
      ) {
        setMessage(
          'Reading employee and daily clock times. This may take a little while…'
        )

        const fullText =
          await runImageOcr(
            file
          )

        console.log(
          'OCR FULL TEXT:',
          fullText
        )

        const name =
          parseEmployee(
            fullText
          )

        if (name) {
          setEmployee(name)
        }

        const detectedRows =
          await extractRowsFromImage(
            file
          )

        setRows(detectedRows)

        const detectedCount =
          detectedRows.filter(
            (row) =>
              row.clock_in &&
              row.clock_out
          ).length

        if (
          name &&
          detectedCount > 0
        ) {
          setMessage(
            `OCR completed. Employee name and ${detectedCount} daily time row(s) were detected. Please verify every detected time.`
          )
        } else if (name) {
          setMessage(
            'Employee name was detected, but the handwritten clock times were not clear enough to fill automatically. Blank fields need manual review.'
          )
        } else if (
          detectedCount > 0
        ) {
          setMessage(
            `${detectedCount} daily time row(s) were detected. Please verify them and enter the employee name.`
          )
        } else {
          setMessage(
            'OCR could not confidently identify the employee or daily clock times. Please enter the blank fields manually.'
          )
        }

        return
      }

      if (ext === 'pdf') {
        setMessage(
          'Reading PDF…'
        )

        const text =
          await runPdfOcr(file)

        console.log(
          'PDF OCR TEXT:',
          text
        )

        const name =
          parseEmployee(text)

        if (name) {
          setEmployee(name)
        }

        setMessage(
          'PDF text was processed. For the most reliable handwritten clock-time detection, upload the timecard page as JPG or PNG.'
        )

        return
      }

      // CSV / Excel
      const form =
        new FormData()

      form.append(
        'file',
        file
      )

      const response =
        await fetch(
          `${API}/extract`,
          {
            method: 'POST',
            body: form,
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail ||
            'Upload failed'
        )
      }

      setEmployee(
        data.employee_name || ''
      )

      if (data.rows?.length) {
        setRows(
          data.rows
        )
      }

      setMessage(
        data.warnings?.[0] ||
          'Extraction complete. Please verify all extracted values.'
      )
    } catch (error: any) {
      console.error(error)

      setMessage(
        error?.message ||
          'Could not read timecard.'
      )
    }
  }

  async function calculateWithBackend() {
    setMessage('')

    try {
      const response =
        await fetch(
          `${API}/calculate`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.detail ||
            'Calculation failed'
        )
      }

      setSummary(
        data.summary
      )
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not calculate hours'
      )
    }
  }

  async function downloadCsv() {
    try {
      const response =
        await fetch(
          `${API}/export/csv`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        )

      if (!response.ok) {
        throw new Error(
          'Could not export CSV'
        )
      }

      const blob =
        await response.blob()

      const url =
        URL.createObjectURL(
          blob
        )

      const link =
        document.createElement(
          'a'
        )

      link.href = url

      link.download =
        'timecard-summary.csv'

      link.click()

      URL.revokeObjectURL(
        url
      )
    } catch (error: any) {
      setMessage(
        error?.message ||
          'Could not export CSV'
      )
    }
  }

  function reset() {
    setEmployee('')
    setRows(defaultRows())
    setOtMode('none')
    setDailyThreshold(8)
    setWeeklyThreshold(40)
    setMessage('')
    setSummary(null)

    if (fileRef.current) {
      fileRef.current.value =
        ''
    }
  }

  return (
    <main className="wrap">
      <nav className="nav">
        <div className="brand">
          TimeCard Calculator
        </div>

        <div>
          Privacy-first • No account required
        </div>
      </nav>

      <section className="hero">
        <h1>
          TimeCard Calculator
        </h1>

        <p>
          Upload your timecard or enter
          your hours manually. Detected
          values should always be reviewed.
        </p>

        <div className="actions">
          <button
            className="btn primary"
            onClick={() =>
              fileRef.current?.click()
            }
          >
            Upload Timecard
          </button>

          <button
            className="btn secondary"
            onClick={() =>
              document
                .getElementById(
                  'review'
                )
                ?.scrollIntoView({
                  behavior:
                    'smooth',
                })
            }
          >
            Enter Time Manually
          </button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".pdf,.xlsx,.csv,.jpg,.jpeg,.png"
            onChange={(event) =>
              upload(
                event.target
                  .files?.[0]
              )
            }
          />
        </div>
      </section>

      <section
        className="card"
        id="review"
      >
        <h2>
          Timecard review
        </h2>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="field">
          <label>
            Employee Name
          </label>

          <input
            value={employee}
            onChange={(event) =>
              setEmployee(
                event.target.value
              )
            }
          />
        </div>

        <h3>
          Time entries
        </h3>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>
                  Break (min)
                </th>
                <th>Regular</th>
                <th>OT</th>
                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              {calculatedRows.map(
                (row, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        value={
                          row.day
                        }
                        onChange={(
                          event
                        ) =>
                          updateRow(
                            index,
                            'day',
                            event
                              .target
                              .value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          rows[index]
                            .clock_in
                        }
                        placeholder=""
                        onChange={(
                          event
                        ) =>
                          updateRow(
                            index,
                            'clock_in',
                            event
                              .target
                              .value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={
                          rows[index]
                            .clock_out
                        }
                        placeholder=""
                        onChange={(
                          event
                        ) =>
                          updateRow(
                            index,
                            'clock_out',
                            event
                              .target
                              .value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min="0"
                        value={
                          rows[index]
                            .break_minutes
                        }
                        onChange={(
                          event
                        ) =>
                          updateRow(
                            index,
                            'break_minutes',
                            Number(
                              event
                                .target
                                .value
                            )
                          )
                        }
                      />
                    </td>

                    <td>
                      {row.regular_hours.toFixed(
                        2
                      )}
                    </td>

                    <td>
                      {row.overtime_hours.toFixed(
                        2
                      )}
                    </td>

                    <td>
                      <b>
                        {row.total_hours.toFixed(
                          2
                        )}
                      </b>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        <h3>
          Overtime settings
        </h3>

        <div className="grid2">
          <div className="field">
            <label>
              Rule
            </label>

            <select
              value={otMode}
              onChange={(event) =>
                setOtMode(
                  event.target.value
                )
              }
            >
              <option value="none">
                No overtime
              </option>

              <option value="daily">
                After daily threshold
              </option>

              <option value="weekly">
                After weekly threshold
              </option>

              <option value="custom">
                Custom weekly threshold
              </option>
            </select>
          </div>

          <div className="field">
            <label>
              {otMode === 'daily'
                ? 'Daily threshold'
                : 'Weekly/custom threshold'}
            </label>

            <input
              type="number"
              step="0.25"
              value={
                otMode === 'daily'
                  ? dailyThreshold
                  : weeklyThreshold
              }
              onChange={(event) => {
                const value =
                  Number(
                    event.target
                      .value
                  )

                if (
                  otMode === 'daily'
                ) {
                  setDailyThreshold(
                    value
                  )
                } else {
                  setWeeklyThreshold(
                    value
                  )
                }
              }}
            />
          </div>
        </div>

        <p
          style={{
            color: '#64748b',
            fontSize: 13,
          }}
        >
          Overtime rules vary by employer,
          contract, facility and
          jurisdiction. Select the rule
          that applies to you.
        </p>

        <div className="summary">
          <div className="metric">
            <span>
              Regular
            </span>

            <strong>
              {totals.regular.toFixed(
                2
              )}
            </strong>
          </div>

          <div className="metric">
            <span>
              Overtime
            </span>

            <strong>
              {totals.overtime.toFixed(
                2
              )}
            </strong>
          </div>

          <div className="metric">
            <span>
              Total
            </span>

            <strong>
              {totals.total.toFixed(
                2
              )}
            </strong>
          </div>
        </div>

        <div className="actions">
          <button
            className="btn primary"
            onClick={
              calculateWithBackend
            }
          >
            Finalize Calculation
          </button>

          <button
            className="btn secondary"
            onClick={
              downloadCsv
            }
          >
            Download CSV
          </button>

          <button
            className="btn secondary"
            onClick={() =>
              window.print()
            }
          >
            Print
          </button>

          <button
            className="btn secondary"
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </section>

      {summary && (
        <section className="card">
          <h2>
            Final summary
          </h2>

          <p>
            <b>
              {employee ||
                'Employee'}
            </b>
          </p>

          <div className="summary">
            <div className="metric">
              <span>
                Regular
              </span>

              <strong>
                {Number(
                  summary.regular_hours
                ).toFixed(2)}
              </strong>
            </div>

            <div className="metric">
              <span>
                Overtime
              </span>

              <strong>
                {Number(
                  summary.overtime_hours
                ).toFixed(2)}
              </strong>
            </div>

            <div className="metric">
              <span>
                Total
              </span>

              <strong>
                {Number(
                  summary.total_hours
                ).toFixed(2)}
              </strong>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>
          Privacy & trust
        </h2>

        <p>
          Uploaded documents are processed
          temporarily. OCR can make mistakes,
          particularly with handwriting.
          Review every detected value before
          using the final calculation.
        </p>
      </section>

      <footer className="footer">
        TimeCard Calculator MVP
      </footer>
    </main>
  )
}
