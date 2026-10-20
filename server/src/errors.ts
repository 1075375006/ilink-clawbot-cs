export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = "资源不存在"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function badRequest(message: string, code = "BAD_REQUEST"): AppError {
  return new AppError(400, code, message);
}
