const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Invitation = require("../models/Invitation");
const { protect } = require("../middleware/auth");

const router = express.Router();

const SEED_USERS = [
  {
    name: "Kabir Singh",
    email: "kabir@example.com",
    username: "kabir_singh",
    college: "VIT Vellore",
    city: "Vellore",
    country: "India",
    bio: "Mobile App Developer passionate about Flutter and cross-platform UX.",
    experience: "Intermediate",
    skills: ["Flutter", "Firebase", "Dart", "UI/UX"],
    github: "github.com/kabir-singh",
    linkedin: "linkedin.com/in/kabir-singh",
    portfolio: "https://kabir.dev",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Kabir",
  },
  {
    name: "Ananya Iyer",
    email: "ananya@example.com",
    username: "ananya_iyer",
    college: "MIT Manipal",
    city: "Manipal",
    country: "India",
    bio: "Full-stack engineer specializing in Next.js, React, and modern web architectures.",
    experience: "Advanced",
    skills: ["React", "Next.js", "TypeScript", "Node.js", "TailwindCSS"],
    github: "github.com/ananya-iyer",
    linkedin: "linkedin.com/in/ananya-iyer",
    portfolio: "https://ananyaiyer.com",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Ananya",
  },
  {
    name: "Vivaan Kapoor",
    email: "vivaan@example.com",
    username: "vivaan_kapoor",
    college: "IIT Delhi",
    city: "New Delhi",
    country: "India",
    bio: "Web3 builder & smart contract security researcher. Hackathon enthusiast.",
    experience: "Advanced",
    skills: ["Blockchain", "Solidity", "Ethereum", "Rust", "Hardhat"],
    github: "github.com/vivaank",
    linkedin: "linkedin.com/in/vivaan-kapoor",
    portfolio: "https://vivaan.eth.limo",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Vivaan",
  },
  {
    name: "Meera Joshi",
    email: "meera@example.com",
    username: "meera_joshi",
    college: "IIIT Bangalore",
    city: "Bangalore",
    country: "India",
    bio: "AI/ML developer researching computer vision & LLM agents.",
    experience: "Intermediate",
    skills: ["AI/ML", "Python", "PyTorch", "OpenCV", "TensorFlow"],
    github: "github.com/meera-j",
    linkedin: "linkedin.com/in/meera-joshi",
    portfolio: "https://meera.ai",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Meera",
  },
  {
    name: "Aditya Verma",
    email: "aditya@example.com",
    username: "aditya_verma",
    college: "DTU",
    city: "Delhi",
    country: "India",
    bio: "Cloud & DevOps specialist building scalable microservices and CI/CD pipelines.",
    experience: "Advanced",
    skills: ["DevOps", "Docker", "Kubernetes", "Cyber Security", "AWS"],
    github: "github.com/aditya-v",
    linkedin: "linkedin.com/in/aditya-verma",
    portfolio: "https://aditya.io",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Aditya",
  },
  {
    name: "Sara Khan",
    email: "sara@example.com",
    username: "sara_khan",
    college: "NSUT",
    city: "Delhi",
    country: "India",
    bio: "Product designer focused on creating high-converting, accessible web interfaces.",
    experience: "Beginner",
    skills: ["UI/UX", "Figma", "Design Systems", "Prototyping"],
    github: "github.com/sarakhan",
    linkedin: "linkedin.com/in/sara-khan",
    portfolio: "https://sarakhan.design",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=Sara",
  },
];

async function ensureSeedUsers() {
  try {
    const count = await User.countDocuments({ role: "user" });
    if (count < 3) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("Password123!", salt);

      const usersToInsert = SEED_USERS.map((u) => ({
        ...u,
        password: hashedPassword,
        role: "user",
      }));

      await User.insertMany(usersToInsert);
      console.log("[users] ✅ Seeded sample user profiles in MongoDB");
    }
  } catch (err) {
    console.error("[users] Error seeding sample users:", err.message);
  }
}

// ─── GET /api/users/search ──────────────────────────────────────────────────
router.get("/search", async (req, res) => {
  try {
    await ensureSeedUsers();
    const query = req.query.q ? String(req.query.q).trim() : "";
    const excludeId = req.query.excludeId ? String(req.query.excludeId) : null;
    const excludeEmail = req.query.excludeEmail ? String(req.query.excludeEmail).toLowerCase() : null;

    let baseConditions = [
      { role: { $ne: "admin" } },
      { "privacySettings.discoverable": { $ne: false } },
    ];

    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      baseConditions.push({ _id: { $ne: excludeId } });
    }

    if (excludeEmail) {
      baseConditions.push({ email: { $ne: excludeEmail } });
    }

    let filter = { $and: baseConditions };

    if (query) {
      const regex = new RegExp(query, "i");
      baseConditions.push({
        $or: [
          { name: regex },
          { username: regex },
          { skills: regex },
          { github: regex },
          { linkedin: regex },
          { portfolio: regex },
          { college: regex },
          { bio: regex },
          { city: regex },
          { country: regex },
        ],
      });
      filter = { $and: baseConditions };
    }

    const users = await User.find(filter)
      .select("-password")
      .limit(30)
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    console.error("[searchUsers]", err);
    res.status(500).json({ message: "Server error searching users" });
  }
});

