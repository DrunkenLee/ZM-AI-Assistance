/**
 * Small helper to create Error objects carrying an HTTP status code.
 * The shared error handler (`src/middlewares/errorHandler.js`) reads `err.status`
 * and responds with `{ success: false, message }`, so anything thrown with this
 * helper becomes a clean JSON error without leaking stack traces to the client.
 */
function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = { createHttpError };
