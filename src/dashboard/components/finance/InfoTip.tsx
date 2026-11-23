/** A small ⓘ that shows how a number is calculated (hover, focus or tap). */
export function InfoTip({ text, testId }: { text: string; testId?: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        data-testid={testId}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold leading-none text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-5 z-20 w-64 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-gray-600 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
