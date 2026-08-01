const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("node:dns");

// Use Google / Cloudflare Public DNS for SRV record resolution
// (fixes ECONNREFUSED on campus / ISP networks that block SRV lookups)
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Load environment variables
dotenv.config();

const User = require("./models/User");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const roomRoutes = require("./routes/rooms");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://0.0.0.0:5173",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
    ],
    credentials: true,
  })
);
app.use(express.json());

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rooms", roomRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
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

// ─── Connect to MongoDB & Start Server ──────────────────────────────────────
async function start() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGODB_URI is not set in .env");
      process.exit(1);
    }

    console.log("[db] Connecting to MongoDB Atlas...");
    await mongoose.connect(mongoUri, {
      family: 4,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
    console.log("[db] ✅ Connected to MongoDB Atlas");

    // Seed admin user after connection
    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`\n🚀 Hackord Backend running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Auth:   http://localhost:${PORT}/api/auth`);
      console.log(`   Admin:  http://localhost:${PORT}/api/admin\n`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
}

start();
