const express = require("express");
const router = express.Router();
const Hackathon = require("../models/Hackathon");
const HackathonSubmission = require("../models/HackathonSubmission");
const { protect, adminOnly } = require("../middleware/auth");
const { scrapeHackathonsToFile, mergeScrapedFileToDb } = require("../services/scraperService");

// Helper to format hackathon output
function formatHackathon(h) {
  return {
    id: h._id.toString(),
    name: h.name,
    organizer: h.organizer,
    banner: h.banner,
    prizePool: h.prizePool,
    prizePoolUSD: h.prizePoolUSD,
    mode: h.mode,
    level: h.level || "National",
    registrationDeadline: h.registrationDeadline,
    submissionDeadline: h.submissionDeadline,
    resultDate: h.resultDate,
    teamSize: h.teamSize,
    tags: h.tags,
    platform: h.platform,
    platformUrl: h.platformUrl,
    description: h.description,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

// ─── GET /api/hackathons ─── Get all hackathons
router.get("/", async (req, res) => {
  try {
    const { level, mode, platform } = req.query;
    const filter = {};
    if (level && level !== "All") filter.level = level;
    if (mode && mode !== "All") filter.mode = mode;
    if (platform && platform !== "All") filter.platform = platform;

    let hackathons = await Hackathon.find(filter).sort({ createdAt: -1 });

    // If database is completely empty, attempt initial file scrape + merge
    if (hackathons.length === 0) {
      console.log("[hackathons GET] Database empty, triggering auto file scrape & merge...");
      await scrapeHackathonsToFile();
      await mergeScrapedFileToDb();
      hackathons = await Hackathon.find(filter).sort({ createdAt: -1 });
    }

    const formatted = hackathons.map(formatHackathon);
    res.json(formatted);
  } catch (err) {
    console.error("[hackathons GET error]", err.message);
    res.status(500).json({ error: "Failed to fetch hackathons", message: err.message });
  }
});

// ─── POST /api/hackathons/scrape ─── Trigger live auto-feeding from top platforms (ADMIN ONLY)
router.post("/scrape", protect, adminOnly, async (req, res) => {
  try {
    const autoFeed = req.body?.autoFeed !== false;
    const result = await scrapeHackathonsToFile({ autoFeedToDb: autoFeed });

    res.json({
      success: true,
      message: `Scraping completed! ${result.totalScraped} valid hackathons processed and fed to DB.`,
      stats: result,
    });
  } catch (err) {
    console.error("[hackathons /scrape error]", err.message);
    res.status(500).json({ error: "Failed to scrape hackathons", message: err.message });
  }
});

// ─── POST /api/hackathons/submit-host-request ─── Public "Host Your Hackathon" submission
router.post("/submit-host-request", async (req, res) => {
  try {
    const {
      name,
      organizer,
      contactEmail,
      banner,
      prizePool,
      prizePoolUSD,
      mode,
      level,
      registrationDeadline,
      submissionDeadline,
      resultDate,
      teamSize,
      tags,
      platform,
      platformUrl,
      description,
    } = req.body;

    if (!name || !organizer || !contactEmail || !description) {
      return res.status(400).json({ error: "Name, organizer, contact email, and description are required." });
    }

    const submission = await HackathonSubmission.create({
      name,
      organizer,
      contactEmail,
      banner: banner || "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
      prizePool: prizePool || "TBD",
      prizePoolUSD: prizePoolUSD ? Number(prizePoolUSD) : 0,
      mode: mode || "Online",
      level: level || "National",
      registrationDeadline: registrationDeadline || new Date().toISOString().split("T")[0],
      submissionDeadline: submissionDeadline || new Date().toISOString().split("T")[0],
      resultDate: resultDate || new Date().toISOString().split("T")[0],
      teamSize: teamSize || { min: 1, max: 4 },
      tags: Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : [],
      platform: platform || "Community Host",
      platformUrl: platformUrl || "",
      description,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Hackathon hosting request submitted successfully! Pending admin approval.",
      submission,
    });
  } catch (err) {
    console.error("[hackathons /submit-host-request error]", err.message);
    res.status(500).json({ error: "Failed to submit host request", message: err.message });
  }
});

// ─── POST /api/hackathons ─── Create a new hackathon directly (Admin only)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      organizer,
      banner,
      prizePool,
      prizePoolUSD,
      mode,
      level,
      registrationDeadline,
      submissionDeadline,
      resultDate,
      teamSize,
      tags,
      platform,
      platformUrl,
      description,
    } = req.body;

    if (!name || !organizer || !description) {
      return res.status(400).json({ error: "Name, organizer, and description are required." });
    }

    const hackathon = await Hackathon.create({
      name,
      organizer,
      banner: banner || "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
      prizePool: prizePool || "TBD",
      prizePoolUSD: prizePoolUSD ? Number(prizePoolUSD) : 0,
      mode: mode || "Online",
      level: level || "National",
      registrationDeadline: registrationDeadline || new Date().toISOString().split("T")[0],
      submissionDeadline: submissionDeadline || new Date().toISOString().split("T")[0],
      resultDate: resultDate || new Date().toISOString().split("T")[0],
      teamSize: teamSize || { min: 1, max: 4 },
      tags: Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : [],
      platform: platform || "Hackord",
      platformUrl: platformUrl || "",
      description,
      createdBy: req.user._id.toString(),
    });

    res.status(201).json(formatHackathon(hackathon));
  } catch (err) {
    console.error("[hackathons POST error]", err.message);
    res.status(500).json({ error: "Failed to create hackathon", message: err.message });
  }
});

// ─── DELETE /api/hackathons/:id ─── Delete a hackathon (Admin only)
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const deleted = await Hackathon.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Hackathon not found" });
    }

    res.json({ success: true, message: "Hackathon deleted successfully" });
  } catch (err) {
    console.error("[hackathons DELETE error]", err.message);
    res.status(500).json({ error: "Failed to delete hackathon", message: err.message });
  }
});

module.exports = router;
