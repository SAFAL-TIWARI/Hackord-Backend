const express = require("express");
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// All admin routes require authentication + admin role
router.use(protect, adminOnly);

// ─── GET /api/admin/users ──────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const search = req.query.search || "";

    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { college: { $regex: search, $options: "i" } },
        ],
      };
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[admin/users]", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── GET /api/admin/stats ──────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });

    // Users who signed up in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSignups = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // Users who signed up in the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const todaySignups = await User.countDocuments({
      createdAt: { $gte: oneDayAgo },
    });

    // Top skills
    const skillAggregation = await User.aggregate([
      { $unwind: "$skills" },
      { $group: { _id: "$skills", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Experience distribution
    const experienceDistribution = await User.aggregate([
      { $group: { _id: "$experience", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      totalUsers,
      totalAdmins,
      recentSignups,
      todaySignups,
      topSkills: skillAggregation.map((s) => ({
        skill: s._id,
        count: s.count,
      })),
      experienceDistribution: experienceDistribution.map((e) => ({
        level: e._id || "Not set",
        count: e.count,
      })),
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
