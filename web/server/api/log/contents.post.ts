/**
 * POST /api/log/contents — load a log from uploaded bytes (file picker). The
 * bytes are written to a temp file named by their md5, which becomes the log's
 * `path`. The file contents are sent as the raw request
 * body.
 */
export default defineEventHandler(async (event) => {
  const bytes = await readBodyBytes(event)
  if (bytes.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Request body was empty.'
    })
  }
  return loadLogFromBytes(bytes)
})
