const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const passport = require("./config/passport");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

const requiredEnv = ["MONGO_URI", "JWT_SECRET", "SESSION_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

function buildAllowedOrigins() {
  const raw = [process.env.CORS_ORIGIN, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(",");

  if (!raw) {
    return [];
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const expanded = new Set();
  for (const origin of origins) {
    expanded.add(origin);
    expanded.add(origin.replace("127.0.0.1", "localhost"));
    expanded.add(origin.replace("localhost", "127.0.0.1"));
  }

  return [...expanded];
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"]
      }
    }
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use(passport.initialize());

app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

app.use("/api/auth", require("./routes/auth"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/budgets", require("./routes/budgets"));
app.use("/api/categories", require("./routes/categories"));

app.use(notFound);
app.use(errorHandler);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
