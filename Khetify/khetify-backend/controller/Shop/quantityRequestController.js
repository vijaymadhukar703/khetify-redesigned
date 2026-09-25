const mongoose = require("mongoose");
const QuantityRequest = require("../../model/Shop/QuantityRequest");
const Notification = require("../../model/Notification/Notification");
const SellerListing = require("../../model/PC/SellerListing");

/**
 * Create a new quantity request from customer
 * POST /api/shop/quantity-requests
 */
const createQuantityRequest = async (req, res) => {
  try {
    // customerId always comes from the verified JWT (req.consumer.id set by
    // consumerAuth middleware) — never trust the value sent in the request body.
    const customerId = req.consumer.id;

    const {
      customerName,
      customerEmail,
      customerPhone,
      productId,
      listingId,
      productName,
      productImage,
      variantId,
      variantDetails,
      requestedQuantity,
      isUrgent,
    } = req.body;

    // Validate required fields
    if (
      !customerId ||
      !productId ||
      !listingId ||
      !requestedQuantity ||
      requestedQuantity < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid required fields",
      });
    }

    // Get listing to find seller
    const listing = await SellerListing.findById(listingId).populate("sellerId");
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found",
      });
    }

    const sellerId = listing.sellerId._id;
    const sellerName = listing.sellerId.sellerInfo?.businessName || listing.sellerId.contact?.ownerName || "Seller";

    // Create the quantity request
    const quantityRequest = new QuantityRequest({
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      productId,
      listingId,
      productName,
      productImage,
      variantId,
      variantDetails,
      requestedQuantity,
      isUrgent: isUrgent || false,
      sellerId,
      sellerName,
      status: "pending",
    });

    await quantityRequest.save();

    // Create notification for seller.
    // The request is already saved above — if the notification fails for any
    // reason, log it but still return success, so the customer does not see an
    // error and submit the same request again (duplicate requests).
    try {
      await Notification.create({
        recipientType: "seller",
        recipientId: sellerId,
        type: "quantity_request",
        title: `New Quantity Request - ${productName}`,
        body: `${customerName} requested ${requestedQuantity} units${
          isUrgent ? " (Urgent)" : ""
        }`,
        payload: {
          quantityRequestId: quantityRequest._id,
          productId,
          listingId,
          customerId,
          requestedQuantity,
          isUrgent,
        },
        read: false,
      });
    } catch (notifyErr) {
      console.error("Quantity request saved, but seller notification failed:", notifyErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Quantity request submitted successfully",
      data: quantityRequest,
    });
  } catch (error) {
    console.error("Error creating quantity request:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error creating quantity request",
    });
  }
};

/**
 * Get quantity requests for customer
 * GET /api/shop/quantity-requests/customer/:customerId
 */
const getCustomerQuantityRequests = async (req, res) => {
  try {
    // customerId from JWT (consumerAuth middleware) — no URL param needed.
    // This also ensures a customer can only ever see their own requests.
    const customerId = req.consumer.id;
    const { status, sortBy } = req.query;

    const query = { customerId };
    if (status) {
      query.status = status;
    }

    const sortOptions = {};
    if (sortBy === "recent") {
      sortOptions.createdAt = -1;
    } else if (sortBy === "urgent") {
      sortOptions.isUrgent = -1;
      sortOptions.createdAt = -1;
    } else {
      sortOptions.createdAt = -1; // Default: most recent first
    }

    const requests = await QuantityRequest.find(query)
      .sort(sortOptions)
      .lean();

    res.status(200).json({
      success: true,
      data: requests,
      count: requests.length,
    });
  } catch (error) {
    console.error("Error fetching customer quantity requests:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching requests",
    });
  }
};

/**
 * Get quantity requests for seller (Demand Monitor)
 * GET /api/seller/quantity-requests/:sellerId
 */
const getSellerQuantityRequests = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { status, sortBy, page = 1, limit = 20 } = req.query;

    const query = { sellerId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const sortOptions = {};
    if (sortBy === "urgent") {
      sortOptions.isUrgent = -1;
      sortOptions.createdAt = -1;
    } else if (sortBy === "oldest") {
      sortOptions.createdAt = 1;
    } else {
      sortOptions.createdAt = -1; // Default: most recent first
    }

    const [requests, total] = await Promise.all([
      QuantityRequest.find(query).sort(sortOptions).skip(skip).limit(limit),
      QuantityRequest.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching seller quantity requests:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching requests",
    });
  }
};

/**
 * Get interested users (customers who have made quantity requests) for a product
 * GET /api/seller/interested-users/:sellerId/:productId
 */
