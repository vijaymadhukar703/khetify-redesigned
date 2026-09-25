const mongoose = require("mongoose");

const positiveMeasurement = (label) => ({ type: Number, required: true,
  validate: { validator: v => Number.isFinite(v) && v > 0, message: label + ' must be greater than zero' } });
const measurementsSchema = new mongoose.Schema({
  packagingType: { type: String, trim: true, required: true },
  unit: { type: String, required: true, enum: ['Kilograms', 'Grams', 'Metric Ton', 'Liters', 'Milliliters', 'Pieces', 'Packets'] },
  unitValue: positiveMeasurement('Unit value'),
  length: positiveMeasurement('Length'), width: positiveMeasurement('Width'), height: positiveMeasurement('Height'),
  dimensionUnit: { type: String, required: true, enum: ['mm', 'cm', 'm', 'inch', 'ft'] },
  weight: positiveMeasurement('Shipping Weight (Gross)'),
  weightUnit: { type: String, required: true, enum: ['g', 'kg', 'MT'] },
}, { _id: false });

module.exports = measurementsSchema;
