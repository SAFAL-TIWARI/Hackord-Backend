const express = require("express");
const router = express.Router();
const Hackathon = require("../models/Hackathon");
const { protect, adminOnly } = require("../middleware/auth");

// ─── GET /api/hackathons ─── Get all hackathons
router.get("/", async (req, res) => {
  try {
    const hackathons = await Hackathon.find().sort({ createdAt: -1 });
    const formatted = hackathons.map((h) => ({
      id: h._id.toString(),
      name: h.name,
      organizer: h.organizer,
      banner: h.banner,
      prizePool: h.prizePool,
      prizePoolUSD: h.prizePoolUSD,
      mode: h.mode,
      registrationDeadline: h.registrationDeadline,
      submissionDeadline: h.submissionDeadline,
      resultDate: h.resultDate,
      teamSize: h.teamSize,
      tags: h.tags,
      platform: h.platform,
      platformUrl: h.platformUrl,
      description: h.description,
      createdAt: h.createdAt,
    }));
    res.json(formatted);
  } catch (err) {
    console.error("[hackathons GET error]", err.message);
    res.status(500).json({ error: "Failed to fetch hackathons", message: err.message });
  }
});

// ─── POST /api/hackathons ─── Create a new hackathon (Admin only)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      organizer,
      banner,
      prizePool,
      prizePoolUSD,
      mode,
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

    const formatted = {
      id: hackathon._id.toString(),
      name: hackathon.name,
      organizer: hackathon.organizer,
      banner: hackathon.banner,
      prizePool: hackathon.prizePool,
      prizePoolUSD: hackathon.prizePoolUSD,
      mode: hackathon.mode,
      registrationDeadline: hackathon.registrationDeadline,
      submissionDeadline: hackathon.submissionDeadline,
      resultDate: hackathon.resultDate,
      teamSize: hackathon.teamSize,
      tags: hackathon.tags,
      platform: hackathon.platform,
      platformUrl: hackathon.platformUrl,
      description: hackathon.description,
      createdAt: hackathon.createdAt,
    };

    res.status(201).json(formatted);
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