const getInterestedUsers = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      QuantityRequest.aggregate([
        {
          $match: {
            sellerId: new mongoose.Types.ObjectId(sellerId),
            productId: new mongoose.Types.ObjectId(productId),
          },
        },
        {
          $group: {
            _id: "$customerId",
            customerName: { $first: "$customerName" },
            customerEmail: { $first: "$customerEmail" },
            customerPhone: { $first: "$customerPhone" },
            requestCount: { $sum: 1 },
            lastRequest: { $max: "$createdAt" },
            totalQuantityRequested: { $sum: "$requestedQuantity" },
            urgentRequests: {
              $sum: { $cond: ["$isUrgent", 1, 0] },
            },
          },
        },
        { $sort: { lastRequest: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit) },
      ]),
      QuantityRequest.aggregate([
        {
          $match: {
            sellerId: new mongoose.Types.ObjectId(sellerId),
            productId: new mongoose.Types.ObjectId(productId),
          },
        },
        {
          $group: {
            _id: "$customerId",
          },
        },
        {
          $count: "total",
        },
      ]),
    ]);

    const totalCount = total.length > 0 ? total[0].total : 0;

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching interested users:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching interested users",
    });
  }
};

/**
 * Update quantity request status (seller action)
 * PUT /api/seller/quantity-requests/:requestId/status
 */
const updateRequestStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, rejectionReason, sellerMessage, notes } = req.body;

    const validStatuses = ["pending", "fulfilled", "rejected", "partially_fulfilled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const request = await QuantityRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    request.status = status;
    if (rejectionReason && status === "rejected") {
      request.rejectionReason = rejectionReason;
    }
    if (sellerMessage) {
      request.sellerMessage = sellerMessage;
    }
    if (notes) {
      request.notes = notes;
    }
    request.viewedBySeller = true;

    await request.save();

    // Build customer notification
    let notificationTitle = "";
    let notificationBody = "";

    const msgSuffix = sellerMessage ? ` Message from seller: "${sellerMessage}"` : "";

    if (status === "fulfilled") {
      notificationTitle = `✅ Request Fulfilled — ${request.productName}`;
      notificationBody = `Your request for ${request.requestedQuantity} units has been fulfilled by ${request.sellerName}.${msgSuffix}`;
    } else if (status === "partially_fulfilled") {
      notificationTitle = `⚠️ Partially Fulfilled — ${request.productName}`;
      notificationBody = `Your request has been partially fulfilled by ${request.sellerName}.${msgSuffix}`;
    } else if (status === "rejected") {
      notificationTitle = `❌ Request Rejected — ${request.productName}`;
      const reason = rejectionReason ? ` Reason: ${rejectionReason}.` : "";
      notificationBody = `Your request for ${request.requestedQuantity} units was rejected.${reason}${msgSuffix}`;
    }

    if (notificationTitle) {
      await Notification.create({
        recipientType: "customer",
        recipientId: request.customerId,
        type: "quantity_request",
        title: notificationTitle,
        body: notificationBody,
        payload: {
          quantityRequestId: request._id,
          listingId: request.listingId,
          productId: request.productId,
          status,
          sellerMessage,
        },
        read: false,
      });
    }

    res.status(200).json({
      success: true,
      message: "Request status updated successfully",
      data: request,
    });
  } catch (error) {
    console.error("Error updating request status:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error updating request",
    });
  }
};

/**
 * Delete a quantity request
 * DELETE /api/shop/quantity-requests/:requestId
 */
const deleteQuantityRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const customerId = req.consumer.id;

    // Only allow deletion of own requests
    const request = await QuantityRequest.findOneAndDelete({
      _id: requestId,
      customerId,
    });
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Request deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting request:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error deleting request",
    });
  }
};

/**
 * Get summary/stats for seller dashboard
 * GET /api/seller/quantity-requests-summary/:sellerId
 */
const getQuantityRequestsSummary = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;

    const summary = await QuantityRequest.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
        },
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          pendingRequests: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          fulfilledRequests: {
            $sum: { $cond: [{ $eq: ["$status", "fulfilled"] }, 1, 0] },
          },
          rejectedRequests: {
            $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
          },
          urgentRequests: {
            $sum: { $cond: ["$isUrgent", 1, 0] },
          },
          totalQuantityRequested: { $sum: "$requestedQuantity" },
          uniqueCustomers: {
            $addToSet: "$customerId",
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalRequests: 1,
          pendingRequests: 1,
          fulfilledRequests: 1,
          rejectedRequests: 1,
          urgentRequests: 1,
          totalQuantityRequested: 1,
          uniqueCustomersCount: { $size: "$uniqueCustomers" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: summary.length > 0 ? summary[0] : {
        totalRequests: 0,
        pendingRequests: 0,
        fulfilledRequests: 0,
        rejectedRequests: 0,
        urgentRequests: 0,
        totalQuantityRequested: 0,
        uniqueCustomersCount: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching summary",
    });
  }
};

module.exports = {
  createQuantityRequest,
  getCustomerQuantityRequests,
  getSellerQuantityRequests,
  getInterestedUsers,
  updateRequestStatus,
  deleteQuantityRequest,
  getQuantityRequestsSummary,
};