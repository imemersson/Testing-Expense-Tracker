const User = require("../models/User");
const asyncHandler = require("./asyncHandler");
const HttpError = require("../utils/httpError");

module.exports = function requireRole(...allowedRoles) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user?.id) {
      throw new HttpError(401, "Unauthorized");
    }

    const user = await User.findById(req.user.id).select("name email role");
    if (!user) {
      throw new HttpError(401, "User not found");
    }

    if (!allowedRoles.includes(user.role)) {
      throw new HttpError(403, "Forbidden: insufficient permissions");
    }

    req.currentUser = user;
    next();
  });
};
