"use client";

import {
  ChangeEvent,
  useMemo,
  useRef,
  useState,
} from "react";


const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://timecard-calculator-api-docker.onrender.com";


const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;


type DayName = (typeof DAYS)[number];


type TimeRow = {
  day: DayName;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  needsReview: boolean;
};


type ExtractResponse = {
  raw_text?: string;
  text?: string;
  warnings?: string[];
  ocr_status?: string;
  document_mode?: string;
};


function createEmptyWeek(): TimeRow[] {
  return DAYS.map((day) => ({
    day,
    clockIn: "",
    clockOut: "",
    breakMinutes: 0,
    needsReview: false,
  }));
}


function normalizeTime(
  rawValue: string,
): string {
  if (!rawValue) {
    return "";
  }

  let value = rawValue
    .trim()
    .toUpperCase()
    .replace(/\./g, ":")
    .replace(/\s+/g, "");

  value = value
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1");

  const meridiemMatch = value.match(
    /(AM|PM)$/,
  );

  const meridiem = meridiemMatch?.[1] || "";

  value = value.replace(
    /(AM|PM)$/,
    "",
  );

  let hour: number;
  let minute: number;

  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const [hourText, minuteText] =
      value.split(":");

    hour = Number(hourText);
    minute = Number(minuteText);
  } else if (/^\d{3}$/.test(value)) {
    hour = Number(value.slice(0, 1));
    minute = Number(value.slice(1));
  } else if (/^\d{4}$/.test(value)) {
    hour = Number(value.slice(0, 2));
    minute = Number(value.slice(2));
  } else {
    return "";
  }

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return "";
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return "";
    }

    if (hour === 12) {
      hour = 0;
    }

    if (meridiem === "PM") {
      hour += 12;
    }
  } else if (hour < 0 || hour > 23) {
    return "";
  }

  return `${String(hour).padStart(
    2,
    "0",
  )}:${String(minute).padStart(
    2,
    "0",
  )}`;
}


function timeToMinutes(
  value: string,
): number | null {
  const normalized =
    normalizeTime(value);

  if (!normalized) {
    return null;
  }

  const [hour, minute] =
    normalized
      .split(":")
      .map(Number);

  return hour * 60 + minute;
}


function calculateWorkedMinutes(
  clockIn: string,
  clockOut: string,
  breakMinutes: number,
): number {
  const start =
    timeToMinutes(clockIn);

  const end =
    timeToMinutes(clockOut);

  if (
    start === null ||
    end === null
  ) {
    return 0;
  }

  let worked = end - start;

  if (worked < 0) {
    worked += 24 * 60;
  }

  worked -= Math.max(
    0,
    Number(breakMinutes) || 0,
  );

  return Math.max(
    0,
    worked,
  );
}


function formatMinutes(
  totalMinutes: number,
): string {
  if (!totalMinutes) {
    return "—";
  }

  const hours = Math.floor(
    totalMinutes / 60,
  );

  const minutes =
    totalMinutes % 60;

  return `${hours}:${String(
    minutes,
  ).padStart(2, "0")}`;
}


function formatDecimal(
  totalMinutes: number,
): string {
  if (!totalMinutes) {
    return "0.00";
  }

  return (
    totalMinutes / 60
  ).toFixed(2);
}


function findTimes(
  text: string,
): string[] {
  const matches =
    text.match(
      /\b(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{3,4}\s*(?:AM|PM)?)\b/gi,
    ) || [];

  const results: string[] = [];

  for (const match of matches) {
    const normalized =
      normalizeTime(match);

    if (
      normalized &&
      !results.includes(normalized)
    ) {
      results.push(normalized);
    }
  }

  return results;
}


