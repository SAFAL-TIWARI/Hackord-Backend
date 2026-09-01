const mongoose = require("mongoose");

const ExploreAiMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    sender: { type: String, enum: ["user", "ai"], required: true },
    text: { type: String, required: true },
    timestamp: {
      type: String,
      default: () =>
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    isEdited: { type: Boolean, default: false },
    hackathons: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true }
);

const ExploreAiConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    messages: [ExploreAiMessageSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExploreAiConversation", ExploreAiConversationSchema);
