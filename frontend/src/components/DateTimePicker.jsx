import { useState, useMemo, useEffect } from "react";
import WheelPicker from "./WheelPicker.jsx";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

// Build the date wheel using LOCAL date strings (YYYY-MM-DD).
// Earlier this used d.toISOString().slice(0,10), which returns the UTC date —
// for any timezone east of UTC, local midnight maps to the prior calendar day
// in UTC, so the "Today" wheel actually emitted yesterday's date and every
// scheduled time landed 24h in the past. See bugs.md BUG-S003.
function localIsoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildDates() {
  const result = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    result.push({
      iso: localIsoDate(d),
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    });
  }
  return result;
}

// 17:40 → "5:40 PM". The wheel itself stays in 24h notation so operators who
// think in 24h can still pick directly; this is just a friendly readout.
function to12Hour(hour24, minute) {
  const h = Number(hour24);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${minute} ${period}`;
}

export default function DateTimePicker({ onChange, initValue }) {
  const dates = useMemo(buildDates, []);

  // Parse initValue (if provided) to seed wheel positions
  const init = useMemo(() => {
    if (initValue) {
      const [datePart, timePart] = initValue.split("T");
      const [hh, mm] = timePart.split(":").map(Number);
      const dIdx = dates.findIndex((d) => d.iso === datePart);
      return {
        dIdx: dIdx >= 0 ? dIdx : 1,
        hIdx: hh % 24,
        mIdx: Math.round(mm / 5) % 12,
      };
    }
    return { dIdx: 1, hIdx: 10, mIdx: 0 };
  }, [initValue]);

  const [dIdx, setDIdx] = useState(init.dIdx);
  const [hIdx, setHIdx] = useState(init.hIdx);
  const [mIdx, setMIdx] = useState(init.mIdx);

  const date = dates[dIdx % dates.length].iso;
  const hour = HOURS[hIdx % 24];
  const min = MINUTES[mIdx % 12];

  // `${date}T${hour}:${min}` (no Z, no offset) — parsed as LOCAL time.
  // Same string we hand to onChange; api.js then runs new Date(...).toISOString()
  // to convert local → UTC before POSTing.
  const selectedLocal = new Date(`${date}T${hour}:${min}`);
  const isPast = selectedLocal.getTime() <= Date.now();
  const twelveHour = to12Hour(hour, min);

  useEffect(() => {
    onChange(`${date}T${hour}:${min}`);
  }, [dIdx, hIdx, mIdx]);

  return (
    <div className="dtpicker">
      <div className="dtpicker__wheels">
        <WheelPicker
          items={dates.map((d) => d.label)}
          initIndex={init.dIdx}
          onChange={setDIdx}
          width={148}
        />
        <div className="dtpicker__divider" />
        <WheelPicker items={HOURS} initIndex={init.hIdx} onChange={setHIdx} width={58} />
        <div className="dtpicker__colon">:</div>
        <WheelPicker items={MINUTES} initIndex={init.mIdx} onChange={setMIdx} width={58} />
      </div>
      <div className={`dtpicker__preview${isPast ? " dtpicker__preview--past" : ""}`}>
        {isPast ? `${twelveHour} — scheduled time must be in the future` : twelveHour}
      </div>
    </div>
  );
}
