const express = require("express");
const router = express.Router();
const ContactMessage = require("../models/ContactMessage");

// ─── POST /api/contact ─── Submit user contact form message ("Send us message")
router.post("/", async (req, res) => {
  try {
    const { name, email, category, subject, message, submittedBy } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }

    const contactMessage = await ContactMessage.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      category: category || "General Query",
      subject: subject ? subject.trim() : "General Inquiry",
      message: message.trim(),
      submittedBy: submittedBy || "user",
    });

    res.status(201).json({
      success: true,
      message: "Thank you! Your message has been received by the Hackord team.",
      contactMessage,
    });
  } catch (err) {
    console.error("[contact POST error]", err);
    res.status(500).json({ error: "Failed to submit contact message", message: err.message });
  }
});

module.exports = router;
