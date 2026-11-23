'use client';

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Chart } from 'react-chartjs-2';
import { fmt } from '@/lib/finance-ui/format';
import type { ChartModel } from '@/lib/finance-ui/chart';

ChartJS.register(LineController, BarController, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Legend, Tooltip, ChartDataLabels);
// Value labels are opt-in per chart (as on the old page).
ChartJS.defaults.set('plugins.datalabels', { display: false });

export type ChartKind = 'line' | 'bar';
export type StackMode = 'grouped' | 'stacked';

/** The Overview chart, styled like the old page's Chart.js config. */
export function FinanceChart({ model, kind, stack }: { model: ChartModel; kind: ChartKind; stack: StackMode }) {
  const stacked = kind === 'bar' && stack === 'stacked';

  const data: ChartData<'line' | 'bar'> = {
    labels: model.labels,
    datasets: model.series.map((s) =>
      kind === 'bar'
        ? {
            label: s.label,
            data: s.data,
            borderColor: s.color,
            backgroundColor: s.color, // solid bars
            borderWidth: 1,
            ...(stacked ? { stack: 'stack1' } : {}),
          }
        : {
            label: s.label,
            data: s.data,
            borderColor: s.color,
            backgroundColor: s.fillColor,
            borderWidth: 2.5,
            borderDash: s.dashed ? [6, 4] : undefined,
            pointBackgroundColor: s.color,
            pointRadius: s.pointRadius,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: s.fill,
          },
    ),
  };

  const font = { size: 11, family: 'Inter' };
  const options: ChartOptions<'line' | 'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 24 } },
    plugins: {
      legend: { position: 'top', labels: { font: { size: 12, family: 'Inter' }, boxWidth: 12, padding: 16 } },
      datalabels: {
        display: (c) => Math.abs(Number(c.dataset.data[c.dataIndex]) || 0) >= 0.01,
        anchor: stacked ? 'center' : 'end',
        align: stacked ? 'center' : 'top',
        color: stacked ? '#fff' : '#495057',
        font: { size: 10, weight: 600, family: 'Inter' },
        formatter: (v: number) => '$' + Math.round(v).toLocaleString(),
      },
      tooltip: {
        backgroundColor: '#fff',
        titleColor: '#1a1b2e',
        bodyColor: '#495057',
        borderColor: '#e2e5ef',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (ctx) =>
            ` ${ctx.dataset.label}: $${(ctx.parsed.y ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          afterBody: (items) => {
            if (!items.length) return '';
            const notes = model.notesByKey[model.keys[items[0]!.dataIndex]!] || [];
            if (!notes.length) return '';
            return ['', '📝 Notes:', ...notes.map((t) => ` ${fmt(t.amt)} · ${t.note}`)];
          },
        },
      },
    },
    scales: {
      x: { stacked, grid: { color: '#f0f2f8' }, ticks: { font, color: '#868e96' } },
      y: { stacked, grid: { color: '#f0f2f8' }, ticks: { font, color: '#868e96', callback: (v) => '$' + Number(v).toLocaleString() } },
    },
  };

  // key forces a fresh chart when the type changes (Chart.js can't morph line↔bar in place).
  return <Chart key={kind + stack} type={kind} data={data} options={options} />;
}