function dayFromText(
  text: string,
): DayName | null {
  const lower =
    text.toLowerCase();

  const patterns: Array<
    [RegExp, DayName]
  > = [
    [/\bsun(?:day)?\b/i, "Sunday"],
    [/\bmon(?:day)?\b/i, "Monday"],
    [/\btue(?:s|sday|day)?\b/i, "Tuesday"],
    [/\bwed(?:nesday)?\b/i, "Wednesday"],
    [/\bthu(?:r|rs|rsday|rday)?\b/i, "Thursday"],
    [/\bfri(?:day)?\b/i, "Friday"],
    [/\bsat(?:urday)?\b/i, "Saturday"],
  ];

  for (const [
    pattern,
    day,
  ] of patterns) {
    if (pattern.test(lower)) {
      return day;
    }
  }

  return null;
}


function parseOcrWeek(
  rawText: string,
): TimeRow[] {
  const week =
    createEmptyWeek();

  if (!rawText.trim()) {
    return week;
  }

  const cleaned = rawText
    .replace(/\r/g, "\n")
    .replace(/[|]+/g, " ")
    .replace(/[ \t]+/g, " ");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const currentLine =
      lines[index];

    const day =
      dayFromText(currentLine);

    if (!day) {
      continue;
    }

    /*
     * Read the current row plus a few following OCR lines.
     * OCR frequently breaks one table row over several lines.
     */
    const block = lines
      .slice(
        index,
        index + 4,
      )
      .join(" ");

    let times =
      findTimes(block);

    /*
     * Remove values that are very likely dates.
     * Example:
     * 02/26/23
     */
    times = times.filter(
      (time) => {
        const [
          hour,
          minute,
        ] = time
          .split(":")
          .map(Number);

        return !(
          hour > 23 ||
          minute > 59
        );
      },
    );

    if (times.length < 2) {
      continue;
    }

    const dayIndex =
      DAYS.indexOf(day);

    /*
     * Initially use first and last detected times.
     *
     * This works better than blindly using the first two
     * when a timecard contains lunch-out/lunch-in values.
     */
    const clockIn =
      times[0];

    const clockOut =
      times[times.length - 1];

    const duration =
      calculateWorkedMinutes(
        clockIn,
        clockOut,
        0,
      );

    /*
     * Reject obviously impossible OCR matches.
     */
    if (
      duration <= 0 ||
      duration > 18 * 60
    ) {
      continue;
    }

    week[dayIndex] = {
      ...week[dayIndex],
      clockIn,
      clockOut,
      needsReview:
        times.length > 2,
    };
  }

  return week;
}


