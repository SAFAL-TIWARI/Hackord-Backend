const express = require("express");
const mongoose = require("mongoose");
const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");

const router = express.Router();

// Helper to generate random clean IDs
function generateMsgId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── GET /api/chat/messages ─────────────────────────────────────────────────
// Get messages for General chat or Direct chat with another user
router.get("/messages", async (req, res) => {
  try {
    const { chatType = "general", otherUserId, userId } = req.query;

    let query = {};
    if (chatType === "general") {
      query.chatType = "general";
    } else if (chatType === "direct") {
      if (!otherUserId || !userId) {
        return res.status(400).json({ error: "Missing userId or otherUserId for direct chat" });
      }
      query.chatType = "direct";
      query.$or = [
        { author_id: userId, recipient_id: otherUserId },
        { author_id: otherUserId, recipient_id: userId },
      ];
    }

    if (userId) {
      query.deleted_by = { $ne: userId };
    }

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: 1 })
      .limit(300)
      .lean();

    res.json(messages);
  } catch (err) {
    console.error("[chat api] GET /messages error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch chat messages" });
  }
});

// ─── POST /api/chat/messages ────────────────────────────────────────────────
// Send new message (General or Direct)
router.post("/messages", async (req, res) => {
  try {
    const {
      chatType = "general",
      author_id,
      author_name,
      author_username = "",
      author_avatar = "",
      author_role = "user",
      recipient_id,
      recipient_name,
      recipient_username = "",
      recipient_avatar = "",
      text,
      audio_url,
      audio_duration,
      reply_to,
    } = req.body;

    if (!author_id || !author_name || (!text && !audio_url)) {
      return res.status(400).json({ error: "Author and text or audio content are required" });
    }

    // Check if author is admin
    let isImportant = false;
    if (chatType === "general") {
      if (author_role === "admin") {
        isImportant = true;
      } else {
        const user = await User.findById(author_id).catch(() => null);
        if (user && user.role === "admin") {
          isImportant = true;
        }
      }
    }

    const newMsg = await ChatMessage.create({
      id: generateMsgId(),
      chatType,
      author_id,
      author_name,
      author_username,
      author_avatar,
      author_role: isImportant ? "admin" : author_role,
      recipient_id: chatType === "direct" ? recipient_id : null,
      recipient_name: chatType === "direct" ? recipient_name : null,
      recipient_username: chatType === "direct" ? recipient_username : null,
      recipient_avatar: chatType === "direct" ? recipient_avatar : null,
      text: text || (audio_url ? "🎤 Voice message" : ""),
      audio_url: audio_url || null,
      audio_duration: audio_duration || 0,
      is_important: isImportant,
      reply_to: reply_to || null,
      read_by: [author_id],
    });

    res.status(201).json(newMsg);
  } catch (err) {
    console.error("[chat api] POST /messages error:", err);
    res.status(500).json({ error: err.message || "Failed to post message" });
  }
});

// ─── PUT /api/chat/messages/:messageId ──────────────────────────────────────
// Update message (edit text or toggle pin)
router.put("/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text, pinned } = req.body;

    const msg = await ChatMessage.findOne({ id: messageId });
    if (!msg) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (typeof text === "string" && text.trim() !== "") {
      msg.text = text.trim();
      msg.edited = true;
    }
    if (typeof pinned === "boolean") {
      msg.pinned = pinned;
    }

    await msg.save();
    res.json(msg);
  } catch (err) {
    console.error("[chat api] PUT /messages error:", err);
    res.status(500).json({ error: err.message || "Failed to update message" });
  }
});

// ─── DELETE /api/chat/messages/:messageId ───────────────────────────────────
// Delete a message
router.delete("/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const deleted = await ChatMessage.findOneAndDelete({ id: messageId });
    if (!deleted) {
      return res.status(404).json({ error: "Message not found" });
    }
    res.json({ success: true, messageId });
  } catch (err) {
    console.error("[chat api] DELETE /messages error:", err);
    res.status(500).json({ error: err.message || "Failed to delete message" });
  }
});

