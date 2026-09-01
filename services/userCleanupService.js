const mongoose = require("mongoose");
const User = require("../models/User");
const Room = require("../models/Room");
const Note = require("../models/Note");
const Invitation = require("../models/Invitation");
const AiConversation = require("../models/AiConversation");
const AiFile = require("../models/AiFile");
const ExploreAiConversation = require("../models/ExploreAiConversation");
const ChatMessage = require("../models/ChatMessage");
const HackathonSubmission = require("../models/HackathonSubmission");
const ContactMessage = require("../models/ContactMessage");
const Otp = require("../models/Otp");
const LoginAttempt = require("../models/LoginAttempt");

/**
 * Permanently purges all data, resources, rooms, settings, conversations,
 * and records associated with a user across the database.
 *
 * @param {Object} user - The user document or object to delete
 * @returns {Promise<Object>} Summary of deleted items
 */
async function purgeUserCompleteData(user) {
  if (!user) {
    throw new Error("User object is required for purge");
  }

  const userId = user._id ? user._id : (mongoose.Types.ObjectId.isValid(user.id) ? new mongoose.Types.ObjectId(user.id) : null);
  const userIdStr = userId ? userId.toString() : (user.id ? String(user.id) : "");
  const userEmail = user.email ? String(user.email).toLowerCase().trim() : "";
  const userName = user.name ? String(user.name).trim() : "";
  const userUsername = user.username ? String(user.username).trim() : "";

  console.log(`[purgeUserCompleteData] 🧹 Starting comprehensive data purge for user: ${userEmail} (${userIdStr})...`);

  const summary = {
    userEmail,
    userId: userIdStr,
    deletedRoomsCount: 0,
    cleanedMemberRoomsCount: 0,
    deletedNotesCount: 0,
    deletedAiConversationsCount: 0,
    deletedAiFilesCount: 0,
    deletedExploreAiCount: 0,
    deletedChatMessagesCount: 0,
    deletedInvitationsCount: 0,
    deletedSubmissionsCount: 0,
    deletedContactMessagesCount: 0,
    deletedOtpsCount: 0,
    deletedLoginAttemptsCount: 0,
    userDeleted: false,
  };

  try {
    // 1. Find all rooms created by this user
    const roomCreatorConditions = [];
    if (userIdStr) roomCreatorConditions.push({ creator_id: userIdStr });
    if (userEmail) roomCreatorConditions.push({ creator_email: userEmail });
    if (userName) roomCreatorConditions.push({ creator_name: userName });

    let createdRoomIds = [];
    if (roomCreatorConditions.length > 0) {
      const createdRooms = await Room.find({ $or: roomCreatorConditions }).select("id _id").lean();
      createdRoomIds = createdRooms.map((r) => r.id).filter(Boolean);
    }

    // 2. Delete all rooms created by the user
    if (createdRoomIds.length > 0 || roomCreatorConditions.length > 0) {
      const roomDeleteRes = await Room.deleteMany({
        $or: [
          ...roomCreatorConditions,
          { id: { $in: createdRoomIds } },
        ],
      });
      summary.deletedRoomsCount = roomDeleteRes.deletedCount || 0;
    }

    // 3. Remove user from all other rooms where they are a member
    const memberIdentifiers = [];
    if (userIdStr) memberIdentifiers.push(userIdStr);
    if (userEmail) memberIdentifiers.push(userEmail);
    if (userUsername) memberIdentifiers.push(userUsername);
    if (userName) memberIdentifiers.push(userName);

    const pullConditions = [];
    if (userIdStr) pullConditions.push({ user_id: userIdStr });
    if (userEmail) pullConditions.push({ user_id: userEmail });
    if (userUsername) pullConditions.push({ user_id: userUsername });
    if (userName) pullConditions.push({ user_name: userName });

    if (pullConditions.length > 0) {
      const updateRes = await Room.updateMany(
        {},
        {
          $pull: {
            members: {
              $or: pullConditions,
            },
          },
        }
      );
      summary.cleanedMemberRoomsCount = updateRes.modifiedCount || 0;

      // Unassign tasks assigned to this user in remaining rooms
      if (memberIdentifiers.length > 0) {
        await Room.updateMany(
          { "tasks.assignee": { $in: memberIdentifiers } },
          { $set: { "tasks.$[elem].assignee": "Unassigned" } },
          { arrayFilters: [{ "elem.assignee": { $in: memberIdentifiers } }] }
        ).catch((err) => console.warn("[purgeUserCompleteData] Task unassign warning:", err.message));
      }
    }

    // 4. Delete AI Conversations (Room chats & user chats)
    const aiConvConditions = [];
    if (userIdStr) aiConvConditions.push({ userId: userIdStr });
    if (createdRoomIds.length > 0) aiConvConditions.push({ roomId: { $in: createdRoomIds } });
    if (aiConvConditions.length > 0) {
      const aiConvRes = await AiConversation.deleteMany({ $or: aiConvConditions });
      summary.deletedAiConversationsCount = aiConvRes.deletedCount || 0;
    }

    // 5. Delete AI Files
    const aiFileConditions = [];
    if (userIdStr) aiFileConditions.push({ userId: userIdStr });
    if (createdRoomIds.length > 0) aiFileConditions.push({ roomId: { $in: createdRoomIds } });
    if (aiFileConditions.length > 0) {
      const aiFileRes = await AiFile.deleteMany({ $or: aiFileConditions });
      summary.deletedAiFilesCount = aiFileRes.deletedCount || 0;
    }

    // 6. Delete Explore AI Conversations
    if (userId) {
      const expRes = await ExploreAiConversation.deleteMany({
        $or: [{ userId: userId }, ...(userIdStr ? [{ userId: userIdStr }] : [])],
      });
      summary.deletedExploreAiCount = expRes.deletedCount || 0;
    }

    // 7. Delete Chat Messages (General & Direct messages authored or received)
    const chatConditions = [];
    if (userIdStr) {
      chatConditions.push({ author_id: userIdStr });
      chatConditions.push({ recipient_id: userIdStr });
    }
    if (userEmail) {
      chatConditions.push({ author_username: userEmail });
      chatConditions.push({ recipient_username: userEmail });
    }
    if (userUsername) {
      chatConditions.push({ author_username: userUsername });
      chatConditions.push({ recipient_username: userUsername });
    }
    if (chatConditions.length > 0) {
      const chatRes = await ChatMessage.deleteMany({ $or: chatConditions });
      summary.deletedChatMessagesCount = chatRes.deletedCount || 0;
    }

    // 8. Delete Invitations (Sent or Received or for user's rooms)
    const invConditions = [];
    if (userIdStr) {
      invConditions.push({ "recipient.user_id": userIdStr });
      invConditions.push({ "sender.user_id": userIdStr });
    }
    if (userEmail) {
      invConditions.push({ "recipient.email": userEmail });
      invConditions.push({ "sender.email": userEmail });
    }
    if (createdRoomIds.length > 0) {
      invConditions.push({ roomId: { $in: createdRoomIds } });
    }
    if (invConditions.length > 0) {
      const invRes = await Invitation.deleteMany({ $or: invConditions });
      summary.deletedInvitationsCount = invRes.deletedCount || 0;
    }

    // 9. Delete Notes
    const noteConditions = [];
    if (userIdStr) noteConditions.push({ user_id: userIdStr });
    if (userEmail) noteConditions.push({ user_email: userEmail });
    if (noteConditions.length > 0) {
      const noteRes = await Note.deleteMany({ $or: noteConditions });
      summary.deletedNotesCount = noteRes.deletedCount || 0;
    }

    // 10. Delete Hackathon Submissions
    const subConditions = [];
    if (userIdStr) subConditions.push({ submittedBy: userIdStr });
    if (userEmail) subConditions.push({ contactEmail: userEmail });
    if (subConditions.length > 0) {
      const subRes = await HackathonSubmission.deleteMany({ $or: subConditions });
      summary.deletedSubmissionsCount = subRes.deletedCount || 0;
    }

    // 11. Delete Contact Messages
    if (userEmail) {
      const contactRes = await ContactMessage.deleteMany({ email: userEmail });
      summary.deletedContactMessagesCount = contactRes.deletedCount || 0;
    }

    // 12. Delete OTPs and Failed Login Attempts / Lockouts
    if (userEmail) {
      const otpRes = await Otp.deleteMany({ email: userEmail });
      summary.deletedOtpsCount = otpRes.deletedCount || 0;

      const safeEmailRegex = new RegExp(userEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), "i");
      const loginRes = await LoginAttempt.deleteMany({
        $or: [{ email: userEmail }, { key: { $regex: safeEmailRegex } }],
      });
      summary.deletedLoginAttemptsCount = loginRes.deletedCount || 0;
    }

    // 13. Finally, Delete the User document itself
    if (userId) {
      await User.findByIdAndDelete(userId);
      summary.userDeleted = true;
    }
    if (userEmail) {
      await User.deleteMany({ email: userEmail });
      summary.userDeleted = true;
    }

    console.log(`[purgeUserCompleteData] ✅ Successfully purged all data for ${userEmail}:`, summary);
    return summary;
  } catch (err) {
    console.error(`[purgeUserCompleteData] ❌ Error during purge for ${userEmail}:`, err);
    throw err;
  }
}

module.exports = {
  purgeUserCompleteData,
};
