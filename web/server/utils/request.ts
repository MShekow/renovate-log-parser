/**
 * Version-robust request helpers.
 *
 * Nuxt 4.4 / Nitro 2.13 ship a mix of h3 versions: the runtime app router is
 * h3 v1 (the event passed to handlers is a v1 `H3Event` whose `event.req` is a
 * Node `IncomingMessage`), while the auto-imported request helpers
 * (`readBody`, `readRawBody`, `getHeader`, `getQuery`) come from h3 v2 and call
 * `event.req.text()` / `event.req.headers.get()` — which throw on the v1 event.
 *
 * To stay correct across both, we read straight from the Node request object,
 * which is exposed as `event.node.req` on both event shapes and is still an
 * unconsumed stream when our handlers run.
 */
import type { H3Event } from 'h3'
import type { IncomingMessage } from 'node:http'

/** The underlying Node request, available on both h3 v1 and v2 events. */
function nodeReq(event: H3Event): IncomingMessage {
  return (event as unknown as { node: { req: IncomingMessage } }).node.req
}

/** Read the full raw request body as a Buffer by draining the Node stream. */
export async function readBodyBytes(event: H3Event): Promise<Buffer> {
  const req = nodeReq(event)
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array))
    }
  }
  return Buffer.concat(chunks)
}

/** Read and JSON-parse the request body (empty body -> `{}`). */
export async function readJsonBody<T = unknown>(event: H3Event): Promise<T> {
  const bytes = await readBodyBytes(event)
  const text = bytes.toString('utf8').trim()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body.' })
  }
}

/** Parse the query string from the original request URL. */
export function getQueryParams(event: H3Event): URLSearchParams {
  const req = nodeReq(event) as IncomingMessage & { originalUrl?: string }
  // The app router rewrites `req.url` during layer matching, but preserves the
  // full original (with query string) on `req.originalUrl`.
  const url = req.originalUrl ?? req.url ?? ''
  const qIndex = url.indexOf('?')
  return new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1))
}
