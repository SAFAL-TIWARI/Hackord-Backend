const mongoose = require("mongoose");

const scrapedHackathonSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    name: { type: String, required: true, trim: true },
    organizer: { type: String, required: true, trim: true },
    banner: { type: String, default: "" },
    prizePool: { type: String, default: "TBD" },
    prizePoolUSD: { type: Number, default: 0 },
    hackathonType: { type: String, default: "Hackathon" },
    duration: { type: String, default: "" },
    venue: { type: String, default: "" },
    schedule: { type: String, default: "" },
    submissionChecklist: { type: [String], default: [] },
    mode: { type: String, default: "Online" },
    level: { type: String, default: "Global" },
    registrationDeadline: { type: String, default: "" },
    submissionDeadline: { type: String, default: "" },
    resultDate: { type: String, default: "" },
    teamSize: {
      min: { type: Number, default: 1 },
      max: { type: Number, default: 4 },
    },
    tags: { type: [String], default: [] },
    platform: { type: String, default: "Other" },
    platformUrl: { type: String, default: "" },
    description: { type: String, default: "" },
    scrapedAt: { type: String, default: () => new Date().toISOString() },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ScrapedHackathon", scrapedHackathonSchema);
