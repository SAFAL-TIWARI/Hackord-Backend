const express = require("express");
const mongoose = require("mongoose");
const Room = require("../models/Room");
const { RtcTokenBuilder, RtcRole } = require("agora-token");
const router = express.Router();

async function findRoom(idParam) {
  if (!idParam) return null;
  let room = await Room.findOne({ id: idParam });
  if (!room && mongoose.Types.ObjectId.isValid(idParam)) {
    room = await Room.findById(idParam);
  }
  return room;
}

// ─── GET /api/rooms ────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { userId, user_id, email, userName, user_name, all } = req.query;

    let filter = {};

    // If 'all' is not set to true (e.g. non-admin requests), filter rooms by user
    if (all !== "true" && all !== "1") {
      const targetId = userId || user_id;
      const targetEmail = email ? String(email).toLowerCase() : null;
      const targetName = userName || user_name;

      const orClauses = [];
      if (targetId) {
        orClauses.push({ creator_id: String(targetId) });
        orClauses.push({ "members.user_id": String(targetId) });
      }
      if (targetEmail) {
        orClauses.push({ creator_email: targetEmail });
        orClauses.push({ "members.user_id": targetEmail });
      }
      if (targetName) {
        orClauses.push({ creator_name: targetName });
        orClauses.push({ "members.user_name": targetName });
      }

      if (orClauses.length > 0) {
        filter = { $or: orClauses };
      }
    }

    const rooms = await Room.find(filter).sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    console.error("[getRooms]", err);
    res.status(500).json({ message: "Server error fetching rooms" });
  }
});

// ─── GET /api/rooms/:id ───────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const room = await Room.findOne({ id: req.params.id });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    res.json(room);
  } catch (err) {
    console.error("[getRoom]", err);
    res.status(500).json({ message: "Server error fetching room" });
  }
});

// ─── GET /api/rooms/:id/token ─────────────────────────────────────────────
router.get("/:id/token", async (req, res) => {
  try {
    const room = await Room.findOne({ id: req.params.id });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const appId = process.env.VITE_AGORA_APP_ID ;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appCertificate) {
      console.warn("[AgoraToken] AGORA_APP_CERTIFICATE is not configured in backend .env");
      return res.json({
        token: "",
        appId,
        warning: "AGORA_APP_CERTIFICATE is not configured in backend .env. Falls back to static/unsecured mode."
      });
    }

    const meetingCode = room.meeting_code || room.id || "hackord_meeting";
    const channelName = meetingCode.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

    const uid = 0;
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600 * 2; // 2 hours
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    console.log(`[AgoraToken] Generated wildcard token for room: ${room.id}, channelName: ${channelName}`);
    res.json({ token, appId });
  } catch (err) {
    console.error("[AgoraToken] Error generating Agora token:", err);
    res.status(500).json({ message: "Server error generating Agora RTC token" });
  }
});

// ─── POST /api/rooms ───────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      id,
      hackathon,
      name,
      problem,
      description,
      maxSize,
      deadlineRegistration,
      deadlinePpt,
      deadlinePrototype,
      deadlineFinal,
      deadlineResult,
      projectLinks,
      creatorId,
      creator_id,
      creatorEmail,
      creator_email,
      creatorName,
      creator_name,
      creatorAvatar,
      creator_avatar,
    } = req.body;

    if (!name || !hackathon) {
      return res.status(400).json({ message: "Room name and hackathon are required" });
    }

    const roomId =
      id ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) +
        "-" +
        Date.now().toString(36);

    const links = Array.isArray(projectLinks) ? projectLinks.filter((l) => l.url) : [];

    const ownerId = creatorId || creator_id || "";
    const ownerEmail = creatorEmail || creator_email || "";
    const ownerName = creatorName || creator_name || "Room Lead";
    const ownerAvatar = creatorAvatar || creator_avatar || "https://api.dicebear.com/9.x/glass/svg?seed=Owner";

    const newRoom = new Room({
      id: roomId,
      creator_id: String(ownerId),
      creator_email: ownerEmail ? String(ownerEmail).toLowerCase() : "",
      creator_name: ownerName,
      hackathon,
      name,
      problem: problem || "",
      description: description || "",
      github_url: req.body.github_url || req.body.githubUrl || "",
      meeting_code: req.body.meeting_code || req.body.meetingCode || "",
      max_size: maxSize || 6,
      status: "Planning",
      progress: 0,
      deadline_registration: deadlineRegistration || "",
      deadline_ppt: deadlinePpt || "",
      deadline_prototype: deadlinePrototype || "",
      deadline_final: deadlineFinal || "",
      deadline_result: deadlineResult || "",
      project_links: links,
      members: [
        {
          user_id: String(ownerId),
          user_name: ownerName,
          user_avatar: ownerAvatar,
          role: "Owner",
        },
      ],
      messages: [
        {
          id: `msg_${Date.now()}`,
          author_name: "System Bot",
          author_avatar: "https://api.dicebear.com/9.x/bottts/svg?seed=system",
          text: `🎉 Room "${name}" has been created! Welcome to your private hackathon workspace.`,
          pinned: true,
          created_at: new Date(),
        },
      ],
      activities: [
        {
          id: `act_${Date.now()}`,
          who: ownerName.split(" ")[0],
          what: `created room "${name}"`,
          when: new Date(),
        },
      ],
    });

    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (err) {
    console.error("[createRoom]", err);
    res.status(500).json({ message: "Server error creating room" });
  }
});

