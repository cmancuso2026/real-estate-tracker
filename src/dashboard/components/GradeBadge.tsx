import { GRADE_BADGE, type Letter } from '@/lib/format';

const SIZES = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-14 w-14 text-2xl',
} as const;

/** Color-coded round grade badge: A=green, B=blue, C=yellow, D=orange, F=red. */
export function GradeBadge({
  grade,
  size = 'md',
}: {
  grade: Letter | string | null;
  size?: keyof typeof SIZES;
}) {
  const letter = (grade ?? '—') as Letter;
  const color = GRADE_BADGE[letter] ?? 'bg-gray-400 text-white';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold ${color} ${SIZES[size]}`}
      title={`Grade ${letter}`}
    >
      {letter}
    </span>
  );
}
