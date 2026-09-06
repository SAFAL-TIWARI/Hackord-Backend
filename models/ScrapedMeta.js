const mongoose = require("mongoose");

const scrapedMetaSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global_staging", unique: true },
    isCleared: { type: Boolean, default: false },
    lastScrapedAt: { type: Date, default: null },
    lastMergedAt: { type: Date, default: null },
    lastClearedAt: { type: Date, default: null },
    totalCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ScrapedMeta", scrapedMetaSchema);
