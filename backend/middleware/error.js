const HttpError = require("../utils/httpError");

function notFound(req, res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = Number(err.statusCode || err.status || 500);
  let message = err.message;
  let details = err.details || null;

  if (err?.code === 11000) {
    statusCode = 409;
    message = "Resource already exists";
  } else if (err?.name === "ValidationError") {
    statusCode = 400;
    message = "Validation failed";
    details = Object.values(err.errors || {}).map((fieldError) => ({
      field: fieldError.path,
      message: fieldError.message
    }));
  } else if (err?.name === "CastError") {
    statusCode = 400;
    message = "Invalid identifier";
  }

  const safeMessage = statusCode >= 500 ? "Server error" : err.message || "Request failed";

  const payload = { message: statusCode >= 500 ? "Server error" : message || safeMessage };
  if (statusCode < 500 && details) {
    payload.details = details;
  }

  if (process.env.NODE_ENV !== "production" && statusCode >= 500 && message) {
    payload.error = message;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  notFound,
  errorHandler
};
