/**
 * Thin fetch wrapper with timeout, basic retry on transient failures, and
 * JSON parsing. Uses Node's built-in global fetch (Node >= 18).
 */

export interface HttpOptions {
  headers?: Record<string, string>;
  /** Query params appended to the URL. Undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  retries?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export async function getJson<T = unknown>(
  url: string,
  opts: HttpOptions = {},
): Promise<T> {
  const { headers = {}, query, timeoutMs = 20_000, retries = 2 } = opts;

  const target = new URL(url);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        target.searchParams.set(key, String(value));
      }
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        headers: { accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new Error(
          `HTTP ${res.status} ${res.statusText} for ${target.pathname}` +
            (body ? ` — ${body.slice(0, 300)}` : ''),
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (attempt < retries && aborted) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (attempt < retries && !(err instanceof Error && err.message.startsWith('HTTP'))) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Request to ${url} failed`);
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt; // 500ms, 1s, 2s, ...
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
