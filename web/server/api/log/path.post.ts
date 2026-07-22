/**
 * POST /api/log/path — load a log from an absolute local path and make it the
 * current log (plan Phase 4). Body: `{ "path": "<absolute>" }`. Blocks until the
 * log is parsed (or a valid cache is reused). Returns the load metadata.
 *
 * This reads any local absolute path unrestricted — the tool is a local,
 * single-user utility (plan Q21).
 */
export default defineEventHandler(async (event) => {
  const body = await readJsonBody<{ path?: unknown }>(event)
  const path = body?.path
  if (typeof path !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Request body must include a string "path".'
    })
  }
  return loadLogFromPath(path)
})
