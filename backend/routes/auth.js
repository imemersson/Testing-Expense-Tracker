const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const { body, param } = require("express-validator");
const User = require("../models/User");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const requireRole = require("../middleware/requireRole");
const asyncHandler = require("../middleware/asyncHandler");
const HttpError = require("../utils/httpError");
const { getStorageBucket } = require("../config/firebase");
const {
  deleteObject: deleteS3Object,
  getSignedReadUrl: getSignedS3ReadUrl,
  isS3Configured,
  putObject: putS3Object
} = require("../config/s3");

const router = express.Router();
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const LOCAL_STORAGE_PREFIX = "local:";
const S3_STORAGE_PREFIX = "s3:";
const LOCAL_UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const PROFILE_IMAGE_DIR = "profile-images";

function getProfileImageStorageMode() {
  const mode = String(process.env.PROFILE_IMAGE_STORAGE || "auto")
    .trim()
    .toLowerCase();

  if (["local", "firebase", "s3", "auto"].includes(mode)) {
    return mode;
  }

  return "auto";
}

function toPosixPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function isLocalStoragePath(objectPath) {
  return String(objectPath || "").startsWith(LOCAL_STORAGE_PREFIX);
}

function isS3StoragePath(objectPath) {
  return String(objectPath || "").startsWith(S3_STORAGE_PREFIX);
}

function getLocalRelativePath(objectPath) {
  return toPosixPath(String(objectPath || "").slice(LOCAL_STORAGE_PREFIX.length));
}

function getS3Key(objectPath) {
  return toPosixPath(String(objectPath || "").slice(S3_STORAGE_PREFIX.length));
}

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function buildLocalProfileImageUrl(req, objectPath) {
  const relativePath = getLocalRelativePath(objectPath);
  if (!relativePath) {
    return "";
  }

  return `${getPublicBaseUrl(req)}/uploads/${relativePath}`;
}

async function storeProfileImageLocally(req, userId, imageBuffer, extension) {
  const relativePath = path.posix.join(
    PROFILE_IMAGE_DIR,
    String(userId),
    `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extension}`
  );
  const absolutePath = path.join(LOCAL_UPLOADS_DIR, ...relativePath.split("/"));

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, imageBuffer);

  return {
    objectPath: `${LOCAL_STORAGE_PREFIX}${relativePath}`,
    publicUrl: `${getPublicBaseUrl(req)}/uploads/${relativePath}`
  };
}

async function deleteLocalProfileImage(objectPath) {
  const relativePath = getLocalRelativePath(objectPath);
  if (!relativePath) {
    return;
  }

  const absolutePath = path.join(LOCAL_UPLOADS_DIR, ...relativePath.split("/"));
  try {
    await fs.unlink(absolutePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }
}

function mapFirebaseStorageError(err) {
  const statusCode = Number(err?.code);
  const errMessage = String(err?.message || "");

  if (statusCode === 404 || /bucket/i.test(errMessage)) {
    return new HttpError(
      503,
      "Firebase storage bucket was not found. Check FIREBASE_STORAGE_BUCKET and ensure Storage is enabled in Firebase."
    );
  }

  if (statusCode === 401 || statusCode === 403) {
    return new HttpError(
      503,
      "Firebase storage access was denied. Verify service account permissions and Firebase project billing plan."
    );
  }

  return new HttpError(503, `Firebase storage initialization failed: ${errMessage || "unknown error"}`);
}

function mapS3StorageError(err) {
  const errMessage = String(err?.message || "");
  const statusCode = Number(err?.$metadata?.httpStatusCode || 0);

  if (err?.code === "AWS_SDK_NOT_INSTALLED") {
    return new HttpError(
      503,
      "AWS SDK is not installed. Run `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` in backend/."
    );
  }

  if (statusCode === 404 || err?.name === "NoSuchBucket") {
    return new HttpError(503, "S3 bucket was not found. Check AWS_S3_BUCKET and AWS_REGION.");
  }

  if (statusCode === 401 || statusCode === 403 || err?.name === "AccessDenied") {
    return new HttpError(
      503,
      "S3 access was denied. Verify AWS credentials and bucket permissions."
    );
  }

  return new HttpError(503, `S3 initialization failed: ${errMessage || "unknown error"}`);
}

async function resolveProfileImageStorage() {
  const mode = getProfileImageStorageMode();
  if (mode === "local") {
    return { provider: "local", bucket: null };
  }

  if (mode === "s3") {
    if (!isS3Configured()) {
      throw new HttpError(503, "S3 storage is not configured. Set AWS_S3_BUCKET and AWS_REGION.");
    }

    try {
      await getSignedS3ReadUrl({ key: `${PROFILE_IMAGE_DIR}/healthcheck`, expiresInSeconds: 60 });
    } catch (err) {
      throw mapS3StorageError(err);
    }

    return { provider: "s3", bucket: null };
  }

  if (mode === "auto" && isS3Configured()) {
    try {
      const url = await getSignedS3ReadUrl({ key: `${PROFILE_IMAGE_DIR}/healthcheck`, expiresInSeconds: 60 });
      if (url) {
        return { provider: "s3", bucket: null };
      }
    } catch (err) {
      console.warn(
        `S3 profile image storage unavailable (${err?.message || "unknown error"}); falling back to Firebase/local.`
      );
    }
  }

  try {
    const bucket = await getStorageBucket();
    if (bucket) {
      return { provider: "firebase", bucket };
    }

    if (mode === "firebase") {
      throw new HttpError(
        503,
        "Firebase storage is not configured. Set FIREBASE_STORAGE_BUCKET and ensure the bucket exists."
      );
    }
  } catch (err) {
    if (mode === "firebase") {
      if (err instanceof HttpError) {
        throw err;
      }
      throw mapFirebaseStorageError(err);
    }
  }

  return { provider: "local", bucket: null };
}

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new HttpError(500, "JWT secret is not configured");
  }

  return jwt.sign(
    { userId: String(user._id), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" }
  );
}

