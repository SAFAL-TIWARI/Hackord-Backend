const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function () {
        return !this.googleId && !this.githubId;
      },
    },
    googleId: {
      type: String,
      default: "",
    },
    githubId: {
      type: String,
      default: "",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    // Profile fields
    username: { type: String, trim: true, default: "" },
    avatar: { type: String, default: "" },
    college: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    bio: { type: String, default: "" },
    experience: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced"],
      default: "Beginner",
    },
    skills: {
      type: [String],
      default: [],
    },
    github: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    portfolio: { type: String, default: "" },
    completedHackathons: {
      type: [
        {
          name: String,
          result: String,
        },
      ],
      default: [],
    },
    lastActive: { type: Date, default: Date.now },
    // Settings fields
    notificationPreferences: {
      emailEnabled: { type: Boolean, default: true },
      roomInvites: { type: Boolean, default: true },
      deadlines: { type: Boolean, default: true },
      chatMessages: { type: Boolean, default: true },
      desktopNotifications: { type: Boolean, default: true },
      reminders: { type: Boolean, default: false },
    },
    privacySettings: {
      discoverable: { type: Boolean, default: true },
      allowInvites: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
      showEmail: { type: Boolean, default: false },
      showOnlineStatus: { type: Boolean, default: true },
      activityStatus: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
