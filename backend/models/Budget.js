const mongoose = require("mongoose");

const budgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true },
    allocated: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

budgetSchema.index({ userId: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Budget", budgetSchema);
