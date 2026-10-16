"use client";

// Every screen calls the REST API with a bearer token; HR data is never pre-rendered into HTML.
const TOKEN_KEY = "hrms.access_token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export type ApiErrorBody = {
  error: string;
  message: string;
  request_id: string;
  details?: { field?: string; code: string; message: string; related_contract_id?: string }[];
  /** FINALIZE_CONFIRMATION_REQUIRED only (M-19). */
  warning_fingerprint?: string;
};

export class ApiCallError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<{ data: T; headers: Headers }> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.replace(new URL("/login", window.location.origin));
    }
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiCallError(res.status, body ?? { error: "NETWORK", message: "The server could not be reached.", request_id: "-" });
  }
  return { data: body as T, headers: res.headers };
}
