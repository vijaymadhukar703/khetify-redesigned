const { z } = require("zod");

const positive = (label) => z.coerce.number().finite().positive(label + ' must be greater than zero');
const measurements = z.object({
  packagingType: z.string({ required_error: 'Packaging Type is required' }).trim().min(1, 'Packaging Type is required').max(200),
  unit: z.enum(['Kilograms', 'Grams', 'Metric Ton', 'Liters', 'Milliliters', 'Pieces', 'Packets']),
  unitValue: positive('Net Weight / Net Volume / Quantity per Pack'),
  length: positive('Length'), width: positive('Width'), height: positive('Height'),
  dimensionUnit: z.enum(['mm', 'cm', 'm', 'inch', 'ft']),
  weight: positive('Shipping Weight (Gross)'), weightUnit: z.enum(['g', 'kg', 'MT']),
}).superRefine((v, ctx) => {
  if (['Pieces', 'Packets'].includes(v.unit) && !Number.isInteger(v.unitValue))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitValue'], message: 'Quantity per Pack must be a whole number' });
});

module.exports = measurements;
