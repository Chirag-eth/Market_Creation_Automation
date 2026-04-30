import { useState, useMemo, useEffect } from 'react'
import WheelPicker from './WheelPicker.jsx'

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function buildDates() {
  const result = []
  const base   = new Date()
  base.setHours(0, 0, 0, 0)
  for (let i = 0; i < 30; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    result.push({
      iso: d.toISOString().slice(0, 10),
      label:
        i === 0 ? 'Today' :
        i === 1 ? 'Tomorrow' :
        d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    })
  }
  return result
}

export default function DateTimePicker({ onChange, initValue }) {
  const dates = useMemo(buildDates, [])

  // Parse initValue (if provided) to seed wheel positions
  const init = useMemo(() => {
    if (initValue) {
      const [datePart, timePart] = initValue.split('T')
      const [hh, mm]             = timePart.split(':').map(Number)
      const dIdx                 = dates.findIndex(d => d.iso === datePart)
      return {
        dIdx: dIdx >= 0 ? dIdx : 1,
        hIdx: hh % 24,
        mIdx: Math.round(mm / 5) % 12,
      }
    }
    return { dIdx: 1, hIdx: 10, mIdx: 0 }
  }, [initValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const [dIdx, setDIdx] = useState(init.dIdx)
  const [hIdx, setHIdx] = useState(init.hIdx)
  const [mIdx, setMIdx] = useState(init.mIdx)

  useEffect(() => {
    const date = dates[dIdx % dates.length].iso
    const hour = HOURS[hIdx % 24]
    const min  = MINUTES[mIdx % 12]
    onChange(`${date}T${hour}:${min}`)
  }, [dIdx, hIdx, mIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dtpicker">
      <WheelPicker items={dates.map(d => d.label)} initIndex={init.dIdx} onChange={setDIdx} width={148} />
      <div className="dtpicker__divider" />
      <WheelPicker items={HOURS}   initIndex={init.hIdx} onChange={setHIdx} width={58} />
      <div className="dtpicker__colon">:</div>
      <WheelPicker items={MINUTES} initIndex={init.mIdx} onChange={setMIdx} width={58} />
    </div>
  )
}
