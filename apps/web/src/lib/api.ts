// Thin fetch wrapper for the BatteryOS API. The browser always talks to
// same-origin /api/*, which Next.js proxies to the FastAPI service, so the
// session cookie is first-party and httpOnly.

export class ApiError extends Error {
  status: number;
  detail: unknown;
  body: any;

  constructor(status: number, message: string, body: any) {
    super(message);
    this.status = status;
    this.detail = body?.detail;
    this.body = body;
  }
}

function messageFrom(status: number, body: any): string {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: any) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((x: any) => x !== "body").join(".") : "";
        const msg = String(d.msg ?? "Invalid value").replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }
  if (status === 0) return "Could not reach the server. Check that the API is running.";
  if (status >= 500) return "The server hit an error. Please try again.";
  return `Request failed (${status}).`;
}

type Options = {
  method?: string;
  body?: unknown;
  form?: FormData;
  params?: Record<string, string | number | boolean | string[] | undefined | null>;
  signal?: AbortSignal;
};

export function buildUrl(path: string, params?: Options["params"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, "http://local");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { "x-batteryos-client": "web" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(`/api${path}`, opts.params), {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, messageFrom(0, null), null);
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(res.status, messageFrom(res.status, data), data);
  }
  return data as T;
}

export const apiUrl = (path: string, params?: Options["params"]) => buildUrl(`/api${path}`, params);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
