const express = require("express");
const { body, param } = require("express-validator");
const Budget = require("../models/Budget");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../middleware/asyncHandler");
const HttpError = require("../utils/httpError");

const router = express.Router();

router.use(auth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const budgets = await Budget.find({ userId: req.user.id }).sort({ category: 1 });
    res.json(budgets);
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
    body("allocated")
      .isFloat({ min: 0 })
      .withMessage("Allocated amount must be 0 or greater")
      .toFloat()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const budget = await Budget.findOneAndUpdate(
      { userId: req.user.id, category: req.body.category },
      { $set: { allocated: req.body.allocated } },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(budget);
  })
);

router.put(
  "/:id",
  [
    param("id").isMongoId().withMessage("Invalid budget id"),
    body("allocated")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Allocated amount must be 0 or greater")
      .toFloat()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const budget = await Budget.findOne({ _id: req.params.id, userId: req.user.id });
    if (!budget) {
      throw new HttpError(404, "Budget not found");
    }

    if (req.body.allocated !== undefined) {
      budget.allocated = req.body.allocated;
    }

    const saved = await budget.save();
    res.json(saved);
  })
);

router.delete(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid budget id")],
  validate,
  asyncHandler(async (req, res) => {
    const deleted = await Budget.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!deleted) {
      throw new HttpError(404, "Budget not found");
    }

    res.json({ message: "Budget deleted" });
  })
);

module.exports = router;