export default function Home() {
  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const [
    rows,
    setRows,
  ] = useState<TimeRow[]>(
    createEmptyWeek,
  );

  const [
    uploading,
    setUploading,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState(
    "Upload a timecard or enter hours manually.",
  );

  const [
    uploadedFile,
    setUploadedFile,
  ] = useState("");

  const [
    ocrText,
    setOcrText,
  ] = useState("");


  const calculatedRows =
    useMemo(
      () =>
        rows.map((row) => {
          const minutes =
            calculateWorkedMinutes(
              row.clockIn,
              row.clockOut,
              row.breakMinutes,
            );

          return {
            ...row,
            minutes,
            decimalHours:
              formatDecimal(
                minutes,
              ),
          };
        }),
      [rows],
    );


  const totalMinutes =
    useMemo(
      () =>
        calculatedRows.reduce(
          (
            total,
            row,
          ) =>
            total +
            row.minutes,
          0,
        ),
      [calculatedRows],
    );


  function updateRow(
    index: number,
    field:
      | "clockIn"
      | "clockOut"
      | "breakMinutes",
    value: string | number,
  ) {
    setRows(
      (currentRows) =>
        currentRows.map(
          (
            row,
            rowIndex,
          ) => {
            if (
              rowIndex !==
              index
            ) {
              return row;
            }

            return {
              ...row,
              [field]:
                field ===
                "breakMinutes"
                  ? Math.max(
                      0,
                      Number(
                        value,
                      ) || 0,
                    )
                  : value,
              needsReview:
                false,
            };
          },
        ),
    );
  }


  async function handleFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setUploadedFile(
      file.name,
    );

    setMessage(
      "Reading timecard...",
    );

    try {
      const formData =
        new FormData();

      formData.append(
        "file",
        file,
      );

      /*
       * We use /extract because this endpoint currently
       * performs the working Docker/Tesseract OCR.
       */
      const response =
        await fetch(
          `${API_URL}/extract`,
          {
            method: "POST",
            body: formData,
          },
        );

      if (!response.ok) {
        let detail =
          "Could not read the timecard.";

        try {
          const error =
            await response.json();

          detail =
            error?.detail ||
            detail;
        } catch {
          // Ignore JSON parse failure.
        }

        throw new Error(
          detail,
        );
      }

      const data: ExtractResponse =
        await response.json();

      const rawText =
        data.raw_text ||
        data.text ||
        "";

      setOcrText(
        rawText,
      );

      if (
        !rawText.trim()
      ) {
        setRows(
          createEmptyWeek(),
        );

        setMessage(
          "The document was opened, but readable work times were not detected. Please enter them manually.",
        );

        return;
      }

      const detectedWeek =
        parseOcrWeek(
          rawText,
        );

      const detectedCount =
        detectedWeek.filter(
          (row) =>
            row.clockIn &&
            row.clockOut,
        ).length;

      setRows(
        detectedWeek,
      );

      if (
        detectedCount === 0
      ) {
        setMessage(
          "The document was read, but reliable clock-in and clock-out pairs were not detected. Please enter or correct the times manually.",
        );
      } else {
        const reviewCount =
          detectedWeek.filter(
            (row) =>
              row.needsReview,
          ).length;

        if (
          reviewCount > 0
        ) {
          setMessage(
            `${detectedCount} workday(s) detected. ${reviewCount} row(s) should be reviewed.`,
          );
        } else {
          setMessage(
            `${detectedCount} workday(s) detected. Please verify the extracted times.`,
          );
        }
      }
    } catch (error) {
      console.error(
        error,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not read the uploaded timecard.",
      );
    } finally {
      setUploading(
        false,
      );

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    }
  }


  function resetCalculator() {
    setRows(
      createEmptyWeek(),
    );

    setUploadedFile("");
    setOcrText("");

    setMessage(
      "Upload a timecard or enter hours manually.",
    );
  }


  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-inner">
          <p className="eyebrow">
            TIMECARD CALCULATOR
          </p>

          <h1>
            Calculate Work Hours
            Automatically
          </h1>

          <p className="hero-copy">
            Upload a PDF,
            scanned timecard,
            screenshot, or photo.
            The calculator will
            read the work times
            and calculate the
            weekly total.
          </p>

          <div className="hero-actions">
            <label
              className={`primary-button ${
                uploading
                  ? "button-disabled"
                  : ""
              }`}
            >
              {uploading
                ? "Reading Timecard..."
                : "Upload Timecard"}

              <input
                ref={
                  fileInputRef
                }
                type="file"
                hidden
                disabled={
                  uploading
                }
                accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                onChange={
                  handleFile
                }
              />
            </label>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                resetCalculator();

                setMessage(
                  "Manual entry mode. Enter clock-in and clock-out times below.",
                );
              }}
            >
              Enter Hours Manually
            </button>
          </div>

          {uploadedFile && (
            <p className="uploaded-file">
              File:{" "}
              {uploadedFile}
            </p>
          )}
        </div>
      </section>


      <section className="calculator-card">
        <header className="calculator-header">
          <h2>
            Time Card Calculator
          </h2>

          <p>
            Review automatically
            detected hours or
            enter the work times
            manually.
          </p>
        </header>


        <div className="status-message">
          {message}
        </div>


        <div className="time-table">
          <div className="time-table-header">
            <div>DAY</div>
            <div>CLOCK IN</div>
            <div>CLOCK OUT</div>
            <div>BREAK</div>
            <div>HOURS</div>
          </div>


          {calculatedRows.map(
            (
              row,
              index,
            ) => (
              <div
                className={`time-row ${
                  row.needsReview
                    ? "time-row-review"
                    : ""
                }`}
                key={
                  row.day
                }
              >
                <div className="day-cell">
                  <strong>
                    {row.day}
                  </strong>

                  {row.needsReview && (
                    <span className="review-badge">
                      Review
                    </span>
                  )}
                </div>


                <div>
                  <input
                    className="time-input"
                    type="time"
                    value={
                      row.clockIn
                    }
                    onChange={(
                      event,
                    ) =>
                      updateRow(
                        index,
                        "clockIn",
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </div>


                <div>
                  <input
                    className="time-input"
                    type="time"
                    value={
                      row.clockOut
                    }
                    onChange={(
                      event,
                    ) =>
                      updateRow(
                        index,
                        "clockOut",
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </div>


                <div>
                  <div className="break-field">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={
                        row.breakMinutes
                      }
                      onChange={(
                        event,
                      ) =>
                        updateRow(
                          index,
                          "breakMinutes",
                          event
                            .target
                            .value,
                        )
                      }
                    />

                    <span>
                      min
                    </span>
                  </div>
                </div>


                <div className="hours-cell">
                  {row.minutes >
                  0 ? (
                    <>
                      <strong>
                        {formatMinutes(
                          row.minutes,
                        )}
                      </strong>

                      <small>
                        {
                          row.decimalHours
                        }{" "}
                        decimal
                      </small>
                    </>
                  ) : (
                    <span className="empty-hours">
                      —
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>


        <div className="calculator-actions">
          <button
            type="button"
            className="reset-button"
            onClick={
              resetCalculator
            }
          >
            Reset
          </button>
        </div>
      </section>


      <section className="results-card">
        <div className="results-top">
          <div>
            <p className="eyebrow">
              WORK HOURS SUMMARY
            </p>

            <h2>
              Calculated Results
            </h2>
          </div>

          <div className="total-hours-card">
            <span>
              TOTAL HOURS
            </span>

            <strong>
              {formatMinutes(
                totalMinutes,
              )}
            </strong>

            <small>
              {formatDecimal(
                totalMinutes,
              )}{" "}
              decimal hours
            </small>
          </div>
        </div>


        <div className="results-table">
          <div className="results-header">
            <div>DAY</div>
            <div>WORK PERIOD</div>
            <div>BREAK</div>
            <div>HOURS</div>
          </div>


          {calculatedRows
            .filter(
              (row) =>
                row.clockIn &&
                row.clockOut,
            )
            .map(
              (row) => (
                <div
                  className="result-row"
                  key={
                    `result-${row.day}`
                  }
                >
                  <div>
                    <strong>
                      {row.day}
                    </strong>
                  </div>

                  <div>
                    {
                      row.clockIn
                    }{" "}
                    →{" "}
                    {
                      row.clockOut
                    }
                  </div>

                  <div>
                    {row.breakMinutes
                      ? `${row.breakMinutes} min`
                      : "—"}
                  </div>

                  <div className="result-hours">
                    <strong>
                      {formatMinutes(
                        row.minutes,
                      )}
                    </strong>

                    <small>
                      {
                        row.decimalHours
                      }{" "}
                      decimal
                    </small>
                  </div>
                </div>
              ),
            )}


          {calculatedRows.filter(
            (row) =>
              row.clockIn &&
              row.clockOut,
          ).length ===
            0 && (
            <div className="no-results">
              No work hours
              entered yet.
            </div>
          )}
        </div>


        <div className="weekly-total">
          <div>
            <span>
              TOTAL WEEKLY HOURS
            </span>

            <strong>
              {formatMinutes(
                totalMinutes,
              )}
            </strong>
          </div>

          <div>
            <span>
              DECIMAL HOURS
            </span>

            <strong>
              {formatDecimal(
                totalMinutes,
              )}
            </strong>
          </div>
        </div>
      </section>


      {process.env.NODE_ENV ===
        "development" &&
        ocrText && (
          <details className="debug-card">
            <summary>
              OCR Debug Text
            </summary>

            <pre>
              {ocrText}
            </pre>
          </details>
        )}
    </main>
  );
}
