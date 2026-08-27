const mongoose = require("mongoose");

const loginAttemptSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
    ip: {
      type: String,
      default: "",
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-expire documents after 48 hours to prevent unbounded DB growth
loginAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 48 * 3600 });

module.exports = mongoose.model("LoginAttempt", loginAttemptSchema);
