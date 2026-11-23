'use client';

import { Chart as ChartJS, LinearScale, Tooltip, type ChartOptions } from 'chart.js';
import { Flow, SankeyController } from 'chartjs-chart-sankey';
import { Chart } from 'react-chartjs-2';
import { SAVED, SHORTFALL, TOTAL, type SankeyModel } from '@/lib/finance-ui/sankey';

ChartJS.register(SankeyController, Flow, LinearScale, Tooltip);

const GREEN = '#2f9e44';
const RED = '#e03131';
const BLUE = '#3b5bdb';
const ORANGE = '#f08c00';
const GROUP_COLORS = ['#e8590c', '#c2255c', '#7048e8', '#1c7ed6', '#0c8599', '#5c940d', '#e67700', '#862e9c', '#495057'];

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/** Colour of a node: income green, total blue, saved green, shortfall orange, each group its own. */
function colorFor(key: string, groupIndex: Map<string, number>, parentOf: Map<string, string>): string {
  if (key.startsWith('in:')) return GREEN;
  if (key === TOTAL) return BLUE;
  if (key === SAVED) return GREEN;
  if (key === SHORTFALL) return ORANGE;
  const g = key.startsWith('grp:') ? key : key.startsWith('more:') ? `grp:${key.slice(5)}` : parentOf.get(key);
  return g ? GROUP_COLORS[(groupIndex.get(g) ?? 0) % GROUP_COLORS.length]! : RED;
}

/**
 * Income → Total Income → spending groups → categories, with $ and % of income
 * in tooltips. Click a group (or any flow into it) to zoom into that group
 * (onPickGroup). A zoomed model (group → categories → merchants) colours each
 * category and shows % of the group's spending.
 */
export function SankeyChart({ model, onPickGroup }: { model: SankeyModel; onPickGroup?: (group: string) => void }) {
  const zoomed = !(TOTAL in model.labels);
  const groups = zoomed
    ? model.flows.filter((f) => f.from.startsWith('grp:')).map((f) => f.to) // categories get the colours
    : model.flows.filter((f) => f.from === TOTAL && f.to.startsWith('grp:')).map((f) => f.to);
  const groupIndex = new Map(groups.map((g, i) => [g, i]));
  const parentOf = new Map(model.flows.filter((f) => (zoomed ? f.from.startsWith('cat:') : f.from.startsWith('grp:'))).map((f) => [f.to, f.from]));
  const color = (k: string) => (zoomed && k.startsWith('grp:') ? BLUE : colorFor(k, groupIndex, parentOf));
  const pctOfIncome = (v: number) =>
    zoomed
      ? `${((v / model.spending) * 100).toFixed(1)}% of ${Object.values(model.labels)[0]} spending`
      : model.income > 0
        ? `${((v / model.income) * 100).toFixed(1)}% of income`
        : 'no income in this period';
  const groupOfFlow = (f: { from: string; to: string }) =>
    [f.to, f.from].map((k) => (k.startsWith('grp:') ? k.slice(4) : k.startsWith('more:') ? k.slice(5) : null)).find(Boolean) ?? null;

  const data = {
    datasets: [
      {
        label: 'Money flow',
        data: model.flows,
        labels: model.labels,
        column: model.columns,
        colorFrom: (c: { dataset: { data: unknown[] }; dataIndex: number }) => color((c.dataset.data[c.dataIndex] as { from: string }).from),
        colorTo: (c: { dataset: { data: unknown[] }; dataIndex: number }) => color((c.dataset.data[c.dataIndex] as { to: string }).to),
        colorMode: 'gradient' as const,
        borderWidth: 0,
        nodeWidth: 12,
        nodePadding: 18,
        size: 'max' as const,
        font: { size: 12, family: 'Inter' },
        color: '#1a1b2e',
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    onClick: (_e: unknown, els: { index: number }[]) => {
      if (zoomed || !onPickGroup || !els.length) return;
      const g = groupOfFlow(model.flows[els[0]!.index]!);
      if (g) onPickGroup(g);
    },
    onHover: (e: { native?: { target?: HTMLElement } }, els: unknown[]) => {
      const el = e.native?.target;
      if (el) el.style.cursor = !zoomed && onPickGroup && els.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      datalabels: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        titleColor: '#1a1b2e',
        bodyColor: '#495057',
        borderColor: '#dee2e6',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: () => '',
          label: (c: { raw: unknown }) => {
            const f = c.raw as { from: string; to: string; flow: number };
            return `${model.labels[f.from]} → ${model.labels[f.to]}: ${money(f.flow)} (${pctOfIncome(f.flow)})`;
          },
        },
      },
    },
  } as unknown as ChartOptions<'sankey'>;

  return <Chart type="sankey" data={data as never} options={options} />;
}
