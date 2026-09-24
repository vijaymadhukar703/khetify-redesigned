const { z } = require("zod");
const { createMyProductBody, updateMyProductBody } = require("./sellerMyProductValidators");

/**
 * ADMIN PRODUCT LIBRARY — the seller "My Products" bodies, imported (never
 * edited) and extended with the company identity fields an admin records.
 *
 * Same stripping rule as the seller bodies: zod drops unknown keys, so
 * `product_code`, `createdByAdmin` and the ownership fields can never be set
 * from the client.
 */

// L/U + 5 digits (industry) + 2 letters (state) + 4 digits (year) + 3 letters
// (company type) + 6 digits (registration number) = 21 characters.
const CIN_REGEX = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

const requiredName = (label) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(200);

const optionalName = (label) =>
  z.string().trim().min(1, `${label} cannot be blank`).max(200).optional();

const licNo = z.string().trim().max(60).optional();

// Blank is allowed (not every company has a CIN); a filled value is uppercased
// and must be a well-formed 21-character CIN.
const cinNo = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || CIN_REGEX.test(v), "Enter a valid 21-character CIN")
  .optional();

const createAdminProductBody = createMyProductBody.extend({
  companyName: requiredName("Company Name"),
  legalName: requiredName("Legal Name"),
  licNo,
  cinNo,
});

const updateAdminProductBody = updateMyProductBody.extend({
  companyName: optionalName("Company Name"),
  legalName: optionalName("Legal Name"),
  licNo,
  cinNo,
});

module.exports = { createAdminProductBody, updateAdminProductBody };
