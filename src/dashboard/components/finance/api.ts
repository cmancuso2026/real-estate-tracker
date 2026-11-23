/** Small fetch wrapper with the old page's error behavior: throws the API's { error } message. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `${method} ${path} failed (${r.status})`);
  return data as T;
}

export const financeApi = {
  get: <T,>(path: string) => call<T>('GET', path),
  put: <T,>(path: string, body: unknown) => call<T>('PUT', path, body),
  post: <T,>(path: string, body?: unknown) => call<T>('POST', path, body),
  patch: <T,>(path: string, body: unknown) => call<T>('PATCH', path, body),
  del: <T,>(path: string) => call<T>('DELETE', path),
};
