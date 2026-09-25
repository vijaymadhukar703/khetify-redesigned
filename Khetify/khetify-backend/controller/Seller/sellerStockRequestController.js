const mongoose = require("mongoose");
const StockNotification = require("../../model/Shop/StockNotification");

/**
 * Seller Stock Request Controller
 * Handles seller view of pending stock notifications
 */
exports.getPendingStockRequests = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { limit = 20, page = 1 } = req.query;

    const skip = (page - 1) * limit;

    // Get products with pending stock notifications grouped by product
    const pendingRequests = await StockNotification.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
          status: "active",
        },
      },
      {
        $group: {
          _id: "$productId",
          interestedCustomers: { $sum: 1 },
          variantLabel: { $first: "$variantLabel" },
          createdAt: { $min: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          productId: "$_id",
          productName: "$product.productName",
          productCode: "$product.product_code",
          brandName: "$product.brandName",
          variantLabel: 1,
          interestedCustomers: 1,
          oldestRequestAt: "$createdAt",
        },
      },
      {
        $sort: { interestedCustomers: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: parseInt(limit),
      },
    ]);

    // Get total count
    const totalResult = await StockNotification.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
          status: "active",
        },
      },
      {
        $group: {
          _id: "$productId",
        },
      },
      {
        $count: "total",
      },
    ]);

    const total = totalResult[0]?.total || 0;

    return res.status(200).json({
      success: true,
      data: {
        pendingRequests,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching pending stock requests:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Get interested customers for a specific product
 * GET /api/seller/stock-requests/:productId
 */
exports.getInterestedCustomers = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { productId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    const skip = (page - 1) * limit;

    // Get all active requests for this product (verify seller ownership)
    const requests = await StockNotification.find({
      productId,
      sellerId,
      status: "active",
    })
      .populate("customerId", "name email phone")
      .select("-__v")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await StockNotification.countDocuments({
      productId,
      sellerId,
      status: "active",
    });

    if (requests.length === 0 && skip > 0) {
      return res.status(404).json({ success: false, message: "No more customers for this product" });
    }

    return res.status(200).json({
      success: true,
      data: {
        productId,
        interestedCustomers: requests,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching interested customers:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Get summary stats for seller's pending stock requests
 * GET /api/seller/stock-requests/stats/summary
 */
exports.getStockRequestStats = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;

    // Total active requests
    const totalActiveRequests = await StockNotification.countDocuments({
      sellerId,
      status: "active",
    });

    // Total products with pending requests
    const productsWithRequests = await StockNotification.distinct("productId", {
      sellerId,
      status: "active",
    });

    // Top 5 products with most interested customers
    const topProducts = await StockNotification.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
          status: "active",
        },
      },
      {
        $group: {
          _id: "$productId",
          interestedCustomers: { $sum: 1 },
        },
      },
      {
        $sort: { interestedCustomers: -1 },
      },
      {
        $limit: 5,
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          productId: "$_id",
          productName: "$product.productName",
          productCode: "$product.product_code",
          interestedCustomers: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalActiveRequests,
        productsWithRequests: productsWithRequests.length,
        topProducts,
      },
    });
  } catch (error) {
    console.error("Error fetching stock request stats:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};