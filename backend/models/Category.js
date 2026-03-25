const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    color: { type: String, default: "#3B82F6" },
    icon: { type: String, default: "\uD83D\uDCC1" }
  },
  { timestamps: true }
);

categorySchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Category", categorySchema);
