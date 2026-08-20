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
  },
  { timestamps: true }
);

AiFileSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model('AiFile', AiFileSchema);
