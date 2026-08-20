const { z } = require("zod");
const { memberName, memberEmail, memberPhone, memberPassword } = require("./userValidators");

/**
 * Warehouse creation now carries the Warehouse Manager's details, because a
 * company member is created ONLY as part of creating the warehouse they run.
 *
 * The manager field rules are IMPORTED from userValidators.js rather than
 * restated, so "Add Team Member" and "Add Warehouse" can never drift apart on
 * what counts as a valid name / email / phone / password.
 *
 * NOTE: middlewares/validate.js writes the parsed result back onto req.body and
 * zod strips unknown keys, so every field the controller reads must appear
 * below — address, location and capacityUnits included.
 */

// Street address. `line1` and `pincode` are MANDATORY — a warehouse is a
// physical place, so a delivery has to be able to reach it. city/state stay as
// they were (the form already collects them) and `district` remains optional.
const addressBody = z.object(
  {
    line1: z.string({ required_error: "Address is required" }).trim().min(1, "Address is required"),
    city: z.string().trim().optional(),
    district: z.string().trim().optional(),
    state: z.string().trim().optional(),
    pincode: z
      .string({ required_error: "Pincode is required" })
      .trim()
      .regex(/^\d{6}$/, "Pincode must be a valid 6-digit number"),
  },
  { required_error: "Address is required" }
);

// GeoJSON point, exactly as the Warehouse model stores it: [longitude, latitude].
// OPTIONAL. The Add Warehouse form no longer asks for coordinates — it takes an
// optional Google Maps link instead (see `mapsUrl` below). This schema is kept
// so any programmatic caller that already sends `location` keeps working, and
// so the controller can fill it in when it can read coordinates out of the link.
const longitude = z.coerce
  .number({ invalid_type_error: "Longitude must be a number" })
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");
const latitude = z.coerce
  .number({ invalid_type_error: "Latitude must be a number" })
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

const locationBody = z
  .object({
    type: z.literal("Point").optional().default("Point"),
    coordinates: z.tuple([longitude, latitude], {
      invalid_type_error: "Location must be [longitude, latitude]",
    }),
  })
  .optional();

// OPTIONAL Google Maps share link. Empty string and an omitted key are both
// accepted — leaving it blank must never block warehouse creation. When a value
// IS given we only insist it looks like an http(s) link, so every Google Maps
// share format works: the short maps.app.goo.gl link, the long /maps/place/…
// URL, and a plain ?q=lat,lng link alike.
const mapsUrlBody = z
  .string()
  .trim()
  .max(2048, "Link is too long")
  .refine(
    (v) => v === "" || /^https?:\/\/\S+$/i.test(v),
    "Enter a valid link starting with http:// or https://"
  )
  .optional();

// The Warehouse Manager created alongside the warehouse. Mandatory: the whole
// point of the new flow is that a warehouse never exists without one.
const managerBody = z.object(
  {
    name: memberName,
    email: memberEmail,
    phone: memberPhone,
    password: memberPassword,
  },
  { required_error: "Manager details are required" }
);

const createWarehouseBody = z.object({
  name: z
    .string({ required_error: "Warehouse name is required" })
    .trim()
    .min(1, "Warehouse name is required"),
  code: z.string().trim().max(50).optional(),
  address: addressBody,
  location: locationBody,
  mapsUrl: mapsUrlBody,
  capacityUnits: z.coerce.number().nonnegative().optional(),
  manager: managerBody,
});

module.exports = { createWarehouseBody };