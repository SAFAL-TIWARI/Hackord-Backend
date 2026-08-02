const express = require("express");
const Note = require("../models/Note");

const router = express.Router();

// ─── GET /api/notes ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { userId, user_id, email } = req.query;
    const targetId = userId || user_id;
    const targetEmail = email ? String(email).toLowerCase() : null;

    if (!targetId && !targetEmail) {
      return res.json([]);
    }

    const orClauses = [];
    if (targetId) orClauses.push({ user_id: String(targetId) });
    if (targetEmail) orClauses.push({ user_email: targetEmail });

    const notes = await Note.find({ $or: orClauses }).sort({ createdAt: -1 });
    res.json(notes);
  } catch (err) {
    console.error("[getNotes]", err);
    res.status(500).json({ message: "Server error fetching notes" });
  }
});

// ─── POST /api/notes ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { title, content, userId, user_id, email } = req.body;
    const targetId = userId || user_id || "guest";
    const targetEmail = email ? String(email).toLowerCase() : "";

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Note content is required" });
    }

    const note = new Note({
      user_id: String(targetId),
      user_email: targetEmail,
      title: title && title.trim() ? title.trim() : "Quick Note",
      content: content.trim(),
    });

    await note.save();
    res.status(201).json(note);
  } catch (err) {
    console.error("[createNote]", err);
    res.status(500).json({ message: "Server error creating note" });
  }
});

// ─── DELETE /api/notes/:id ───────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error("[deleteNote]", err);
    res.status(500).json({ message: "Server error deleting note" });
  }
});

module.exports = router;
