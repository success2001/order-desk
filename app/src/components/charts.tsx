import { useState } from 'react'
import { axisTicks, labelledIndexes, niceMax } from './chartScale'

// Small, dependency-free charts for the dashboard (inline SVG / HTML).
// Single series, so no legend: the title says what's plotted. Bars use the
// --chart-bar token, validated against the light and dark card surfaces.

export interface BarDatum {
  key: string
  /** Category label, e.g. "Sat 10". */
  label: string
  value: number
  /** The value as shown to people, e.g. "₦25,000" or "3 orders". */
  display: string
}

const W = 340
const H = 170
const M = { top: 16, right: 4, bottom: 22, left: 36 }
const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom
const MAX_BAR = 24
const GAP = 2
const RADIUS = 4

/** A column with a rounded data-end (top) and a square baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, height, width / 2)
  const bottom = y + height
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`
}

/**
 * Column chart over categories (e.g. days). Every bar has a hover/focus/tap
 * tooltip; the highest value is labelled directly; a table view follows.
 */
export function ColumnChart({
  title,
  data,
  formatTick,
  labelEvery = 1,
  wholeNumbers = false,
}: {
  title: string
  data: BarDatum[]
  formatTick: (value: number) => string
  /** Show every nth x-axis label, counted back from the last (always shown). */
  labelEvery?: number
  /** Values are counts: no fractional gridlines. */
  wholeNumbers?: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const band = PLOT_W / data.length
  const barW = Math.min(MAX_BAR, band - GAP)
  const y = (v: number) => M.top + PLOT_H - (v / max) * PLOT_H
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? 0) ? i : best), -1)
  const ticks = axisTicks(max, wholeNumbers)
  const labelled = labelledIndexes(data.length, labelEvery)

  const current = active === null ? null : data[active]
  const tipLeft = active === null ? 0 : Math.min(85, Math.max(15, ((M.left + band * (active + 0.5)) / W) * 100))

  return (
    <figure className="chart">
      <figcaption className="chart__title">{title}</figcaption>
      <div className="chart__frame">
        {current && (
          <div className="chart__tooltip" style={{ left: `${tipLeft}%` }} role="status">
            <strong>{current.display}</strong>
            <span>{current.label}</span>
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Values are in the table below.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart__grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="chart__tick" x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = M.left + band * i + (band - barW) / 2
            const height = PLOT_H - (y(d.value) - M.top)
            const showLabel = labelled.has(i)
            return (
              <g key={d.key}>
                {d.value > 0 && (
                  <path
                    className={active === null || active === i ? 'chart__bar' : 'chart__bar chart__bar--dim'}
                    d={columnPath(x, y(d.value), barW, height)}
                  />
                )}
                {i === peak && d.value > 0 && (
                  <text className="chart__value" x={x + barW / 2} y={y(d.value) - 4} textAnchor="middle">
                    {d.display}
                  </text>
                )}
                {showLabel && (
                  <text className="chart__tick" x={x + barW / 2} y={H - 6} textAnchor="middle">
                    {d.label}
                  </text>
                )}
                {/* Hit target: the whole column band, bigger than the bar. */}
                <rect
                  className="chart__hit"
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={PLOT_H}
                  tabIndex={0}
                  aria-label={`${d.label}: ${d.display}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
        </svg>
      </div>
      <details className="chart__table">
        <summary>Show as table</summary>
        <table>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                <td>{d.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars for a few categories, each labelled with its value. */
export function BreakdownBars({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="breakdown">
      <h4 className="breakdown__title">{title}</h4>
      <ul className="breakdown__rows">
        {rows.map((r) => (
          <li key={r.label} className="breakdown__row">
            <span className="breakdown__label">{r.label}</span>
            <span className="breakdown__track">
              {r.value > 0 && <span className="breakdown__bar" style={{ width: `${(r.value / max) * 100}%` }} />}
              <span className="breakdown__value">{r.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