async function getProfileImageUrl(user, req) {
  if (user.profileImagePath) {
    if (isLocalStoragePath(user.profileImagePath)) {
      if (req) {
        return buildLocalProfileImageUrl(req, user.profileImagePath);
      }
      return user.profileImage || "";
    }

    if (isS3StoragePath(user.profileImagePath)) {
      try {
        const url = await getSignedS3ReadUrl({ key: getS3Key(user.profileImagePath) });
        return url || user.profileImage || "";
      } catch (err) {
        return "";
      }
    }

    try {
      const bucket = await getStorageBucket();
      if (!bucket) {
        return user.profileImage || "";
      }

      const [url] = await bucket.file(user.profileImagePath).getSignedUrl({
        action: "read",
        version: "v4",
        expires: Date.now() + 15 * 60 * 1000
      });
      return url;
    } catch (err) {
      return "";
    }
  }

  return user.profileImage || "";
}

async function toPublicUser(user, req) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: await getProfileImageUrl(user, req)
  };
}

router.post(
  "/register",
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ max: 80 })
      .withMessage("Name must be at most 80 characters"),
    body("email")
      .isEmail()
      .withMessage("Valid email is required")
      .normalizeEmail(),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters")
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      throw new HttpError(400, "Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "user"
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: await toPublicUser(user, req)
    });
  })
);

router.post(
  "/login",
  [
    body("email")
      .isEmail()
      .withMessage("Valid email is required")
      .normalizeEmail(),
    body("password")
      .isString()
      .withMessage("Password is required")
      .notEmpty()
      .withMessage("Password is required")
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      throw new HttpError(400, "Invalid credentials");
    }
    if (!user.password) {
      throw new HttpError(400, "Use Google login for this account");
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      throw new HttpError(400, "Invalid credentials");
    }

    const token = signToken(user);
    res.json({
      token,
      user: await toPublicUser(user, req)
    });
  })
);

router.get(
  "/me",
  auth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select(
      "name email role profileImage profileImagePath"
    );
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    res.json(await toPublicUser(user, req));
  })
);

router.put(
  "/change-password",
  auth,
  [
    body("currentPassword")
      .optional()
      .isString()
      .withMessage("Current password must be a string"),
    body("newPassword")
      .isString()
      .withMessage("New password is required")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters")
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    if (user.password) {
      if (!currentPassword) {
        throw new HttpError(400, "Current password is required");
      }

      const passwordMatches = await bcrypt.compare(String(currentPassword), user.password);
      if (!passwordMatches) {
        throw new HttpError(400, "Current password is incorrect");
      }
    }

    user.password = await bcrypt.hash(String(newPassword), 10);
    await user.save();

    res.json({ message: "Password updated successfully" });
  })
);

