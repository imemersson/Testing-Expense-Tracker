const { validationResult } = require("express-validator");
const HttpError = require("../utils/httpError");

module.exports = function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return next();
  }

  const details = result.array().map((item) => ({
    field: item.path,
    message: item.msg
  }));

  return next(new HttpError(400, "Validation failed", details));
};
