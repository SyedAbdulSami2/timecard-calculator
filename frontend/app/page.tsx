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
  if (!value || !value.trim()) return null

  let text = value
    .trim()
    .toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, '')

  const meridiemMatch = text.match(/(AM|PM)$/)
  const meridiem = meridiemMatch?.[1] || ''

  if (meridiem) {
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

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null
    }

    if (meridiem === 'AM') {
      if (hours === 12) hours = 0
    }

    if (meridiem === 'PM') {
      if (hours !== 12) hours += 12
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

  let minutes = end - start

  // Overnight shift, for example 6:40 PM -> 7:13 AM
  if (minutes < 0) {
    minutes += 24 * 60
  }

  minutes -= Number(row.break_minutes || 0)

  if (minutes < 0) {
    return 0
  }

  return minutes
}

function minutesToDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2)
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>(defaultRows())
  const [message, setMessage] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const dailyMinutes = useMemo(
    () => rows.map((row) => getWorkedMinutes(row)),
    [rows]
  )

  const weeklyMinutes = useMemo(
    () =>
      dailyMinutes.reduce(
        (total, minutes) => total + minutes,
        0
      ),
    [dailyMinutes]
  )

  function updateRow(
    index: number,
    key: keyof Row,
    value: string | number
  ) {
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

  function reset() {
    setRows(defaultRows())
    setMessage('')

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  function printResults() {
    window.print()
  }

  async function upload(file?: File) {
    if (!file) return

    /*
      OCR will be added here next.

      For now this version keeps the calculator
      stable and accurate.

      The OCR step should eventually populate:
      clock_in
      clock_out
      break_minutes
    */

    setMessage(
      'Timecard selected. OCR auto-fill will be connected next. You can enter or correct the daily times manually.'
    )
  }

  return (
    <main className="wrap">
      <nav className="nav">
        <div className="brand">
          TimeCard Calculator
        </div>

        <div>
          No account required
        </div>
      </nav>

      <section className="hero">
        <h1>TimeCard Calculator</h1>

        <p>
          Upload a timecard or enter your daily hours manually.
          Daily and weekly totals update automatically.
        </p>

        <div className="actions">
          <button
            className="btn primary"
            onClick={() => fileRef.current?.click()}
          >
            Upload Timecard
          </button>

          <button
            className="btn secondary"
            onClick={() =>
              document
                .getElementById('entries')
                ?.scrollIntoView({
                  behavior: 'smooth',
                })
            }
          >
            Enter Time Manually
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
      </section>

      <section className="card" id="entries">
        <h2>Time entries</h2>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Break (min)</th>
                <th>Hours</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={row.day}>
                  <td>
                    <input
                      value={row.day}
                      onChange={(event) =>
                        updateRow(
                          index,
                          'day',
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={row.clock_in}
                      placeholder=""
                      onChange={(event) =>
                        updateRow(
                          index,
                          'clock_in',
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={row.clock_out}
                      placeholder=""
                      onChange={(event) =>
                        updateRow(
                          index,
                          'clock_out',
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
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
                  </td>

                  <td>
                    <strong>
                      {minutesToDecimalHours(
                        dailyMinutes[index]
                      )}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="card">
          <h2>Result</h2>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Summary</th>
                  <th>Hours</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  const minutes = dailyMinutes[index]

                  if (minutes <= 0) {
                    return null
                  }

                  return (
                    <tr key={`result-${row.day}`}>
                      <td>
                        {row.day}
                      </td>

                      <td>
                        {row.clock_in}
                        {' - '}
                        {row.clock_out}

                        {row.break_minutes > 0 && (
                          <>
                            <br />
                            {row.break_minutes} minutes break
                          </>
                        )}
                      </td>

                      <td>
                        <strong>
                          {minutesToDecimalHours(minutes)}
                        </strong>
                      </td>
                    </tr>
                  )
                })}

                <tr>
                  <td />
                  <td>
                    <strong>
                      Weekly Total:
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {minutesToDecimalHours(
                        weeklyMinutes
                      )}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="actions">
          <button
            className="btn primary"
            onClick={printResults}
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

      <section className="card">
        <h2>How totals are calculated</h2>

        <p>
          Minutes are converted to decimal hours by dividing
          by 60. For example, 33 minutes equals 0.55 hours.
        </p>

        <p>
          Overnight shifts are handled automatically. A shift
          from 6:40 PM to 7:13 AM is treated as continuing into
          the next day.
        </p>
      </section>

      <footer className="footer">
        TimeCard Calculator
      </footer>
    </main>
  )
}
