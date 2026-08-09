const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("node:dns");

// Load environment variables
dotenv.config();

// Use Google / Cloudflare Public DNS for SRV record resolution in local environments
try {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
  }
} catch (err) {
  console.warn("[dns] Warning setting custom DNS servers:", err.message);
}

const User = require("./models/User");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const roomRoutes = require("./routes/rooms");
const userRoutes = require("./routes/users");
const invitationRoutes = require("./routes/invitations");
const noteRoutes = require("./routes/notes");
const hackathonRoutes = require("./routes/hackathons");
const contactRoutes = require("./routes/contact");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Dynamic CORS Middleware ────────────────────────────────────────────────
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((s) => s.trim().replace(/\/+$/, ""))
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      const cleanedOrigin = origin.replace(/\/+$/, "");

      // Localhost origins
      if (
        cleanedOrigin.startsWith("http://localhost") ||
        cleanedOrigin.startsWith("http://127.0.0.1") ||
        cleanedOrigin.startsWith("http://0.0.0.0") ||
        cleanedOrigin.startsWith("http://localhost:5173")||
        cleanedOrigin.startsWith("http://127.0.0.1:5173")||
        cleanedOrigin.startsWith("https://hackord-backend.vercel.app")||
        cleanedOrigin.startsWith("https://hackord-backend.onrender.com")
      ) {
        return callback(null, true);
      }

      // Check configured FRONTEND_URL or common deployment domains
      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(cleanedOrigin) ||
        cleanedOrigin.endsWith(".vercel.app") ||
        cleanedOrigin.endsWith(".onrender.com") ||
        cleanedOrigin.endsWith(".netlify.app")
      ) {
        return callback(null, true);
      }

      // Fallback: allow origin in production to prevent unexpected CORS blocks
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json());

// ─── MongoDB Connection & Seed Handler ───────────────────────────────────────
let isConnected = false;
let dbPromise = null;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  if (dbPromise) {
    return dbPromise;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI is not set in environment variables");
    throw new Error("MONGODB_URI environment variable is missing");
  }

  dbPromise = mongoose
    .connect(mongoUri, {
      family: 4,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    })
    .then(async (db) => {
      isConnected = true;
      console.log("[db] ✅ Connected to MongoDB Atlas");
      await seedAdmin();
      return db;
    })
    .catch((err) => {
      dbPromise = null;
      console.error("❌ Failed to connect to MongoDB:", err.message);
      throw err;
    });

  return dbPromise;
}

// Ensure DB connection for every request (essential for Vercel serverless & Render)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("[db middleware error]", err.message);
    res.status(500).json({
      error: "Database Connection Error",
      message: err.message || "Failed to connect to MongoDB Atlas",
    });
  }
});

// ─── Seed Admin User ────────────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.log("[seed] No admin credentials in .env — skipping admin seed");
      return;
    }

    const emailClean = adminEmail.toLowerCase().trim();
    const existing = await User.findOne({ email: emailClean });
    if (existing) {
      const isMatch = await existing.comparePassword(adminPassword);
      if (!isMatch || existing.role !== "admin") {
        existing.password = adminPassword; // pre('save') will hash the new password
        existing.role = "admin";
        await existing.save();
        console.log("[seed] ✅ Updated admin password & role for:", emailClean);
      } else {
        console.log("[seed] ✅ Admin user already exists and credentials match:", emailClean);
      }
      return;
    }

    await User.create({
      name: "Hackord Admin",
      email: emailClean,
      password: adminPassword,
      role: "admin",
      username: "admin",
      avatar: "https://api.dicebear.com/9.x/bottts/svg?seed=admin",
      bio: "Hackord platform administrator",
      experience: "Advanced",
    });

    console.log("[seed] ✅ Admin user created:", emailClean);
  } catch (err) {
    console.error("[seed] Error seeding admin:", err.message);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/users", userRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/hackathons", hackathonRoutes);
app.use("/api/contact", contactRoutes);

// Root & Health check endpoints
app.get(["/", "/api"], (req, res) => {
  res.json({
    status: "ok",
    message: "🚀 Hackord Backend API is live and operational",
    health: "/api/health",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Catch-all 404 for API routes
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.url} not found` });
});

// ─── Server Start (for Render / Local Node processes) ────────────────────────
async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`\n🚀 Hackord Backend running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Auth:   http://localhost:${PORT}/api/auth`);
      console.log(`   Admin:  http://localhost:${PORT}/api/admin\n`);

      // Initialize automated daily scraping background scheduler (every 24 hours)
      const { scrapeHackathonsToFile } = require("./services/scraperService");
      console.log("[Scheduler] ⏰ Initializing automated 24-hour daily hackathon scraper...");
      scrapeHackathonsToFile().catch((err) =>
        console.error("[Scheduler] Initial daily scrape error:", err.message)
      );
      setInterval(() => {
        console.log("[Scheduler] ⏰ Running automated 24-hour daily hackathon scrape...");
        scrapeHackathonsToFile().catch((err) =>
          console.error("[Scheduler] Daily scrape error:", err.message)
        );
      }, 24 * 60 * 60 * 1000);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

// Export express app for Vercel Serverless
module.exports = app;
