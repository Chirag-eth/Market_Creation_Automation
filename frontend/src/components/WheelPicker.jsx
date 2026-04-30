import { useState, useRef, useEffect } from 'react'

// ── Constants ────────────────────────────────────────────────────────
const ANGLE  = 20    // degrees between adjacent items on the cylinder
const RADIUS = 100   // cylinder radius in px
const PERSP  = 320   // CSS perspective distance in px
const DRAG   = 42    // pixels of drag = 1 item step
const FRIC   = 0.905 // per-frame velocity decay (momentum friction)
const H      = 200   // wheel container height px
const SLOT   = 44    // center selection slot height px
const LOOPS  = 500   // virtual list repetitions (500 × n ≈ "infinite")

// ── WheelPicker ──────────────────────────────────────────────────────
export default function WheelPicker({ items, initIndex = 0, onChange, width = 80 }) {
  const n    = items.length
  // Park the virtual scroll pointer near the middle of the loop space
  const INIT = LOOPS / 2 * n + (((initIndex % n) + n) % n)

  const posRef      = useRef(INIT)
  const [pos, setPos] = useState(INIT)
  const velRef      = useRef(0)
  const rafRef      = useRef(null)
  const dragging    = useRef(false)
  const lastY       = useRef(0)
  const lastT       = useRef(0)
  const lastTick    = useRef(Math.round(INIT))
  const containerRef = useRef(null)
  const wheelTimer  = useRef(null)

  // Keep latest onChange ref so closures never go stale
  const cbRef   = useRef(onChange)
  cbRef.current = onChange

  // ── Mouse-wheel scroll (non-passive so preventDefault works) ──────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleWheel(e) {
      e.preventDefault()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      // deltaMode 1 = line (each notch ~1 item), 0 = pixel (~80px/item feel)
      const delta = e.deltaMode === 1 ? e.deltaY : e.deltaY / 80

      posRef.current += delta
      setPos(posRef.current)
      fire(posRef.current)

      // Settle to nearest item after scroll pauses
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      wheelTimer.current = setTimeout(() => settle(Math.round(posRef.current)), 150)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Haptic + notify ───────────────────────────────────────────────
  function fire(p) {
    const t = Math.round(p)
    if (t !== lastTick.current) {
      lastTick.current = t
      try { navigator.vibrate(1) } catch (_) {}
      cbRef.current(((t % n) + n) % n)
    }
  }

  // ── Snap to nearest whole item ────────────────────────────────────
  function settle(target) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const go = () => {
      const d = target - posRef.current
      if (Math.abs(d) < 0.003) { posRef.current = target; setPos(target); return }
      posRef.current += d * 0.22
      setPos(posRef.current)
      rafRef.current = requestAnimationFrame(go)
    }
    rafRef.current = requestAnimationFrame(go)
  }

  // ── Momentum / inertia ────────────────────────────────────────────
  function spin() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const go = () => {
      velRef.current *= FRIC
      if (Math.abs(velRef.current) < 0.01) { settle(Math.round(posRef.current)); return }
      posRef.current += velRef.current
      setPos(posRef.current)
      fire(posRef.current)
      rafRef.current = requestAnimationFrame(go)
    }
    rafRef.current = requestAnimationFrame(go)
  }

  // ── Pointer events ────────────────────────────────────────────────
  function onDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    dragging.current = true
    lastY.current    = e.clientY
    lastT.current    = performance.now()
    velRef.current   = 0
  }

  function onMove(e) {
    if (!dragging.current) return
    const now   = performance.now()
    const dy    = lastY.current - e.clientY
    const dt    = Math.max(1, now - lastT.current)
    const delta = dy / DRAG

    posRef.current += delta
    setPos(posRef.current)
    fire(posRef.current)

    velRef.current = (delta / dt) * 16   // normalise to items/frame at 60 fps
    lastY.current  = e.clientY
    lastT.current  = now
  }

  function onUp() {
    if (!dragging.current) return
    dragging.current = false
    spin()
  }

  // ── Build visible items ───────────────────────────────────────────
  // Render ±6 virtual slots — items outside ±90° disappear naturally
  // via backface-visibility: hidden and near-zero opacity
  const rows = []
  for (let i = -6; i <= 6; i++) {
    const vi  = Math.round(pos) + i
    const pfc = vi - pos                           // fractional position from center
    const deg = pfc * ANGLE
    const rad = deg * Math.PI / 180
    const op  = Math.max(0, Math.pow(Math.cos(rad), 1.5))
    rows.push({
      vi,
      label: items[((vi % n) + n) % n],
      deg,
      op,
    })
  }

  return (
    <div
      ref={containerRef}
      className="wheel"
      style={{ width, height: H, perspective: `${PERSP}px` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* 3-D drum */}
      <div className="wheel__drum">
        {rows.map(({ vi, label, deg, op }) => (
          <div
            key={vi}
            className="wheel__item"
            style={{
              transform: `rotateX(${-deg}deg) translateZ(${RADIUS}px)`,
              opacity: op,
              fontWeight: Math.abs(deg) < 10 ? 600 : 400,
              color:
                Math.abs(deg) < 22 ? 'var(--t1)' :
                Math.abs(deg) < 55 ? 'var(--t2)' : 'var(--t3)',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Selection window lines */}
      <div className="wheel__sel" />
    </div>
  )
}
