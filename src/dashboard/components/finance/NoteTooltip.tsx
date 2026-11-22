'use client';

import { useEffect, useRef } from 'react';

/**
 * Instant hover tooltip for anything with a `data-note` attribute (note badges,
 * Spending-table cells). Mounted once in the finance layout; a native `title`
 * tooltip is slow to appear, which is why the old page used this approach.
 */
export function NoteTooltip() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const hide = () => (tip.style.display = 'none');
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-note]');
      if (!el) return;
      const n = el.getAttribute('data-note');
      if (!n) return hide();
      tip.textContent = n;
      tip.style.display = 'block';
    };
    const move = (e: MouseEvent) => {
      if (tip.style.display === 'none') return;
      if (!(e.target as Element | null)?.closest?.('[data-note]')) return hide();
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12);
      const y = Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 12);
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    };
    const out = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-note]')) hide();
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseout', out);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseout', out);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ display: 'none' }}
      className="pointer-events-none fixed z-50 max-w-xs whitespace-pre-line rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-lg"
    />
  );
}
