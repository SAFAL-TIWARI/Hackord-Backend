const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true },
    user_email: { type: String, default: "" },
    title: { type: String, default: "Note" },
    content: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Note", noteSchema);
