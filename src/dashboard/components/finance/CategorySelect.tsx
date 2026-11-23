'use client';

import { useState } from 'react';

/**
 * Per-row category dropdown. It renders only the current option until it's
 * focused or pressed, then fills in the full taxonomy: rendering ~60 options
 * for thousands of rows up front made the old table slow, so it did the same.
 */
export function CategorySelect({
  value,
  options,
  edited,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  edited: boolean;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [full, setFull] = useState(false);
  const isUncat = value === 'Uncategorized';
  const tone = isUncat
    ? 'border-orange-300 bg-orange-50 text-orange-800'
    : edited
      ? 'border-blue-300 bg-blue-50 text-blue-800'
      : 'border-gray-300 bg-white text-gray-800';
  const list = full ? (options.includes(value) ? options : [value, ...options]) : [value];
  return (
    <select
      aria-label="Category"
      value={value}
      disabled={disabled}
      onMouseDown={() => setFull(true)}
      onFocus={() => setFull(true)}
      onChange={(e) => onChange(e.target.value)}
      className={`max-w-[11rem] rounded-md border px-1.5 py-0.5 text-xs ${tone} disabled:opacity-50`}
    >
      {list.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}
