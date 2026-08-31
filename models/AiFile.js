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
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Expire uploaded file documents automatically after 24 hours (86,400 seconds) in MongoDB, just like Otp.js
AiFileSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });
AiFileSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model('AiFile', AiFileSchema);
