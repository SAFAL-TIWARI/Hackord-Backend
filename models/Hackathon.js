const mongoose = require("mongoose");

const hackathonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    organizer: { type: String, required: true, trim: true },
    banner: {
      type: String,
      default: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
    },
    prizePool: { type: String, required: true, default: "TBD" },
    prizePoolUSD: { type: Number, default: 0 },
    mode: {
      type: String,
      enum: ["Online", "Offline", "Hybrid"],
      default: "Online",
    },
    registrationDeadline: { type: String, required: true },
    submissionDeadline: { type: String, required: true },
    resultDate: { type: String, required: true },
    teamSize: {
      min: { type: Number, default: 1 },
      max: { type: Number, default: 4 },
    },
    tags: { type: [String], default: [] },
    platform: { type: String, default: "Hackord" },
    platformUrl: { type: String, default: "" },
    description: { type: String, required: true },
    createdBy: { type: String, default: "admin" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Hackathon", hackathonSchema);
