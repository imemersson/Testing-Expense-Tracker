const express = require("express");
const { body, param } = require("express-validator");
const Category = require("../models/Category");
const Budget = require("../models/Budget");
const Transaction = require("../models/Transaction");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../middleware/asyncHandler");
const HttpError = require("../utils/httpError");

const router = express.Router();

router.use(auth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await Category.find({ userId: req.user.id }).sort({ name: 1 });
    res.json(categories);
  })
);

router.post(
  "/",
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Category name is required")
      .isLength({ max: 60 })
      .withMessage("Category name must be at most 60 characters"),
    body("color")
      .optional()
      .matches(/^#([A-Fa-f0-9]{6})$/)
      .withMessage("Color must be a valid hex code"),
    body("icon")
      .optional()
      .trim()
      .isLength({ min: 1, max: 4 })
      .withMessage("Icon must be 1 to 4 characters")
  ],
  validate,
  asyncHandler(async (req, res) => {
    const category = await Category.create({
      userId: req.user.id,
      name: req.body.name,
      color: req.body.color || "#3B82F6",
      icon: req.body.icon || "\uD83D\uDCC1"
    });

    res.status(201).json(category);
  })
);

router.delete(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid category id")],
  validate,
  asyncHandler(async (req, res) => {
    const category = await Category.findOne({ _id: req.params.id, userId: req.user.id });
    if (!category) {
      throw new HttpError(404, "Category not found");
    }

    await Category.deleteOne({ _id: category._id, userId: req.user.id });

    const [budgetDeleteResult, txUpdateResult] = await Promise.all([
      Budget.deleteMany({ userId: req.user.id, category: category.name }),
      Transaction.updateMany(
        { userId: req.user.id, category: category.name },
        { $set: { category: "Uncategorized" } }
      )
    ]);

    res.json({
      message: "Category deleted",
      category: category.name,
      removedBudgets: budgetDeleteResult.deletedCount || 0,
      updatedTransactions: txUpdateResult.modifiedCount || 0
    });
  })
);

module.exports = router;
