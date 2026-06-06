import { GRADE_HEX, fmtDate, letterColorFromScore, type Letter } from '@/lib/format';
import type { HistoryPoint } from '@/lib/queries';

/**
 * Lightweight inline-SVG line chart of a property's overall score (0–4) across
 * its grading runs. No charting dependency — just an SVG polyline with dots
 * colored by the grade at each point. Rendered only when there are 2+ runs.
 */
export function GradeHistoryChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;

  const W = 600;
  const H = 180;
  const pad = { top: 16, right: 16, bottom: 28, left: 28 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const x = (i: number) =>
    pad.left + (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW);
  // Score domain 0..4 (F..A).
  const y = (score: number) => pad.top + innerH - (Math.max(0, Math.min(4, score)) / 4) * innerH;

  const linePath = history
    .map((h, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(h.overall_score).toFixed(1)}`)
    .join(' ');

  // Horizontal gridlines at each grade threshold.
  const gridlines = [
    { score: 4, label: 'A' },
    { score: 3, label: 'B' },
    { score: 2, label: 'C' },
    { score: 1, label: 'D' },
    { score: 0, label: 'F' },
  ];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-2xl"
        role="img"
        aria-label="Grade history over time"
      >
        {gridlines.map((g) => (
          <g key={g.label}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(g.score)}
              y2={y(g.score)}
              className="stroke-gray-200 dark:stroke-gray-800"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y(g.score) + 3}
              textAnchor="end"
              className="fill-gray-400 text-[9px]"
            >
              {g.label}
            </text>
          </g>
        ))}

        <path d={linePath} fill="none" className="stroke-blue-500" strokeWidth={2} />

        {history.map((h, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(h.overall_score)}
              r={4}
              fill={GRADE_HEX[h.overall_grade as Letter] ?? letterColorFromScore(h.overall_score)}
            />
            {(i === 0 || i === history.length - 1) && (
              <text
                x={x(i)}
                y={H - 10}
                textAnchor={i === 0 ? 'start' : 'end'}
                className="fill-gray-500 text-[9px]"
              >
                {fmtDate(h.graded_at)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
