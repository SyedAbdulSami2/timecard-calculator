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

  /*
    If somebody enters 17:50PM,
    treat it as 17:50 instead of rejecting it.
  */
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

  // Overnight shift
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

export default function Home() {
  const [rows, setRows] = useState<Row[]>(defaultRows())

  const [entryMode, setEntryMode] =
    useState<'upload' | 'manual'>('manual')

  const [submitted, setSubmitted] = useState(false)

  const [message, setMessage] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const dailyMinutes = useMemo(
    () => rows.map(getWorkedMinutes),
    [rows]
  )

  const weeklyMinutes = useMemo(
    () =>
      dailyMinutes.reduce(
        (sum, minutes) => sum + minutes,
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

    setMessage(
      'Timecard uploaded. OCR auto-fill can be connected here next.'
    )

    /*
      Your free OCR logic can be connected here.

      After OCR fills rows:

      setRows(detectedRows)
      setSubmitted(true)
    */
  }

  function submitManual() {
    const completedRows = rows.filter(
      (row) =>
        row.clock_in.trim() &&
        row.clock_out.trim()
    )

    if (completedRows.length === 0) {
      setMessage(
        'Please enter at least one Clock In and Clock Out.'
      )
      return
    }

    const invalidRow = completedRows.find(
      (row) =>
        parseTime(row.clock_in) === null ||
        parseTime(row.clock_out) === null
    )

    if (invalidRow) {
      setMessage(
        `Please check the time format for ${invalidRow.day}. Use examples like 6:40AM, 5:50PM, or 17:50.`
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
    }, 50)
  }

  function reset() {
    setRows(defaultRows())
    setEntryMode('manual')
    setSubmitted(false)
    setMessage('')

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  return (
    <main className="calculatorPage">
      <section className="topBar">
        <div className="brandBlock">
          <div className="brandIcon">TC</div>

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
            manually. Breaks and overnight shifts are
            handled automatically.
          </p>

          <div className="heroActions">
            <button
              className="primaryButton"
              onClick={() =>
                fileRef.current?.click()
              }
            >
              Upload Timecard
            </button>

            <button
              className="secondaryButton"
              onClick={startManualEntry}
            >
              Enter Manually
            </button>

            <input
              ref={fileRef}
              hidden
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(event) =>
                upload(event.target.files?.[0])
              }
            />
          </div>
        </div>

        <div className="heroStat">
          <span>Supports</span>
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
              Use formats like 6:40AM, 5:50PM,
              06:40, or 17:50.
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

          {rows.map((row, index) => (
            <div
              className="timeRow"
              key={row.day}
            >
              <div className="dayCell">
                {row.day}
              </div>

              <input
                className="timeInput"
                value={row.clock_in}
                placeholder="e.g. 6:40AM"
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
                placeholder="e.g. 5:50PM"
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
                  value={row.break_minutes}
                  onChange={(event) =>
                    updateRow(
                      index,
                      'break_minutes',
                      Number(event.target.value)
                    )
                  }
                />

                <span>min</span>
              </div>

              <div className="hoursPreview">
                {dailyMinutes[index] > 0
                  ? decimalHours(
                      dailyMinutes[index]
                    )
                  : '—'}
              </div>
            </div>
          ))}
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

            {rows.map((row, index) => {
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
                  key={`result-${row.day}`}
                >
                  <div>
                    <strong>
                      {row.day}
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
            })}
          </div>

          <div className="resultFooter">
            <div>
              <span>
                Total weekly hours
              </span>

              <strong>
                {decimalHours(
                  weeklyMinutes
                )} hours
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
            Minutes are divided by 60.
            For example, 33 minutes =
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
            Clocking out the following morning is
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
            Break minutes are deducted before
            decimal hours are calculated.
          </p>
        </div>
      </section>

      <footer className="siteFooter">
        TimeCard Calculator
      </footer>
    </main>
  )
}
