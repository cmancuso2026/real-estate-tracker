import { GRADE_HEX, type Letter } from '@/lib/format';

const SIZES = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-14 w-14 text-2xl',
} as const;

/**
 * Color-coded round grade badge: A=green, B=blue, C=yellow, D=orange, F=red.
 * Colors are hardcoded hex with white text so the badge looks identical in
 * light and dark mode — no theme-dependent Tailwind color classes.
 */
export function GradeBadge({
  grade,
  size = 'md',
}: {
  grade: Letter | string | null;
  size?: keyof typeof SIZES;
}) {
  const letter = (grade ?? '—') as Letter;
  const background = GRADE_HEX[letter] ?? '#6b7280';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold shadow-sm ${SIZES[size]}`}
      style={{ backgroundColor: background, color: '#ffffff' }}
      title={`Grade ${letter}`}
    >
      {letter}
    </span>
  );
}
