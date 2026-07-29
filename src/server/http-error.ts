/**
 * Minimal HTTP error type for the Express API.
 *
 * Replaces h3's `createError`: handlers and the log registry throw these, and
 * the Express error middleware in `api.ts` turns them into a JSON response.
 * Anything that is not an {@link HttpError} is treated as a 500.
 */

/** An error carrying the HTTP status it should be reported with. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly statusMessage: string;

  constructor(statusCode: number, statusMessage: string) {
    super(statusMessage);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
  }
}

/** Create an {@link HttpError} (h3-compatible call shape). */
export function createError(options: {
  statusCode: number;
  statusMessage: string;
}): HttpError {
  return new HttpError(options.statusCode, options.statusMessage);
}
