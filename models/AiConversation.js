const mongoose = require('mongoose');

const AiFileAttachmentSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => 'file-' + Date.now() },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    type: { type: String, default: 'application/octet-stream' },
    dataUrl: { type: String, default: '' }, // Data URI / Base64 for viewing in new tab
    extractedText: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    author_name: { type: String, default: '' },
    author_id: { type: String, default: '' },
  },
  { _id: false }
);

const AiStudioImageSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) },
    url: { type: String, required: true },
    prompt: { type: String, default: '' },
    style: { type: String, default: 'Photorealistic' },
    aspectRatio: { type: String, default: '16:9' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AiMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    sender: { type: String, enum: ['user', 'ai'], required: true },
    author_name: { type: String, default: '' },
    author_avatar: { type: String, default: '' },
    author_id: { type: String, default: '' },
    text: { type: String, required: true },
    timestamp: {
      type: String,
      default: () =>
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    plugin: { type: String, default: null },
    fileAttachment: { type: AiFileAttachmentSchema, default: null },
    structuredData: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const AiConversationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    roomId: { type: String, required: true, index: true }, // Shared across all room members
    userId: { type: String, required: true },
    author_name: { type: String, default: '' },
    author_avatar: { type: String, default: '' },
    title: { type: String, required: true, default: 'New Conversation' },
    pinned: { type: Boolean, default: false },
    activePlugin: { type: String, default: null },
    messages: [AiMessageSchema],
    aiStudio: {
      images: { type: [AiStudioImageSchema], default: [] },
    },
  },
  { timestamps: true }
);

AiConversationSchema.index({ roomId: 1, updatedAt: -1 });

module.exports = mongoose.model('AiConversation', AiConversationSchema);