// ─── GET /api/users/settings ───────────────────────────────────────────────
router.get("/settings", async (req, res) => {
  try {
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.id);
      } catch (e) {
        // Fallback to query
      }
    }

    if (!user && req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      user = await User.findById(req.query.userId);
    }
    if (!user && req.query.email) {
      user = await User.findOne({ email: String(req.query.email).toLowerCase() });
    }

    if (!user) {
      return res.json({
        whatsappNumber: "",
        notificationPreferences: {
          emailEnabled: true,
          whatsappEnabled: true,
          roomInvites: true,
          deadlines: true,
          chatMessages: true,
          reminders: false,
        },
        privacySettings: {
          discoverable: true,
          allowInvites: true,
          showEmail: true,
          showPhone: true,
          activityStatus: true,
        },
      });
    }

    res.json({
      notificationPreferences: user.notificationPreferences || {
        emailEnabled: true,
        roomInvites: true,
        deadlines: true,
        chatMessages: true,
        reminders: false,
      },
      privacySettings: user.privacySettings || {
        discoverable: true,
        allowInvites: true,
        showEmail: true,
        activityStatus: true,
      },
    });
  } catch (err) {
    console.error("[getSettings]", err);
    res.status(500).json({ message: "Server error fetching user settings" });
  }
});

// ─── PUT /api/users/settings ───────────────────────────────────────────────
router.put("/settings", async (req, res) => {
  try {
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.id);
      } catch (e) {}
    }

    if (!user && req.body.userId && mongoose.Types.ObjectId.isValid(req.body.userId)) {
      user = await User.findById(req.body.userId);
    }
    if (!user && req.body.email) {
      user = await User.findOne({ email: String(req.body.email).toLowerCase() });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found to update settings" });
    }

    const { notificationPreferences, privacySettings } = req.body;

    if (notificationPreferences) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...notificationPreferences,
      };
    }
    if (privacySettings) {
      user.privacySettings = {
        ...user.privacySettings,
        ...privacySettings,
      };
    }

    await user.save();
    console.log(`[users/settings] ✅ Updated settings for ${user.email}`);

    res.json({
      message: "Settings updated successfully",
      notificationPreferences: user.notificationPreferences,
      privacySettings: user.privacySettings,
    });
  } catch (err) {
    console.error("[updateSettings]", err);
    res.status(500).json({ message: "Server error updating settings" });
  }
});

// ─── DELETE /api/users/me (Delete account from DB) ─────────────────────────
router.delete("/me", async (req, res) => {
  try {
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.id);
      } catch (e) {}
    }

    if (!user && req.body?.userId && mongoose.Types.ObjectId.isValid(req.body.userId)) {
      user = await User.findById(req.body.userId);
    }
    if (!user && req.query?.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      user = await User.findById(req.query.userId);
    }
    if (!user && (req.body?.email || req.query?.email)) {
      const em = (req.body?.email || req.query?.email).toLowerCase();
      user = await User.findOne({ email: em });
    }

    if (!user) {
      return res.status(404).json({ message: "User account not found for deletion" });
    }

    const userIdStr = user._id.toString();
    const userEmail = user.email;

    // Delete invitations involving user
    await Invitation.deleteMany({
      $or: [
        { "recipient.user_id": userIdStr },
        { "recipient.email": userEmail },
        { "sender.user_id": userIdStr },
      ],
    });

    // Delete User record from DB
    await User.findByIdAndDelete(user._id);

    console.log(`[users/delete] 🗑️ Account ${userEmail} (${userIdStr}) permanently deleted from MongoDB`);
    res.json({ message: "Account deleted successfully from database" });
  } catch (err) {
    console.error("[deleteAccount]", err);
    res.status(500).json({ message: "Server error deleting account" });
  }
});

// ─── GET /api/users/:id ──────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const param = req.params.id;
    let user = null;

    if (mongoose.Types.ObjectId.isValid(param)) {
      user = await User.findById(param).select("-password");
    }

    if (!user) {
      user = await User.findOne({
        $or: [{ username: param }, { email: param.toLowerCase() }],
      }).select("-password");
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("[getUser]", err);
    res.status(500).json({ message: "Server error fetching user profile" });
  }
});

module.exports = router;

