/**
 * SEED THE TRANSLATION CACHE with the catalogue's fixed vocabulary.
 *
 *   node scripts/seedTranslations.js
 *
 * These are the values the Company upload form offers as DROPDOWNS — categories,
 * units, packaging, storage conditions, and the variant attributes companies
 * actually use. A few dozen strings that repeat across every product, so seeding
 * them makes the whole catalogue readable in Hindi immediately, before any
 * machine-translation worker exists.
 *
 * They are written as `source: "human"` because they are verified agricultural
 * Hindi, not machine output — which also means a future MT worker will never
 * overwrite them (see model/Master/Translation.js).
 *
 * IDEMPOTENT. Re-running only refreshes these rows; it touches nothing else and
 * never deletes. Safe to run after every deploy.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Translation = require("../model/Master/Translation");
const { hashSource } = require("../model/Master/Translation");

/** English source → verified Hindi. */
const HI = {
  /* Categories (the six the form offers) */
  "fertilizers": "उर्वरक",
  "pesticides": "कीटनाशक",
  "seeds": "बीज",
  "tools": "उपकरण एवं औज़ार",
  "equipment & tools": "उपकरण एवं औज़ार",
  "growth_promoters": "वृद्धि वर्धक",
  "growth promoters": "वृद्धि वर्धक",
  "other": "अन्य",

  /* Units */
  "kilograms": "किलोग्राम",
  "grams": "ग्राम",
  "metric ton": "मीट्रिक टन",
  "liters": "लीटर",
  "milliliters": "मिलीलीटर",
  "pieces": "नग",
  "packets": "पैकेट",

  /* Packaging */
  "hdpe bag": "एचडीपीई बैग",
  "jute bag": "जूट बैग",
  "bottle": "बोतल",
  "drum": "ड्रम",
  "carton box": "कार्टन बॉक्स",
  "carton": "कार्टन",
  "pouch": "पाउच",
  "sachet": "सैशे",
  "tin/can": "टिन/कैन",
  "bulk container": "बल्क कंटेनर",
  "sack": "बोरी",

  /* Storage conditions (stored slug AND the label the form shows) */
  "cool_dry": "ठंडी और सूखी जगह",
  "cool & dry place": "ठंडी और सूखी जगह",
  "refrigerated": "प्रशीतित (2-8°C)",
  "refrigerated (2-8°c)": "प्रशीतित (2-8°C)",
  "frozen": "जमा हुआ (0°C से नीचे)",
  "frozen (below 0°c)": "जमा हुआ (0°C से नीचे)",
  "room_temp": "सामान्य तापमान",
  "room temperature": "सामान्य तापमान",
  "ventilated": "हवादार जगह",
  "well ventilated area": "हवादार जगह",
  "hazmat": "खतरनाक सामग्री भंडारण",
  "hazardous material storage": "खतरनाक सामग्री भंडारण",

  /* Variant attribute names */
  "color": "रंग",
  "colour": "रंग",
  "size": "आकार",
  "weight": "वज़न",
  "volume": "मात्रा",
  "grade": "श्रेणी",
  "variety": "किस्म",
  "material": "सामग्री",
  "type": "प्रकार",
  "pack size": "पैक साइज़",

  /* Common variant values */
  "red": "लाल",
  "green": "हरा",
  "blue": "नीला",
  "yellow": "पीला",
  "black": "काला",
  "white": "सफ़ेद",
  "orange": "नारंगी",
  "brown": "भूरा",
  "small": "छोटा",
  "medium": "मध्यम",
  "large": "बड़ा",
  "regular": "सामान्य",
  "premium": "प्रीमियम",
  "standard": "मानक",
  "hybrid": "हाइब्रिड",
  "organic": "जैविक",
  "natural": "प्राकृतिक",

  /* Origin */
  "india": "भारत",
};

/**
 * SEARCH-ONLY ALIASES.
 *
 * Extra rows whose `text` is another way a shopper might TYPE the same thing.
 * They exist so `expandSearch` can map the query back to English; they are not
 * used for display, because the display row above already holds the canonical
 * Hindi.
 *
 * Roman spellings matter more than they look: switching a phone keyboard to
 * Devanagari is friction, so plenty of Hindi speakers type "beej", not "बीज".
 */
const SEARCH_ALIASES = {
  "seeds": ["beej", "bij", "बीज"],
  "fertilizers": ["khaad", "khad", "urvarak", "खाद", "उर्वरक"],
  "pesticides": ["keetnashak", "kitnashak", "dawa", "दवा", "कीटनाशक"],
  "tools": ["aujar", "auzar", "औज़ार", "औजार"],
  "growth_promoters": ["growth promoter", "वृद्धि वर्धक"],
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);

  const ops = [];

  for (const [source, text] of Object.entries(HI)) {
    ops.push({
      updateOne: {
        filter: { key: hashSource(source), lang: "hi" },
        update: { $set: { sourceText: source, text, source: "human" } },
        upsert: true,
      },
    });
  }

  /* Alias rows share the SOURCE text but carry a different `text`, so the
     unique (key, lang) index would collide. They go in under a synthetic key
     — `alias:<n>:<source>` — which the display path never looks up but
     expandSearch's text regex still finds. */
  for (const [source, aliases] of Object.entries(SEARCH_ALIASES)) {
    aliases.forEach((alias, i) => {
      ops.push({
        updateOne: {
          filter: { key: hashSource(`alias:${i}:${source}`), lang: "hi" },
          update: { $set: { sourceText: source, text: alias, source: "human" } },
          upsert: true,
        },
      });
    });
  }

  const res = await Translation.bulkWrite(ops, { ordered: false });
  console.log(
    `Seeded ${ops.length} rows — ${res.upsertedCount} new, ${res.modifiedCount} updated.`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});