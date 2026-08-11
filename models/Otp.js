const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// Expire OTP documents automatically 10 minutes after creation
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model("Otp", otpSchema);