// ─── GET /api/chat/conversations ────────────────────────────────────────────
// Fetch user's active conversations list (General Conversation + Direct Conversations)
router.get("/conversations", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId parameter is required" });
    }

    // 1. General Conversation details
    const lastGeneralMsg = await ChatMessage.findOne({ chatType: "general" })
      .sort({ createdAt: -1 })
      .lean();

    const generalUnreadCount = await ChatMessage.countDocuments({
      chatType: "general",
      author_id: { $ne: userId },
      read_by: { $ne: userId },
    });

    const generalConversation = {
      id: "general",
      chatType: "general",
      name: "General Conversation",
      subtitle: "Global discussion for all platform users",
      avatar: "",
      unreadCount: generalUnreadCount,
      lastMessageText: lastGeneralMsg
        ? `${lastGeneralMsg.author_name.split(" ")[0]}: ${lastGeneralMsg.text}`
        : "No messages yet. Start the conversation!",
      lastMessageAt: lastGeneralMsg ? lastGeneralMsg.createdAt : null,
      isPinnedTop: true,
    };

    // 2. Direct Conversations list
    const directMessages = await ChatMessage.find({
      chatType: "direct",
      $or: [{ author_id: userId }, { recipient_id: userId }],
      deleted_by: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .lean();

    const directMap = new Map();

    for (const msg of directMessages) {
      const isAuthor = msg.author_id === userId;
      const otherId = isAuthor ? msg.recipient_id : msg.author_id;
      if (!otherId) continue;

      if (!directMap.has(otherId)) {
        const otherName = isAuthor ? msg.recipient_name : msg.author_name;
        const otherUsername = isAuthor ? msg.recipient_username : msg.author_username;
        const otherAvatar = isAuthor ? msg.recipient_avatar : msg.author_avatar;
        const authorPrefix = isAuthor ? "You" : (msg.author_name ? msg.author_name.split(" ")[0] : "User");

        directMap.set(otherId, {
          id: otherId,
          chatType: "direct",
          otherUserId: otherId,
          name: otherName || "User",
          username: otherUsername || "",
          avatar: otherAvatar || "",
          lastMessageText: `${authorPrefix}: ${msg.text}`,
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
        });
      }

      // Check unread count if message was sent by the other user and current user hasn't read it
      if (!isAuthor && (!msg.read_by || !msg.read_by.includes(userId))) {
        const conv = directMap.get(otherId);
        conv.unreadCount += 1;
      }
    }

    // Enrich direct conversations with real-time user online status and privacy settings
    const otherUserIds = Array.from(directMap.keys()).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const User = require("../models/User");
    const otherUsers = await User.find({ _id: { $in: otherUserIds } }).select("-password").lean();
    const userMap = new Map(otherUsers.map((u) => [String(u._id), u]));

    const now = Date.now();
    const directList = Array.from(directMap.values()).map((conv) => {
      const dbUser = userMap.get(conv.otherUserId);
      let isOnline = false;
      let allowDirectMessages = true;
      if (dbUser) {
        const lastActiveMs = dbUser.lastActive ? new Date(dbUser.lastActive).getTime() : 0;
        const isRecentlyActive = now - lastActiveMs < 40000;
        const showOnline = dbUser.privacySettings?.showOnlineStatus !== false && dbUser.privacySettings?.activityStatus !== false;
        isOnline = isRecentlyActive && showOnline;
        allowDirectMessages = dbUser.privacySettings?.allowDirectMessages !== false;
      }
      return {
        ...conv,
        isOnline,
        allowDirectMessages,
      };
    });

    res.json({
      general: generalConversation,
      direct: directList,
    });
  } catch (err) {
    console.error("[chat api] GET /conversations error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch conversations" });
  }
});

// ─── POST /api/chat/read ────────────────────────────────────────────────────
// Mark messages in general or direct conversation as read by current user
router.post("/read", async (req, res) => {
  try {
    const { userId, chatType = "general", otherUserId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId parameter required" });
    }

    let filter = {};
    if (chatType === "general") {
      filter = { chatType: "general", read_by: { $ne: userId } };
    } else if (chatType === "direct" && otherUserId) {
      filter = {
        chatType: "direct",
        author_id: otherUserId,
        recipient_id: userId,
        read_by: { $ne: userId },
      };
    } else {
      return res.json({ success: true, count: 0 });
    }

    const result = await ChatMessage.updateMany(filter, {
      $addToSet: { read_by: userId },
    });

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("[chat api] POST /read error:", err);
    res.status(500).json({ error: err.message || "Failed to mark chat as read" });
  }
});

// ─── DELETE /api/chat/conversations/:otherUserId ─────────────────────────────
// User-based deletion: Hide/clear conversation for current user (like WhatsApp)
router.delete("/conversations/:otherUserId", async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const { userId } = req.query;

    if (!userId || !otherUserId) {
      return res.status(400).json({ error: "userId and otherUserId are required" });
    }

    const filter = {
      chatType: "direct",
      $or: [
        { author_id: userId, recipient_id: otherUserId },
        { author_id: otherUserId, recipient_id: userId },
      ],
    };

    const result = await ChatMessage.updateMany(filter, {
      $addToSet: { deleted_by: userId },
    });

    res.json({ success: true, count: result.modifiedCount });
  } catch (err) {
    console.error("[chat api] DELETE /conversations error:", err);
    res.status(500).json({ error: err.message || "Failed to delete conversation" });
  }
});

module.exports = router;
