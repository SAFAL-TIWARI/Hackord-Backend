const mongoose = require("mongoose");

const HackathonSubmissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    organizer: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
    },
    banner: {
      type: String,
      default: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
    },
    prizePool: {
      type: String,
      default: "TBD",
    },
    prizePoolUSD: {
      type: Number,
      default: 0,
    },
    mode: {
      type: String,
      enum: ["Online", "Offline", "Hybrid"],
      default: "Online",
    },
    level: {
      type: String,
      enum: ["State", "National", "Global"],
      default: "National",
    },
    registrationDeadline: {
      type: String,
      required: true,
    },
    submissionDeadline: {
      type: String,
      required: true,
    },
    resultDate: {
      type: String,
      default: "",
    },
    teamSize: {
      min: { type: Number, default: 1 },
      max: { type: Number, default: 4 },
    },
    tags: [
      {
        type: String,
      },
    ],
    platform: {
      type: String,
      default: "Community Host",
    },
    platformUrl: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    submittedBy: {
      type: String,
      default: "guest",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("HackathonSubmission", HackathonSubmissionSchema);
