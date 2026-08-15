const mongoose = require('mongoose');

const AiFileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    fileSize: { type: Number, required: true },
    extractedText: { type: String, default: '' },
    base64Data: { type: String, default: '' },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // Auto-delete after 24 hours (TTL index in seconds)
    },
  },
  { timestamps: true }
);

// TTL index configured on field

module.exports = mongoose.model('AiFile', AiFileSchema);
