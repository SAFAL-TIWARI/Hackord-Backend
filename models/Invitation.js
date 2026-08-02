const mongoose = require("mongoose");

const invitationSchema = new mongoose.Schema(
  {
    sender: {
      user_id: { type: String, required: true },
      name: { type: String, required: true },
      avatar: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    recipient: {
      user_id: { type: String, required: true },
      name: { type: String, required: true },
      avatar: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    roomId: { type: String, required: true },
    roomName: { type: String, required: true },
    hackathon: { type: String, default: "" },
    message: { type: String, default: "Hey! Join our hackathon team room." },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Invitation", invitationSchema);
