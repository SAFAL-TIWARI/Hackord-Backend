const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    chatType: {
      type: String,
      enum: ["general", "direct"],
      default: "general",
    },
    author_id: { type: String, required: true },
    author_name: { type: String, required: true },
    author_username: { type: String, default: "" },
    author_avatar: { type: String, default: "" },
    author_role: { type: String, default: "user" },
    
    // For direct chats
    recipient_id: { type: String, default: null },
    recipient_name: { type: String, default: null },
    recipient_username: { type: String, default: null },
    recipient_avatar: { type: String, default: null },

    text: { type: String, required: true },
    audio_url: { type: String, default: null },
    audio_duration: { type: Number, default: 0 },
    
    pinned: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
    is_important: { type: Boolean, default: false },

    reply_to: {
      id: { type: String, default: null },
      text: { type: String, default: null },
      author_name: { type: String, default: null },
      chatType: { type: String, default: null },
    },

    read_by: { type: [String], default: [] },
    deleted_by: { type: [String], default: [] },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
