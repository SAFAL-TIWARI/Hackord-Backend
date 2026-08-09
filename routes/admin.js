const express = require("express");
const User = require("../models/User");
const Hackathon = require("../models/Hackathon");
const HackathonSubmission = require("../models/HackathonSubmission");
const ContactMessage = require("../models/ContactMessage");
const { protect, adminOnly } = require("../middleware/auth");
const {
  scrapeHackathonsToFile,
  getScrapedFileStatus,
  mergeScrapedFileToDb,
  rejectScrapedItemFromFile,
} = require("../services/scraperService");

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

    function escapeRegex(text) {
      return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    }

    let query = {};
    if (search) {
      const clean = search.trim().startsWith("@") ? search.trim().slice(1) : search.trim();
      const safeRegex = new RegExp(escapeRegex(clean), "i");
      query = {
        $or: [
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

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSignups = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const todaySignups = await User.countDocuments({
      createdAt: { $gte: oneDayAgo },
    });

    const skillAggregation = await User.aggregate([
      { $unwind: "$skills" },
      { $group: { _id: "$skills", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

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

// ─── GET /api/admin/scraped-file-status ─── View status of scraped JSON file
router.get("/scraped-file-status", async (req, res) => {
  try {
    const status = getScrapedFileStatus();
    res.json(status);
  } catch (err) {
    console.error("[admin/scraped-file-status]", err);
    res.status(500).json({ message: "Failed to get scraped file status" });
  }
});

// ─── POST /api/admin/trigger-scrape ─── Manually run scrapers & write to JSON file
router.post("/trigger-scrape", async (req, res) => {
  try {
    const result = await scrapeHackathonsToFile();
    const status = getScrapedFileStatus();
    res.json({
      success: true,
      message: `Scraped ${result.totalScraped} valid hackathons and saved to file! Admin approval required to feed DB.`,
      fileStatus: status,
    });
  } catch (err) {
    console.error("[admin/trigger-scrape]", err);
    res.status(500).json({ message: "Scraping failed: " + err.message });
  }
});

// ─── POST /api/admin/feed-scraped-hackathons ─── Admin approval: Merge stored JSON file to DB
router.post("/feed-scraped-hackathons", async (req, res) => {
  try {
    const result = await mergeScrapedFileToDb();
    const allHackathons = await Hackathon.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      message: `Successfully merged scraped hackathons into DB! Added ${result.insertedCount} new, updated ${result.updatedCount}.`,
      result,
      hackathonsCount: allHackathons.length,
    });
  } catch (err) {
    console.error("[admin/feed-scraped-hackathons]", err);
    res.status(500).json({ message: "Failed to merge hackathons to DB: " + err.message });
  }
});

// ─── DELETE /api/admin/scraped-hackathons/:id ─── Admin action: Remove scraped hackathon from JSON file
router.delete("/scraped-hackathons/:id", async (req, res) => {
  try {
    const itemId = decodeURIComponent(req.params.id);
    const result = rejectScrapedItemFromFile(itemId);
    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }

    const updatedStatus = getScrapedFileStatus();
    res.json({
      success: true,
      message: "Scraped hackathon rejected and removed from file",
      fileStatus: updatedStatus,
    });
  } catch (err) {
    console.error("[admin/scraped-hackathons DELETE]", err);
    res.status(500).json({ message: "Failed to reject scraped hackathon: " + err.message });
  }
});

// ─── GET /api/admin/host-requests ─── Get all host hackathon requests
router.get("/host-requests", async (req, res) => {
  try {
    const submissions = await HackathonSubmission.find().sort({ createdAt: -1 });
    res.json(submissions);
  } catch (err) {
    console.error("[admin/host-requests]", err);
    res.status(500).json({ message: "Failed to fetch host requests" });
  }
});

// ─── POST /api/admin/host-requests/:id/approve ─── Approve host request and add to DB
router.post("/host-requests/:id/approve", async (req, res) => {
  try {
    const submission = await HackathonSubmission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Create Hackathon in database
    const createdHackathon = await Hackathon.create({
      name: submission.name,
      organizer: submission.organizer,
      banner: submission.banner,
      prizePool: submission.prizePool,
      prizePoolUSD: submission.prizePoolUSD,
      mode: submission.mode,
      level: submission.level,
      registrationDeadline: submission.registrationDeadline,
      submissionDeadline: submission.submissionDeadline,
      resultDate: submission.resultDate || submission.submissionDeadline,
      teamSize: submission.teamSize,
      tags: submission.tags,
      platform: submission.platform || "Community Host",
      platformUrl: submission.platformUrl,
      description: submission.description,
      createdBy: "community-submission",
    });

    submission.status = "approved";
    await submission.save();

    res.json({
      success: true,
      message: `Hackathon "${submission.name}" approved and added to Explore page!`,
      hackathon: createdHackathon,
      submission,
    });
  } catch (err) {
    console.error("[admin/host-requests/:id/approve]", err);
    res.status(500).json({ message: "Failed to approve host request: " + err.message });
  }
});

// ─── DELETE /api/admin/host-requests/:id ─── Reject / Delete host request
router.delete("/host-requests/:id", async (req, res) => {
  try {
    const deleted = await HackathonSubmission.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Submission not found" });
    }

    res.json({ success: true, message: "Submission request rejected & removed" });
  } catch (err) {
    console.error("[admin/host-requests/:id DELETE]", err);
    res.status(500).json({ message: "Failed to delete submission request" });
  }
});

// ─── GET /api/admin/contact-messages ─── Get all user contact queries ("Send us message")
router.get("/contact-messages", async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    console.error("[admin/contact-messages GET]", err);
    res.status(500).json({ message: "Failed to fetch contact messages" });
  }
});

// ─── DELETE /api/admin/contact-messages/:id ─── Delete contact query
router.delete("/contact-messages/:id", async (req, res) => {
  try {
    const deleted = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Contact message not found" });
    }
    res.json({ success: true, message: "Contact message deleted successfully" });
  } catch (err) {
    console.error("[admin/contact-messages DELETE]", err);
    res.status(500).json({ message: "Failed to delete contact message" });
  }
});

module.exports = router;