// ─── PUT /api/rooms/:id ───────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const room = await Room.findOne({ id: req.params.id });
    if (!room) return res.status(404).json({ message: "Room not found" });

    const fields = [
      "name", "hackathon", "problem", "description", "github_url", "meeting_code", "max_size",
      "deadline_registration", "deadline_ppt", "deadline_prototype",
      "deadline_final", "deadline_result", "status", "progress"
    ];

    let isNewMeeting = false;
    if (req.body.meeting_code !== undefined && req.body.meeting_code !== "" && req.body.meeting_code !== room.meeting_code) {
      isNewMeeting = true;
    }

    fields.forEach((f) => {
      if (req.body[f] !== undefined) room[f] = req.body[f];
    });

    if (req.body.project_links) {
      room.project_links = req.body.project_links;
    }

    if (isNewMeeting) {
      room.activities.unshift({
        id: `act_${Date.now()}`,
        who: req.body.updatedBy || "Owner",
        what: `started a new meeting (Join meet: ${req.body.meeting_code})`,
        when: new Date(),
      });
    } else {
      room.activities.unshift({
        id: `act_${Date.now()}`,
        who: req.body.updatedBy || "Owner",
        what: "updated room details",
        when: new Date(),
      });
    }

    await room.save();
    res.json(room);
  } catch (err) {
    console.error("[updateRoom]", err);
    res.status(500).json({ message: "Server error updating room" });
  }
});

// ─── POST /api/rooms/:id/members ──────────────────────────────────────────
router.post("/:id/members", async (req, res) => {
  try {
    const { user_id, user_name, user_avatar, role } = req.body;
    const room = await Room.findOne({ id: req.params.id });

    if (!room) return res.status(404).json({ message: "Room not found" });

    const maxSize = room.max_size || 6;
    if (room.members.length >= maxSize) {
      return res.status(400).json({ message: `Room capacity limit reached (${room.members.length}/${maxSize} members).` });
    }

    const exists = room.members.some((m) => m.user_id === user_id);
    if (!exists) {
      room.members.push({
        user_id: user_id || `u_${Date.now()}`,
        user_name: user_name || "New Member",
        user_avatar: user_avatar || "https://api.dicebear.com/9.x/glass/svg?seed=Member",
        role: role || "Contributor",
      });

      room.activities.unshift({
        id: `act_${Date.now()}`,
        who: user_name ? user_name.split(" ")[0] : "Member",
        what: `joined team`,
        when: new Date(),
      });

      await room.save();
    }

    res.json(room);
  } catch (err) {
    console.error("[addMember]", err);
    res.status(500).json({ message: "Server error adding member" });
  }
});

// ─── DELETE /api/rooms/:id/members/:userId ────────────────────────────────
router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const { id, userId } = req.params;
    const room = await Room.findOne({ id });

    if (!room) return res.status(404).json({ message: "Room not found" });

    const memberIndex = room.members.findIndex(
      (m) => m.user_id === userId || m.user_name === userId
    );

    if (memberIndex !== -1) {
      const removedMember = room.members.splice(memberIndex, 1)[0];

      room.activities.unshift({
        id: `act_${Date.now()}`,
        who: req.body?.removedBy || "Owner",
        what: `removed ${removedMember.user_name} from team`,
        when: new Date(),
      });

      await room.save();
    }

    res.json(room);
  } catch (err) {
    console.error("[removeMember]", err);
    res.status(500).json({ message: "Server error removing member" });
  }
});

// ─── GET /api/rooms/:id/messages & POST /api/rooms/:id/messages ───────────
router.get("/:id/messages", async (req, res) => {
  try {
    const room = await Room.findOne({ id: req.params.id });
    if (!room) return res.status(404).json({ message: "Room not found" });

    const since = req.query.since;
    let msgs = room.messages;
    if (since) {
      const sinceTime = new Date(since).getTime();
      msgs = msgs.filter((m) => new Date(m.created_at).getTime() > sinceTime);
    }
    res.json(msgs);
  } catch (err) {
    console.error("[getMessages]", err);
    res.status(500).json({ message: "Server error fetching messages" });
  }
});

router.post("/:id/messages", async (req, res) => {
  try {
    const { text, authorName, authorAvatar } = req.body;
    const room = await Room.findOne({ id: req.params.id });
    if (!room) return res.status(404).json({ message: "Room not found" });

    const newMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      author_name: authorName || "User",
      author_avatar: authorAvatar || "https://api.dicebear.com/9.x/glass/svg?seed=User",
      text,
      pinned: false,
      created_at: new Date(),
    };

    room.messages.push(newMsg);
    await room.save();
    res.status(201).json(newMsg);
  } catch (err) {
    console.error("[sendMessage]", err);
    res.status(500).json({ message: "Server error sending message" });
  }
});

