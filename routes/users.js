const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Invitation = require("../models/Invitation");
const { protect } = require("../middleware/auth");

const router = express.Router();

// Safe regex escaper helper
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// ─── GET /api/users/search ──────────────────────────────────────────────────
router.get("/search", async (req, res) => {
  try {
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
      const cleanQuery = query.startsWith("@") ? query.slice(1) : query;
      const safeRegex = new RegExp(escapeRegex(cleanQuery), "i");

      const orConditions = [
        { name: safeRegex },
        { username: safeRegex },
        { email: safeRegex },
        { skills: safeRegex },
        { github: safeRegex },
        { linkedin: safeRegex },
        { portfolio: safeRegex },
        { college: safeRegex },
        { city: safeRegex },
        { country: safeRegex },
        { bio: safeRegex },
        { experience: safeRegex },
        { "completedHackathons.name": safeRegex },
        { "completedHackathons.result": safeRegex },
      ];

      if (mongoose.Types.ObjectId.isValid(cleanQuery)) {
        orConditions.push({ _id: cleanQuery });
      }

      baseConditions.push({ $or: orConditions });
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

