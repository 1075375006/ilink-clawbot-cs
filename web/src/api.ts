const BASE = "";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = options;
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? `请求失败（${response.status}）`,
    );
  }
  return payload as T;
}

export function uploadImage(file: File): Promise<{ url: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  return api<{ url: string; size: number }>("/api/uploads", {
    method: "POST",
    body: form,
  });
}