// ─── POST /api/rooms/:id/files ─────────────────────────────────────────────
router.post("/:id/files", async (req, res) => {
  try {
    const { name, url, type, uploadedBy } = req.body;
    if (!name || !url) {
      return res.status(400).json({ message: "Resource name and URL are required" });
    }

    const room = await Room.findOne({ id: req.params.id });
    if (!room) return res.status(404).json({ message: "Room not found" });

    const uploader = uploadedBy || "Member";
    const fileType = type || (url.includes(".pdf") ? "pdf" : url.includes(".ppt") ? "ppt" : "link");

    const newFile = {
      id: `file_${Date.now()}`,
      name,
      url,
      type: fileType,
      uploadedBy: uploader,
      size: "External URL",
      createdAt: new Date(),
    };

    room.files.unshift(newFile);
    room.activities.unshift({
      id: `act_${Date.now()}`,
      who: uploader.split(" ")[0],
      what: `added resource "${name}"`,
      when: new Date(),
    });

    await room.save();
    res.status(201).json(newFile);
  } catch (err) {
    console.error("[addFile]", err);
    res.status(500).json({ message: "Server error adding resource/file" });
  }
});

// ─── POST /api/rooms/:id/tasks & PATCH /api/rooms/:id/tasks/:taskId ───────
router.post("/:id/tasks", async (req, res) => {
  try {
    const { title, assignee, priority, deadline } = req.body;
    if (!title) return res.status(400).json({ message: "Task title is required" });

    const room = await findRoom(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const newTask = {
      id: `task_${Date.now()}`,
      title,
      assignee: assignee || "Unassigned",
      status: "Todo",
      priority: priority || "Medium",
      deadline: deadline || "Upcoming",
      createdAt: new Date(),
    };

    room.tasks.push(newTask);

    // Recalculate room progress based on completed tasks
    const completedCount = room.tasks.filter((t) => t.status === "Completed").length;
    room.progress = room.tasks.length > 0 ? Math.round((completedCount / room.tasks.length) * 100) : 0;

    room.activities.unshift({
      id: `act_${Date.now()}`,
      who: assignee ? assignee.split(" ")[0] : "Member",
      what: `created task "${title}"`,
      when: new Date(),
    });

    await room.save();
    res.status(201).json(newTask);
  } catch (err) {
    console.error("[addTask]", err);
    res.status(500).json({ message: "Server error adding task" });
  }
});

router.patch("/:id/tasks/:taskId", async (req, res) => {
  try {
    const { status } = req.body;
    const room = await findRoom(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const task = room.tasks.find((t) => t.id === req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    task.status = status;

    // Recalculate room progress
    const completedCount = room.tasks.filter((t) => t.status === "Completed").length;
    room.progress = room.tasks.length > 0 ? Math.round((completedCount / room.tasks.length) * 100) : 0;

    room.activities.unshift({
      id: `act_${Date.now()}`,
      who: task.assignee ? task.assignee.split(" ")[0] : "Member",
      what: `moved task "${task.title}" → ${status}`,
      when: new Date(),
    });

    await room.save();
    res.json(room);
  } catch (err) {
    console.error("[updateTask]", err);
    res.status(500).json({ message: "Server error updating task" });
  }
});

router.delete("/:id/tasks/:taskId", async (req, res) => {
  try {
    const room = await findRoom(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const idx = room.tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx !== -1) {
      const removed = room.tasks.splice(idx, 1)[0];
      const completedCount = room.tasks.filter((t) => t.status === "Completed").length;
      room.progress = room.tasks.length > 0 ? Math.round((completedCount / room.tasks.length) * 100) : 0;

      room.activities.unshift({
        id: `act_${Date.now()}`,
        who: "Member",
        what: `deleted task "${removed.title}"`,
        when: new Date(),
      });
      await room.save();
    }

    res.json(room);
  } catch (err) {
    console.error("[deleteTask]", err);
    res.status(500).json({ message: "Server error deleting task" });
  }
});

// ─── POST /api/rooms/:id/links ──────────────────────────────────────────────
router.post("/:id/links", async (req, res) => {
  try {
    const { label, url } = req.body;
    if (!label || !url) return res.status(400).json({ message: "Label and URL are required" });

    const room = await findRoom(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });

    room.project_links.push({ label, url });
    room.activities.unshift({
      id: `act_${Date.now()}`,
      who: "Team",
      what: `added link "${label}"`,
      when: new Date(),
    });

    await room.save();
    res.json(room);
  } catch (err) {
    console.error("[addLink]", err);
    res.status(500).json({ message: "Server error adding link" });
  }
});

// ─── DELETE /api/rooms/:id ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const room = await findRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    await Room.deleteOne({ _id: room._id });
    console.log(`[deleteRoom] ✅ Room deleted: ${req.params.id}`);
    res.json({ message: "Room deleted successfully", id: req.params.id });
  } catch (err) {
    console.error("[deleteRoom]", err);
    res.status(500).json({ message: "Server error deleting room" });
  }
});

module.exports = router;
