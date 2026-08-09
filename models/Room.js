const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true },
    user_name: { type: String, required: true },
    user_avatar: { type: String, default: "" },
    role: { type: String, default: "Member" },
  },
  { _id: false }
);

const projectLinkSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const fileResourceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String, default: "link" },
    uploadedBy: { type: String, default: "Team Member" },
    size: { type: String, default: "External Link" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    assignee: { type: String, default: "Unassigned" },
    status: {
      type: String,
      enum: ["Todo", "In Progress", "Completed"],
      default: "Todo",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    deadline: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    author_name: { type: String, required: true },
    author_avatar: { type: String, default: "" },
    text: { type: String, required: true },
    pinned: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    recipient_name: { type: String, default: null },
    reply_to: { type: String, default: null },
    edited: { type: Boolean, default: false },
  },
  { _id: false }
);

const activitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    who: { type: String, required: true },
    what: { type: String, required: true },
    when: { type: Date, default: Date.now },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    creator_id: { type: String, default: "" },
    creator_email: { type: String, default: "" },
    creator_name: { type: String, default: "" },
    hackathon: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    problem: { type: String, default: "" },
    description: { type: String, default: "" },
    github_url: { type: String, default: "" },
    meeting_code: { type: String, default: "" },
    max_size: { type: Number, default: 6 },
    status: {
      type: String,
      enum: ["Active", "Planning", "Submission"],
      default: "Planning",
    },
    progress: { type: Number, default: 0 },
    deadline_registration: { type: String, default: "" },
    deadline_ppt: { type: String, default: "" },
    deadline_prototype: { type: String, default: "" },
    deadline_final: { type: String, default: "" },
    deadline_result: { type: String, default: "" },
    project_links: { type: [projectLinkSchema], default: [] },
    members: { type: [memberSchema], default: [] },
    files: { type: [fileResourceSchema], default: [] },
    tasks: { type: [taskSchema], default: [] },
    messages: { type: [messageSchema], default: [] },
    activities: { type: [activitySchema], default: [] },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Room", roomSchema);
