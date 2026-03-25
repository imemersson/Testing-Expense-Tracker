const jwt = require("jsonwebtoken");
const HttpError = require("../utils/httpError");

module.exports = function auth(req, res, next) {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return next(new HttpError(401, "No token, authorization denied"));
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return next(new HttpError(401, "No token, authorization denied"));
  }

  if (!process.env.JWT_SECRET) {
    return next(new HttpError(500, "JWT secret is not configured"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const normalizedId = decoded.id || decoded.userId || decoded._id;
    if (!normalizedId) {
      return next(new HttpError(401, "Token payload missing user id"));
    }

    req.user = {
      ...decoded,
      id: normalizedId,
      userId: normalizedId
    };
    return next();
  } catch (err) {
    return next(new HttpError(401, "Token is not valid"));
  }
};
