const express = require("express");
const mongoose = require("mongoose");
const Invitation = require("../models/Invitation");
const Room = require("../models/Room");
const User = require("../models/User");
const { sendNotification } = require("../services/notificationService");

const router = express.Router();

// Helper to resolve user
async function findUserByIdentifier(idOrQuery) {
  if (!idOrQuery) return null;
  if (mongoose.Types.ObjectId.isValid(idOrQuery)) {
    const u = await User.findById(idOrQuery);
    if (u) return u;
  }
  return await User.findOne({
    $or: [
      { email: String(idOrQuery).toLowerCase() },
      { username: String(idOrQuery) },
      { name: String(idOrQuery) },
    ],
  });
}

// ─── POST /api/invitations ──────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      recipientId,
      recipientEmail,
      recipientUsername,
      roomId,
      message,
      senderId,
      senderName,
      senderAvatar,
    } = req.body;

    if (!roomId) {
      return res.status(400).json({ message: "Room ID is required" });
    }

    const room = await Room.findOne({ id: roomId });
    if (!room) {
      return res.status(404).json({ message: "Target room not found" });
    }

    // Check room capacity limit
    const maxSize = room.max_size || 6;
    if (room.members.length >= maxSize) {
      return res.status(400).json({
        message: `Room member limit reached (${room.members.length}/${maxSize} members). Cannot send more invitations.`,
      });
    }

    // Resolve recipient
    const recipient = await findUserByIdentifier(recipientId || recipientEmail || recipientUsername);
    if (!recipient) {
      return res.status(404).json({ message: "Recipient user account not found" });
    }

    // Check recipient Privacy Settings
    if (recipient.privacySettings && recipient.privacySettings.allowInvites === false) {
      return res.status(403).json({
        message: `${recipient.name} has disabled team invitations in their privacy settings.`,
      });
    }

    // Check if recipient is already in room
    const isMember = room.members.some(
      (m) =>
        m.user_id === String(recipient._id) ||
        m.user_id === recipient.email ||
        (m.user_name && m.user_name.toLowerCase() === recipient.name.toLowerCase())
    );
    if (isMember) {
      return res.status(400).json({ message: `${recipient.name} is already a member of this room` });
    }

    // Check existing pending invite
    const existing = await Invitation.findOne({
      roomId: room.id,
      "recipient.user_id": String(recipient._id),
      status: "pending",
    });
    if (existing) {
      return res.status(400).json({ message: `Pending invitation already sent to ${recipient.name}` });
    }

    const invitation = new Invitation({
      sender: {
        user_id: senderId || "u_me",
        name: senderName || "Team Lead",
        avatar: senderAvatar || "https://api.dicebear.com/9.x/glass/svg?seed=Sender",
      },
      recipient: {
        user_id: String(recipient._id),
        name: recipient.name,
        avatar: recipient.avatar || `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(recipient.name)}`,
        email: recipient.email,
      },
      roomId: room.id,
      roomName: room.name,
      hackathon: room.hackathon,
      message: message || `Hey ${recipient.name.split(" ")[0]}! I'd love for you to join our team "${room.name}" for ${room.hackathon}.`,
      status: "pending",
    });

    await invitation.save();

    // Trigger Email and WhatsApp Notification based on recipient preferences
    sendNotification({
      recipientUser: recipient,
      type: "invite",
      title: `Team Invitation: ${room.name}`,
      body: `${senderName || "A team lead"} invited you to join "${room.name}" for ${room.hackathon}.`,
      link: "/dashboard",
      metadata: {
        roomName: room.name,
        hackathon: room.hackathon,
      },
    }).catch((e) => console.error("[invitationNotifErr]", e.message));

    res.status(201).json(invitation);
  } catch (err) {
    console.error("[createInvitation]", err);
    res.status(500).json({ message: "Server error sending invitation" });
  }
});

// Helper to find invitation by ID safely
async function findInvitationById(id) {
  if (!id || id === "undefined" || id === "null") return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    const inv = await Invitation.findById(id);
    if (inv) return inv;
  }
  return await Invitation.findOne({ _id: id });
}

// ─── GET /api/invitations/me ────────────────────────────────────────────────
router.get("/me", async (req, res) => {
  try {
    const userId = req.query.userId;
    const email = req.query.email ? String(req.query.email).toLowerCase() : null;

    let filter = { status: "pending" };
    if (userId || email) {
      const orClauses = [];
      if (userId) orClauses.push({ "recipient.user_id": String(userId) });
      if (email) orClauses.push({ "recipient.email": email });
      filter.$or = orClauses;
    }

    const invites = await Invitation.find(filter).sort({ createdAt: -1 });
    const formattedInvites = invites.map((inv) => {
      const obj = inv.toObject();
      obj.id = obj._id.toString();
      return obj;
    });
    res.json(formattedInvites);
  } catch (err) {
    console.error("[getInvitations]", err);
    res.status(500).json({ message: "Server error fetching invitations" });
  }
});

// ─── POST /api/invitations/:id/accept ───────────────────────────────────────
router.post("/:id/accept", async (req, res) => {
  try {
    const inv = await findInvitationById(req.params.id);
    if (!inv) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    if (inv.status !== "pending") {
      return res.status(400).json({ message: `Invitation is already ${inv.status}` });
    }

    inv.status = "accepted";
    await inv.save();

    // Add recipient to Room
    const room = await Room.findOne({ id: inv.roomId });
    if (room) {
      const maxSize = room.max_size || 6;
      if (room.members.length >= maxSize) {
        return res.status(400).json({
          message: `Room member limit reached (${room.members.length}/${maxSize} members). Cannot join room.`,
        });
      }

      const isMember = room.members.some(
        (m) => m.user_id === inv.recipient.user_id || m.user_name === inv.recipient.name
      );
      if (!isMember) {
        room.members.push({
          user_id: inv.recipient.user_id,
          user_name: inv.recipient.name,
          user_avatar: inv.recipient.avatar,
          role: "Contributor",
        });

        room.activities.unshift({
          id: `act_${Date.now()}`,
          who: inv.recipient.name.split(" ")[0],
          what: `accepted invitation and joined the team`,
          when: new Date(),
        });

        await room.save();
      }
    }

    res.json({ message: "Invitation accepted successfully", invitation: inv, room });
  } catch (err) {
    console.error("[acceptInvitation]", err);
    res.status(500).json({ message: "Server error accepting invitation" });
  }
});

// ─── POST /api/invitations/:id/reject ───────────────────────────────────────
router.post("/:id/reject", async (req, res) => {
  try {
    const inv = await findInvitationById(req.params.id);
    if (!inv) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    inv.status = "rejected";
    await inv.save();

    res.json({ message: "Invitation declined", invitation: inv });
  } catch (err) {
    console.error("[rejectInvitation]", err);
    res.status(500).json({ message: "Server error rejecting invitation" });
  }
});

module.exports = router;
