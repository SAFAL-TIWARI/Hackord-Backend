const express = require("express");
const router = express.Router();
const axios = require("axios");
const ExploreAiConversation = require("../models/ExploreAiConversation");
const Hackathon = require("../models/Hackathon");
const { protect } = require("../middleware/auth");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Fast Gemini models — first healthy one wins
const FAST_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash",
];

/**
 * Direct, optimised Gemini call — no web scraping, no URL extraction overhead.
 * Uses separate systemInstruction for best model adherence and lower latency.
 */
async function callGeminiFast({ systemInstruction, conversationHistory, userPrompt }) {
  const contents = [];

  // Add compact conversation history (last 4 exchanges = 8 messages max)
  const recentHistory = (conversationHistory || []).slice(-8);
  for (const m of recentHistory) {
    contents.push({
      role: m.sender === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    });
  }

  // Add current user message
  contents.push({ role: "user", parts: [{ text: userPrompt }] });

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.5,
      topK: 32,
      topP: 0.9,
      maxOutputTokens: 2048,        // Much faster than 8192
      candidateCount: 1,
    },
  };

  let lastError = null;
  for (const model of FAST_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await axios.post(url, body, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
      if (res.data?.candidates?.[0]?.content?.parts?.length > 0) {
        const text = res.data.candidates[0].content.parts.map((p) => p.text).filter(Boolean).join("\n").trim();
        if (text) return { text, model };
      }
    } catch (err) {
      lastError = err;
      if (err?.response?.status !== 429 && err?.response?.status !== 503 && err?.response?.status !== 404) {
        // Non-retriable error — don't try other models
        break;
      }
      // Small back-off only between models
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastError || new Error("All Gemini models failed");
}

/**
 * Extract structured JSON hackathon cards from model response text.
 */
function extractHackathons(rawText) {
  let cleanText = rawText;
  let hackathons = [];

  // Primary: <<<HACKATHONS_JSON>>> ... <<<END_HACKATHONS_JSON>>>
  const markerRegex = /<<<HACKATHONS_JSON>>>([\s\S]*?)<<<END_HACKATHONS_JSON>>>/;
  const match = rawText.match(markerRegex);

  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) hackathons = parsed;
    } catch (e) {
      console.warn("[explore-ai] JSON parse error:", e.message);
    }
    cleanText = rawText.replace(markerRegex, "").trim();
  } else {
    // Fallback: ```json [...] ```
    const cbRegex = /```json\s*([\s\S]*?)\s*```/g;
    let m;
    while ((m = cbRegex.exec(rawText)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].name || parsed[0].title)) {
          hackathons = parsed;
          cleanText = cleanText.replace(m[0], "").trim();
          break;
        }
      } catch {}
    }
  }

  // Normalise hackathon fields
  const futureDays = (d) => new Date(Date.now() + d * 86400000).toISOString().split("T")[0];
  hackathons = hackathons.map((h, i) => ({
    id: h.id || h._id || `ai-h-${Date.now()}-${i}`,
    name: h.name || h.title || "Hackathon",
    organizer: h.organizer || "Organizer",
    banner: h.banner || "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
    prizePool: h.prizePool || "TBD",
    prizePoolUSD: h.prizePoolUSD || 0,
    mode: h.mode || "Online",
    level: h.level || (h.tags?.includes("India") || h.country === "India" ? "National" : "Global"),
    registrationDeadline: h.registrationDeadline || h.deadline || futureDays(14),
    submissionDeadline: h.submissionDeadline || futureDays(21),
    resultDate: h.resultDate || futureDays(28),
    teamSize: h.teamSize || { min: 1, max: 4 },
    tags: Array.isArray(h.tags) && h.tags.length > 0 ? h.tags : ["Hackathon", "Coding"],
    platform: h.platform || "Hackord",
    platformUrl: h.platformUrl || h.link || h.url || "",
    description: h.description || h.summary || "",
  }));

  return { cleanText, hackathons };
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/explore-ai/conversation
// ──────────────────────────────────────────────────────────────────────────────
router.get("/conversation", protect, async (req, res) => {
  try {
    let conv = await ExploreAiConversation.findOne({ userId: req.user._id });
    if (!conv) conv = await ExploreAiConversation.create({ userId: req.user._id, messages: [] });

    res.json({
      success: true,
      conversation: {
        id: conv._id.toString(),
        userId: req.user._id.toString(),
        messages: conv.messages || [],
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      },
    });
  } catch (err) {
    console.error("[explore-ai GET]", err.message);
    res.status(500).json({ error: "Failed to fetch conversation", message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/explore-ai/chat
// ──────────────────────────────────────────────────────────────────────────────
router.post("/chat", protect, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

    const trimmedPrompt = prompt.trim();
    const nowIso = new Date().toISOString().split("T")[0];

    // Parallelise: fetch DB hackathons + user conversation at the same time
    const [conv, dbHackathons] = await Promise.all([
      ExploreAiConversation.findOne({ userId: req.user._id }),
      Hackathon.find({}, "name organizer prizePool mode registrationDeadline tags platformUrl")
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),
    ]);

    const conversation = conv || new ExploreAiConversation({ userId: req.user._id, messages: [] });

    // Compact DB catalog to minimise token count
    const catalog = dbHackathons.map((h) => ({
      id: h._id.toString(),
      name: h.name,
      organizer: h.organizer,
      prize: h.prizePool,
      mode: h.mode,
      deadline: h.registrationDeadline,
      tags: h.tags?.slice(0, 4),
      url: h.platformUrl,
    }));

    // Focused system prompt — only required info, tight output constraint
    const systemInstruction = `You are Hackord Event AI, a global hackathon and tech event intelligence assistant.
Today: ${nowIso}.

CAPABILITIES:
- Comprehensive knowledge of Indian and global hackathons: SIH (Smart India Hackathon), ETHIndia, Hack This Fall, InOut, Devfolio, Unstop, MLH, Devpost, HackerEarth, Google Solution Challenge, NASA Space Apps, and more.
- You also have knowledge of hackathons on Hackord's own platform (catalog below).

HACKORD CATALOG (JSON): ${JSON.stringify(catalog)}

RESPONSE RULES:
1. Be concise and direct. No lengthy intros or filler.
2. Provide only what the user asked for.
3. When listing hackathons, always append a structured JSON block at the end.
4. Use correct dates. If deadline has passed, mark status as Ended.
5. For each hackathon: include name, organizer, prize, mode (Online/Offline/Hybrid), deadline, tags, and official URL.

JSON BLOCK FORMAT (append after your text response — do NOT mix inside the text):
<<<HACKATHONS_JSON>>>
[
  {
    "id": "unique-id",
    "name": "Hackathon Name",
    "organizer": "Organizer",
    "banner": "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
    "prizePool": "₹1,00,000 or $10,000",
    "prizePoolUSD": 10000,
    "mode": "Online",
    "level": "National",
    "registrationDeadline": "YYYY-MM-DD",
    "submissionDeadline": "YYYY-MM-DD",
    "resultDate": "YYYY-MM-DD",
    "teamSize": { "min": 2, "max": 4 },
    "tags": ["AI", "India"],
    "platform": "Devfolio",
    "platformUrl": "https://hackathon-link.com",
    "description": "One sentence description."
  }
]
<<<END_HACKATHONS_JSON>>>`;

    const conversationHistory = (conversation.messages || []).slice(-6);

    // Call Gemini directly — fast path, no URL scraping overhead
    const aiResult = await callGeminiFast({
      systemInstruction,
      conversationHistory,
      userPrompt: trimmedPrompt,
    });

    const rawText = aiResult.text || "I couldn't retrieve information right now. Please try again.";
    const { cleanText, hackathons } = extractHackathons(rawText);

    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateString = nowIso;

    const userMsg = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: "user",
      text: trimmedPrompt,
      timestamp: timeString,
      date: dateString,
      hackathons: [],
    };
    const aiMsg = {
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: "ai",
      text: cleanText,
      timestamp: timeString,
      date: dateString,
      hackathons,
    };

    conversation.messages.push(userMsg, aiMsg);
    if (conversation.messages.length > 50) {
      conversation.messages = conversation.messages.slice(-50);
    }
    await conversation.save();

    res.json({
      success: true,
      userMessage: userMsg,
      aiMessage: aiMsg,
      conversation: {
        id: conversation._id.toString(),
        userId: req.user._id.toString(),
        messages: conversation.messages,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (err) {
    console.error("[explore-ai POST /chat]", err.message);
    res.status(500).json({
      error: "Failed to generate AI response",
      message: err.message || "Unexpected error communicating with AI.",
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/explore-ai/conversation
// ──────────────────────────────────────────────────────────────────────────────
router.delete("/conversation", protect, async (req, res) => {
  try {
    const conv = await ExploreAiConversation.findOne({ userId: req.user._id });
    if (conv) { conv.messages = []; await conv.save(); }
    res.json({ success: true, message: "Conversation history cleared" });
  } catch (err) {
    console.error("[explore-ai DELETE]", err.message);
    res.status(500).json({ error: "Failed to clear conversation", message: err.message });
  }
});

module.exports = router;
