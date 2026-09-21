import React, { useState } from 'react';
import { getProductImage } from '../../lib/productImage';

/**
 * Modal for customers to request additional quantity when stock is exhausted
 * Displays product details, selected variant, quantity input, urgent checkbox
 * 
 * Props:
 * - isOpen: boolean - control visibility
 * - onClose: () => void - callback when closing
 * - product: object - product details
 * - selectedVariant: object - selected variant
 * - customerId: string - customer ID
 * - customerInfo: object - { name, email, phone }
 * - onSubmit: (quantity, isUrgent) => Promise - callback to handle submission
 * - isSubmitting: boolean - show loading state
 */
export default function RequestQuantityModal({
  isOpen,
  onClose,
  product,
  selectedVariant,
  customerId,
  customerInfo,
  onSubmit,
  isSubmitting = false,
}) {
  const [quantity, setQuantity] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen || !product) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate quantity
    if (!quantity || quantity < 1) {
      setError('Please enter a valid quantity');
      return;
    }

    if (quantity > 1000) {
      setError('Quantity cannot exceed 1000 units');
      return;
    }

    try {
      await onSubmit(quantity, isUrgent);
      setSuccess(true);
      setQuantity('');
      setIsUrgent(false);

      // Close modal after 1 second
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err.message || 'Error submitting request. Please try again.');
    }
  };

  const variantImage = selectedVariant?.images?.[0];
  const mainImage = variantImage || product.image || product.images?.[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <h2 className="text-xl font-bold text-stone-900">Request Quantity</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-stone-400 transition-colors hover:text-stone-600"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {success ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-6 text-center">
              <span className="material-symbols-outlined mb-3 inline-block text-4xl text-green-600">
                check_circle
              </span>
              <h3 className="mb-2 text-lg font-bold text-green-900">
                Request Submitted Successfully!
              </h3>
              <p className="text-green-700">
                You'll be notified when the seller responds to your request.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Product Details */}
              <div className="flex gap-4 rounded-lg bg-stone-50 p-4">
                {mainImage && (
                  <img
                    src={getProductImage(mainImage)}
                    alt={product.name}
                    className="h-20 w-20 object-cover rounded"
                    onError={(e) => { e.target.src = 'https://via.placeholder.com/80'; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-stone-900 line-clamp-2">{product.name}</h3>
                  {selectedVariant && (
                    <div className="mt-2 text-sm text-stone-600">
                      <p className="font-semibold">
                        {selectedVariant.label}
                      </p>
                      {selectedVariant.attributes &&
                        Object.entries(selectedVariant.attributes).map(
                          ([key, value]) => (
                            <p key={key} className="text-xs">
                              {key}: {value}
                            </p>
                          )
                        )}
                    </div>
                  )}
                  {product.seller && (
                    <p className="mt-2 text-xs text-stone-500">
                      Sold by: <span className="font-semibold">{product.seller.name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Quantity Input */}
              <div>
                <label className="block text-sm font-bold text-stone-900 mb-2">
                  Quantity Needed
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Enter quantity"
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-stone-300 px-4 py-3 focus:border-[#EA2831] focus:outline-none focus:ring-2 focus:ring-[#EA2831]/20"
                    required
                  />
                  <span className="text-sm text-stone-600 whitespace-nowrap">
                    {product.unit || 'units'}
                  </span>
                </div>
                {quantity && (
                  <p className="mt-2 text-xs text-stone-500">
                    ℹ️ Maximum: 1000 {product.unit || 'units'}
                  </p>
                )}
              </div>

              {/* Urgent Checkbox */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="urgent"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  disabled={isSubmitting}
                  className="h-5 w-5 cursor-pointer rounded border-stone-300 text-[#EA2831]"
                />
                <label
                  htmlFor="urgent"
                  className="flex-1 cursor-pointer text-sm font-medium text-stone-900"
                >
                  Mark as Urgent
                  <p className="text-xs font-normal text-stone-500 mt-0.5">
                    🚨 Seller will prioritize urgent requests
                  </p>
                </label>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-red-700">
                  <span className="material-symbols-outlined flex-shrink-0 text-lg mt-0.5">
                    error
                  </span>
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {/* Info Banner */}
              <div className="flex gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3">
                <span className="material-symbols-outlined flex-shrink-0 text-lg text-blue-700 mt-0.5">
                  info
                </span>
                <p className="text-sm text-blue-700">
                  The seller will review your request and notify you when they can fulfill it.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg border border-stone-300 px-4 py-3 font-bold text-stone-900 transition-all hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !quantity}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#EA2831] px-4 py-3 font-bold text-white transition-all hover:bg-[#D91C22] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-lg">
                        refresh
                      </span>
                      Submitting...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">send</span>
                      Submit Request
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}