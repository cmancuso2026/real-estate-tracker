'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A compact multi-select dropdown. The trigger summarizes the current selection
 * ("All zips", or a row of tags for a subset); the open panel lists every
 * option as a checkbox with a Select all / Clear shortcut. Selection is fully
 * controlled — the parent owns the `selected` array.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  noun,
  renderLabel,
  className = '',
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Plural noun for the summary text, e.g. "zips" or "grades". */
  noun: string;
  /** Optional custom label for an option (defaults to the raw value). */
  renderLabel?: (value: string) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const allSelected = options.length > 0 && selected.length === options.length;
  const label = (v: string) => (renderLabel ? renderLabel(v) : v);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : // keep the parent's option order so tags read predictably
          options.filter((o) => o === value || selected.includes(o)),
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-[34px] min-w-[8rem] items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
      >
        <span className="flex flex-1 flex-wrap items-center gap-1 text-left">
          {allSelected || selected.length === 0 ? (
            <span className={selected.length === 0 ? 'text-gray-400' : ''}>
              {selected.length === 0 ? `No ${noun}` : `All ${noun}`}
            </span>
          ) : (
            selected.map((v) => (
              <span
                key={v}
                className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              >
                {label(v)}
              </span>
            ))
          )}
        </span>
        <span className="ml-auto shrink-0 text-gray-400">▾</span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 max-h-72 w-max min-w-full overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
            <button
              type="button"
              onClick={() => onChange([...options])}
              disabled={allSelected}
              className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
            >
              Clear
            </button>
          </div>
          {options.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => toggle(value)}
                className="h-4 w-4 accent-blue-600"
              />
              <span>{label(value)}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-gray-400">No {noun}</div>
          )}
        </div>
      )}
    </div>
  );
}