router.put(
  "/profile-picture",
  auth,
  [body("imageData").isString().notEmpty().withMessage("Image data is required")],
  validate,
  asyncHandler(async (req, res) => {
    const { provider, bucket } = await resolveProfileImageStorage();

    const user = await User.findById(req.user.id).select(
      "name email role profileImage profileImagePath"
    );
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const { imageData } = req.body;
    const imageMatch = imageData.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!imageMatch) {
      throw new HttpError(400, "Only PNG, JPG, and WEBP images are allowed");
    }

    const mimeType = imageMatch[1].toLowerCase();
    const binaryPayload = imageMatch[2];
    const imageBuffer = Buffer.from(binaryPayload, "base64");
    if (!imageBuffer.length || imageBuffer.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new HttpError(400, "Image must be 2MB or less");
    }

    const extensionMap = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp"
    };

    const extension = extensionMap[mimeType];
    let objectPath = "";
    let profileImage = "";

    if (provider === "firebase") {
      objectPath = `profile-images/${req.user.id}/${Date.now()}-${crypto
        .randomBytes(8)
        .toString("hex")}.${extension}`;

      await bucket.file(objectPath).save(imageBuffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          cacheControl: "private, max-age=0, no-transform"
        }
      });
    } else if (provider === "s3") {
      const objectKey = `profile-images/${req.user.id}/${Date.now()}-${crypto
        .randomBytes(8)
        .toString("hex")}.${extension}`;

      await putS3Object({
        key: objectKey,
        body: imageBuffer,
        contentType: mimeType,
        cacheControl: "private, max-age=0, no-transform"
      });

      objectPath = `${S3_STORAGE_PREFIX}${objectKey}`;
    } else {
      const stored = await storeProfileImageLocally(req, req.user.id, imageBuffer, extension);
      objectPath = stored.objectPath;
      profileImage = stored.publicUrl;
    }

    const previousPath = user.profileImagePath;
    user.profileImagePath = objectPath;
    user.profileImage = profileImage;
    await user.save();

    if (previousPath && previousPath !== objectPath) {
      if (isLocalStoragePath(previousPath)) {
        deleteLocalProfileImage(previousPath).catch(() => {});
      } else if (isS3StoragePath(previousPath)) {
        deleteS3Object({ key: getS3Key(previousPath) }).catch(() => {});
      } else if (bucket) {
        bucket
          .file(previousPath)
          .delete({ ignoreNotFound: true })
          .catch(() => {});
      }
    }

    res.json({
      message: "Profile picture updated successfully",
      user: await toPublicUser(user, req)
    });
  })
);

router.get(
  "/users",
  auth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const users = await User.find().select("name email role createdAt").sort({ createdAt: -1 });
    res.json({ users });
  })
);

router.patch(
  "/users/:id/role",
  auth,
  requireRole("admin"),
  [
    param("id").isMongoId().withMessage("Invalid user id"),
    body("role")
      .isString()
      .isIn(["admin", "user"])
      .withMessage("Role must be either admin or user")
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (String(req.currentUser._id) === String(id) && role !== "admin") {
      throw new HttpError(400, "You cannot remove your own admin role");
    }

    const user = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true }).select(
      "name email role profileImage profileImagePath"
    );
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    res.json({
      message: "User role updated",
      user: await toPublicUser(user, req)
    });
  })
);

function ensureGoogleOAuthConfigured(req, res, next) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    return res.status(503).json({
      message:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env to enable this endpoint."
    });
  }

  return next();
}

router.get(
  "/google",
  ensureGoogleOAuthConfigured,
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  ensureGoogleOAuthConfigured,
  passport.authenticate("google", { session: false, failureRedirect: "/index.html?error=oauth_failed" }),
  asyncHandler(async (req, res) => {
    const token = signToken(req.user);
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5000").replace(/\/+$/, "");

    const params = new URLSearchParams({
      token,
      name: req.user.name || ""
    });

    res.redirect(`${frontendUrl}/index.html#${params.toString()}`);
  })
);

module.exports = router;
