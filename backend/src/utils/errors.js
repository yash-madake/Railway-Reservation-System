'use strict'

/**
 * Uniform error shape for every API response.
 * The frontend's ApiError reads exactly this envelope (lib/api/client.js).
 */

class HttpError extends Error {
  constructor(status, code, message, { field = null, details = null } = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.field = field
    this.details = details
  }
}

const badRequest = (message, field) => new HttpError(400, 'BAD_REQUEST', message, { field })
const forbidden = (message, code = 'FORBIDDEN') => new HttpError(403, code, message)
const notFound = (message) => new HttpError(404, 'NOT_FOUND', message)
const conflict = (message, code = 'CONFLICT') => new HttpError(409, code, message)
const upstream = (message, details) => new HttpError(502, 'GATEWAY_ERROR', message, { details })

/** Wrap an async route handler so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Terminal Express error handler. */
function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500
  const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR'

  if (status >= 500) {
    console.error(`[Yatrio] ${req.method} ${req.originalUrl} ->`, err.message)
  }

  res.status(status).json({
    error: {
      code,
      // Never leak internals to the client on a 500.
      message: status >= 500 ? 'An unexpected error occurred on the Yatrio server.' : err.message,
      field: err.field ?? null,
      details: status >= 500 ? null : (err.details ?? null),
    },
  })
}

module.exports = { HttpError, badRequest, forbidden, notFound, conflict, upstream, asyncHandler, errorHandler }