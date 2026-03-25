const express = require("express");
const mongoose = require("mongoose");
const { body, param } = require("express-validator");
const Transaction = require("../models/Transaction");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../middleware/asyncHandler");
const HttpError = require("../utils/httpError");

const router = express.Router();

router.use(auth);

function toUserObjectId(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new HttpError(401, "Invalid token user id");
  }
  return new mongoose.Types.ObjectId(userId);
}

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const txs = await Transaction.find({ userId: req.user.id });

    let income = 0;
    let expenses = 0;
    let savings = 0;

    for (const tx of txs) {
      const amount = Number(tx.amount || 0);
      if (tx.type === "income") {
        income += amount;
      } else {
        expenses += amount;
        if (String(tx.category || "").toLowerCase() === "savings") {
          savings += amount;
        }
      }
    }

    res.json({ income, expenses, savings, balance: income - expenses });
  })
);

router.get(
  "/spending-by-category",
  asyncHandler(async (req, res) => {
    const userObjectId = toUserObjectId(req.user.id);
    const data = await Transaction.aggregate([
      { $match: { userId: userObjectId, type: "expense" } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } }
    ]);

    res.json(data);
  })
);

router.get(
  "/monthly-trends",
  asyncHandler(async (req, res) => {
    const userObjectId = toUserObjectId(req.user.id);
    const data = await Transaction.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: { month: { $month: "$date" }, type: "$type" },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { "_id.month": 1 } }
    ]);

    res.json(data);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await Transaction.find({ userId: req.user.id }).sort({ date: -1 });
    res.json(items);
  })
);

router.post(
  "/",
  [
    body("category")
      .trim()
      .notEmpty()
      .withMessage("Category is required")
      .isLength({ max: 60 })
      .withMessage("Category must be at most 60 characters"),
    body("amount")
      .isFloat({ gt: 0 })
      .withMessage("Amount must be greater than 0")
      .toFloat(),
    body("type")
      .isIn(["income", "expense"])
      .withMessage("Type must be either income or expense"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 300 })
      .withMessage("Description must be at most 300 characters"),
    body("date")
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage("Date must be a valid ISO date")
      .toDate()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const tx = await Transaction.create({
      userId: req.user.id,
      category: req.body.category,
      amount: req.body.amount,
      type: req.body.type,
      description: req.body.description || "",
      date: req.body.date || undefined
    });

    res.status(201).json(tx);
  })
);

router.delete(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid transaction id")],
  validate,
  asyncHandler(async (req, res) => {
    const deleted = await Transaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!deleted) {
      throw new HttpError(404, "Transaction not found");
    }

    res.json({ message: "Transaction deleted" });
  })
);

module.exports = router;
