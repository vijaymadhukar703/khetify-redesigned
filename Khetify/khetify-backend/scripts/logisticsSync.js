require("dotenv").config();

const mongoose = require("mongoose");

const Order = require("../model/Order/Order");
const Seller = require("../model/Seller/Seller");
const LogisticsSync = require("../model/Logistics/LogisticsSync");
const logistics = require("../services/logisticsService");

/**
 * KHETIFY → LOGISTICS SYNC
 *
 * Warehouse manager ke approve kiye hue order utha kar Khetify Logistics me
 * bhejta hai.
 *
 * ── YE ALAG PROCESS KYUN HAI ────────────────────────────────────────────
 *
 * Seedha tarika ye hota ki jahan order approve hota hai wahin ek line jod dein.
 * Wo turant chalta, poll na karna padta, aur code chhota rehta.
 *
 * Lekin uske liye `sellerOrderController.js` chhedni padti. Ye poora
 * integration is shart pe bana hai ki Khetify ki koi bhi MAUJOODA file na
 * chhedni pade — isliye ye ek alag process hai jo apne aap chalti hai.
 *
 * Do anjaane fayde bhi hain:
 *
 *   - Ye crash ho jaye to Khetify ko pata bhi nahi chalta. Order approve hote
 *     rehte hain; ye chalu hote hi pichhla sab kaam nipta leti hai.
 *   - Isko band karke, theek karke, dobara chalu kiya ja sakta hai bina Khetify
 *     ko restart kiye.
 *
 * Keemat: turant nahi hota, kuch second lagte hain. Delivery ke liye ye maayne
 * nahi rakhta — parcel ko waise bhi kisi insaan ne uthana hai.
 *
 * ── CHALANE KA TAREEKA ──────────────────────────────────────────────────
 *
 *   node scripts/logisticsSync.js                  hamesha chalta rahega
 *   node scripts/logisticsSync.js --once           ek baar chal ke band
 *   node scripts/logisticsSync.js --retry-failed   atki hui rows dobara qatar me
 */

// ── Settings ────────────────────────────────────────────────────────────

const INTERVAL_MS = Number(process.env.LOGISTICS_SYNC_INTERVAL_MS || 20000);
const BATCH_SIZE = Number(process.env.LOGISTICS_SYNC_BATCH || 50);

/**
 * Kitne din purane order tak dekhna.
 *
 * Iske bina query har baar poore itihaas pe chalti, aur pehli baar chalane pe
 * mahino purane order bhi chale jaate — jo kabhi ke deliver ho chuke hain.
 */
const LOOKBACK_DAYS = Number(process.env.LOGISTICS_SYNC_LOOKBACK_DAYS || 7);

/**
 * Kitni baar koshish karni, phir ruk jao.
 *
 * Kuch galtiyaan hamesha wahi jawab dengi — jaise "is pincode pe delivery nahi
 * hoti". Unko har 20 second dohrana logs bhar deta hai jisme asli problem chhup
 * jaati hai. `--retry-failed` se unko dobara qatar me daala ja sakta hai.
 */
const MAX_ATTEMPTS = Number(process.env.LOGISTICS_SYNC_MAX_ATTEMPTS || 6);

/**
 * Kaunse status pe parcel bhejna hai.
 *
 * "confirmed" se shuru — Khetify me yahi WAREHOUSE MANAGER KA APPROVAL hai
 * (`pending → confirmed : warehouse manager approves`). Us waqt saman abhi
 * bandh raha hota hai, lekin dispatcher ko kaam pehle se dikh jaata hai aur wo
 * agent laga kar din ka plan bana leta hai.
 *
 * Agent us waqt saman utha nahi sakta. Parcel `readyForPickup: false` ke saath
 * jaata hai, aur jab warehouse order `packed` karta hai tab ek alag call rok
 * hata deti hai (neeche `sendReadyIfPacked`).
 *
 * "packed" aur "shipped" bhi list me hain taaki sync kuch der band rahi ho aur
 * us beech order aage badh gaya ho, to wo chhoot na jaye.
 */
const SYNC_STATUSES = (process.env.LOGISTICS_SYNC_STATUSES || "confirmed,packed,shipped")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * In status pe maana jaata hai ki warehouse ne saman bandh diya.
 *
 * `packed` seedha hai. `shipped` isliye ki wo `packed` ke aage hai — us tak
 * pahunchne ka matlab hi hai ki pack ho chuka.
 */
const PACKED_STATUSES = (process.env.LOGISTICS_READY_STATUSES || "packed,shipped")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── Helpers ─────────────────────────────────────────────────────────────

const log = (...args) => console.log(new Date().toISOString(), ...args);

/** Fail hone par: 2min, 4, 8, 16, 32 — 60 min pe rukta hai. */
const backoffMs = (attempts) => Math.min(2 ** attempts, 60) * 60 * 1000;

const sellerCache = new Map();

async function getSeller(sellerId) {
  const key = String(sellerId);
  if (sellerCache.has(key)) return sellerCache.get(key);

  const s = await Seller.findById(sellerId)
    .select("name phone sellerInfo.businessName contact.officialPhone")
    .lean();

  const seller = {
    name: s?.sellerInfo?.businessName || s?.name || "Seller",
    // Official number pehle — wo aam taur pe dukaan ka hota hai, aur agent ko
    // wahi chahiye jab wo warehouse pe khada ho.
    phone: s?.contact?.officialPhone || s?.phone || null,
  };

  sellerCache.set(key, seller);
  return seller;
}

// ── Ek parcel ──────────────────────────────────────────────────────────

/**
 * Ek (order + warehouse) ko logistics me bhejta hai.
 *
 * Row PEHLE banti hai, bhejne se pehle. Ye order maayne rakhta hai: agar row
 * baad me banti aur beech me process gir jaata, to parcel logistics me chala
 * jaata aur Khetify ko kabhi pata na chalta.
 *
 * Wo dobara-bhejna waise bhi surakshit hai (idempotency key ki wajah se), lekin
 * uspe bharosa karne se behtar hai ki nishaan pehle chhod diya jaaye.
 */
async function syncOne(order, warehouseId, items) {
  const filter = { orderId: order._id, warehouseId };

  let row = await LogisticsSync.findOne(filter);

  if (row?.status === "synced") return { skipped: true };
  if (row?.status === "failed" && row.attempts >= MAX_ATTEMPTS) return { skipped: true };
  if (row?.nextAttemptAt && row.nextAttemptAt > new Date()) return { skipped: true };

  if (!row) {
    try {
      row = await LogisticsSync.create({
        orderId: order._id,
        orderNumber: order.orderNumber,
        warehouseId,
        pincode: order.shippingAddress?.pincode,
        status: "pending",
      });
    } catch (err) {
      // Unique index ne pakda — koi doosri copy isi parcel pe kaam kar rahi
      // hai. Chhod dete hain; wahi isko nipta degi.
      if (err.code === 11000) return { skipped: true };
      throw err;
    }
  }

  const packed = PACKED_STATUSES.includes(order.status);

  try {
    const seller = await getSeller(order.ownerId);
    const result = await logistics.pushShipment({
      order, warehouseId, items, seller,
      // Approve pe bhej rahe hain to saman abhi bandh nahi hua.
      readyForPickup: packed,
    });

    row.status = "synced";
    row.awb = result.awb;
    row.readySent = packed;
    row.lastError = null;
    row.syncedAt = new Date();
    await row.save();

    return { synced: true, awb: result.awb, ready: packed };
  } catch (err) {
    // Logistics apni galti ka matlab body me bhejta hai; axios usko
    // `err.response.data` me rakhta hai. Wahi message kaam ka hota hai —
    // "Request failed with status code 422" se koi kuch nahi samajh paata.
    const message = err.response?.data?.message || err.message;

    row.attempts += 1;
    row.status = row.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    row.lastError = message;
    row.nextAttemptAt = new Date(Date.now() + backoffMs(row.attempts));
    await row.save();

    return { failed: true, error: message, attempts: row.attempts };
  }
}

/**
 * Pehle se bheje gaye parcel pe "warehouse ne pack kar diya" ki khabar bhejta
 * hai.
 *
 * Ye tab chalta hai jab parcel `confirmed` pe ja chuka tha, aur ab order
 * `packed` ho gaya. Ek alag call jaati hai jo logistics me agent ki rok hata
 * deti hai.
 *
 * Parcel uthaye jaane ke BAAD ye chalna band ho jaata hai — neeche
 * `alreadyMoved` dekho.
 */
async function sendReadyIfPacked(order, row) {
  if (!row.awb) return { skipped: true };
  if (!PACKED_STATUSES.includes(order.status)) return { skipped: true };

  /**
   * `readySent` pe BHAROSA NAHI karte — logistics se poochte hain.
   *
   * Pehle yahan `if (row.readySent) return` tha. Uska matlab: agar `ready` ki
   * call kabhi kho gayi — network toota, sync beech me gira, jawab aane se
   * pehle process band ho gayi — to row pe `readySent: true` likha rah jaata
   * aur use koi DOBARA nahi bhejta. Agent ka button hamesha ke liye band pada
   * rehta, bina kisi error ke.
   *
   * Ab ek hi call se dono pata chal jaate hain: AWB kiska hai, aur wo taiyaar
   * hai ya nahi. Wo call waise bhi ja rahi thi (AWB ka milaan karne ke liye) —
   * ek bhi extra request nahi lagti.
   */
  let live;
  try {
    live = await logistics.inspectAwb(row.awb);
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    row.lastError = `verify: ${message}`;
    await row.save();
    return { failed: true, error: message };
  }

  /**
   * AWB ab kisi aur ka nikla, ya hai hi nahi.
   *
   * Logistics reset hone ke baad wahi number dobara issue ho sakta hai. Uspe
   * "packed" bhej dene se KISI AUR ka parcel taiyaar mark ho jaata hai — aur wo
   * galti chupchap hoti hai.
   */
  if (!live || (live.orderId && live.orderId !== String(order._id))) {
    row.awb = null;
    row.status = "pending";
    row.readySent = false;
    row.attempts = 0;
    row.nextAttemptAt = new Date();
    row.lastError = live
      ? "AWB belonged to a different order (logistics data was probably reset) — raising a fresh parcel"
      : "AWB no longer exists in logistics (data was probably reset) — raising a fresh parcel";
    await row.save();
    return { stale: true, error: row.lastError };
  }

  /**
   * Pehle se taiyaar hai — lekin label pahunche ya nahi, wo alag sawaal hai.
   *
   * Aisa hota hai jab parcel pack hone ke BAAD bana ho (order pehle se packed
   * tha), ya jab pehli ready call ke waqt Package rows abhi bane na hon. Us
   * halat me manager ke paas print karne ko kuch nahi bachta — aur wo galti
   * chupchap hoti hai.
   */
  if (live.readyForPickup) {
    if (!row.readySent) {
      row.readySent = true;
      await row.save();
    }

    if (live.hasLabels === false) {
      const labels = await logistics.buildLabels(order, row.warehouseId).catch(() => []);
      if (labels.length) {
        await logistics.markReady(row.awb, order._id, labels).catch(() => {});
        row.labelCount = labels.length;
        await row.save();
        return { labelled: true, awb: row.awb, labels: labels.length };
      }
    }

    return { skipped: true };
  }

  try {
    // Label packing ke waqt bante hain — isi call ke saath bhej dete hain.
    const labels = await logistics.buildLabels(order, row.warehouseId).catch(() => []);

    await logistics.markReady(row.awb, order._id, labels);
    row.readySent = true;
    row.labelCount = labels.length;
    row.lastError = null;
    await row.save();
    return { ready: true, awb: row.awb, labels: labels.length };
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    row.lastError = `ready: ${message}`;
    await row.save();
    return { failed: true, error: message };
  }
}

// ── Status wapas Khetify me ────────────────────────────────────────────

/**
 * Logistics ke status ko Khetify ke status me badalta hai.
 *
 * Teen cheezein Khetify ka status badalti hain:
 *
 *   picked_up        → "shipped"          (saman warehouse se nikal gaya)
 *   out_for_delivery → "out_for_delivery" (agent customer ke raaste me hai)
 *   delivered        → "delivered"        (pahunch gaya)
 *
 * `failed` jaanbujh kar KUCH NAHI badalta. Wo aakhri haal nahi hai — agent kal
 * dobara jaayega. Us par order ko peeche le jaana ya "returned" karna customer
 * ko galat khabar dega.
 */
function mapToOrderStatus(deliveryStatus) {
  if (deliveryStatus === "delivered") return "delivered";
  if (deliveryStatus === "out_for_delivery") return "out_for_delivery";
  if (deliveryStatus === "picked_up") return "shipped";
  return null;
}

/**
 * Chal rahe parcel ka haal logistics se laata hai, aur customer ke order pe
 * lagata hai.
 *
 * ── EK ORDER, KAI PARCEL ────────────────────────────────────────────────
 *
 * Order ka status EK field hai, lekin parcel kai ho sakte hain (alag warehouse
 * se). Isliye:
 *
 *   koi ek parcel nikla       → order "shipped"
 *   SAARE parcel pahunch gaye → order "delivered"
 *
 * Ye dusri shart zaroori hai. Pehla parcel pahunchte hi "delivered" likh dena
 * customer se jhoot bolna hai — uska aadha saman abhi raaste me hai.
 */
async function pullStatuses() {
  // Sirf wo rows jinka parcel ban chuka hai aur abhi manzil tak nahi pahuncha.
  const open = await LogisticsSync.find({
    status: "synced",
    awb: { $ne: null },
    deliveryStatus: { $nin: ["delivered", "cancelled", "returned"] },
  })
    .limit(200)
    .lean();

  if (!open.length) return { checked: 0, moved: 0 };

  const rows = await logistics.fetchStatuses(open.map((r) => r.awb));
  const byAwb = new Map(rows.map((r) => [r.awb, r]));

  // ── 1. Har parcel ka naya haal likho ──────────────────────────────────
  const touchedOrders = new Set();

  for (const row of open) {
    const live = byAwb.get(row.awb);
    if (!live) continue;

    /**
     * Wahi milaan jo `sendReadyIfPacked` me hai: AWB asli me ISI order ka hai?
     *
     * Logistics reset hone ke baad wahi number kisi aur ko mil sakta hai, aur
     * uska status utha lene se customer ko KISI AUR ke parcel ka haal dikhne
     * lagta. Wo galti chupchap hoti hai.
     */
    if (live.khetifyOrderId && live.khetifyOrderId !== String(row.orderId)) continue;

    if (live.status !== row.deliveryStatus) {
      await LogisticsSync.updateOne(
        { _id: row._id },
        { $set: { deliveryStatus: live.status, deliveryUpdatedAt: new Date() } }
      );
    }

    /**
     * Yahan ready ki dobara-koshish JAANBUJH KAR nahi hai.
     *
     * Wo kaam `sendReadyIfPacked` karta hai, jo upar wale loop me har chakkar
     * chalta hai aur logistics se seedha poochta hai. Do jagah wahi koshish
     * rakhne se ek hi parcel pe do call jaati, aur kal koi ek jagah badal deta
     * to dono ka vyavhaar chupchap alag ho jaata.
     */

    touchedOrders.add(String(row.orderId));
  }

  // ── 2. Har chhue gaye order ka status dobara nikalo ───────────────────
  let moved = 0;

  for (const orderId of touchedOrders) {
    const parcels = await LogisticsSync.find({ orderId, status: "synced" })
      .select("deliveryStatus")
      .lean();

    if (!parcels.length) continue;

    const states = parcels.map((p) => p.deliveryStatus).filter(Boolean);
    if (!states.length) continue;

    const allDelivered = states.length === parcels.length &&
                         states.every((st) => st === "delivered");

    /**
     * SABSE PEECHE wala parcel order ka status tay karta hai.
     *
     * Ek parcel out-for-delivery ho aur doosra abhi godown me — to order
     * "shipped" hai, "out for delivery" nahi. Customer ko wahi batana chahiye
     * jo uske POORE order ka sach hai, na ki uske sabse tez dabbe ka.
     */
    const RANK = { shipped: 1, out_for_delivery: 2, delivered: 3 };
    const mapped = states.map(mapToOrderStatus).filter(Boolean);

    let target = null;
    if (allDelivered) {
      target = "delivered";
    } else if (mapped.length) {
      // Sabse kam rank wala — yaani jo sabse peeche hai.
      target = mapped.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
      // Koi delivered ho gaya lekin sab nahi — order abhi bhi raaste me hai.
      if (target === "delivered") target = "out_for_delivery";
    }

    if (!target) continue;

    /**
     * `updateOne` se badalte hain, load-karke-save se NAHI.
     *
     * Pehle yahan `Order.findById(id).select("status orderNumber")` tha, phir
     * `order.save()`. Wo chupchap fail hota tha: Order ka `pre("validate")`
     * hook `ownerType` aur `ownerId` maangta hai, aur `.select()` ne wo load
     * hi nahi kiye the. Har save "An order must have an owner" phenk deta,
     * status kabhi badalta hi nahi, aur customer ko purana haal dikhta rehta.
     *
     * `updateOne` na hook chalata hai, na poora document maangta hai.
     *
     * Aur ye ek hi cheez do kaam karti hai: `status: { $in: allowedFrom }`
     * filter hi wo rok hai jo status ko PEECHE nahi jaane deti — bina alag se
     * rank check kiye, aur do sync ek saath chalein to bhi surakshit.
     */
    /**
     * Kis status se kis pe ja sakte hain — ye filter hi wo rok hai jo status
     * PEECHE nahi jaane deti.
     */
    const allowedFrom = {
      shipped:          ["confirmed", "packed"],
      out_for_delivery: ["confirmed", "packed", "shipped"],
      delivered:        ["confirmed", "packed", "shipped", "out_for_delivery"],
    }[target];

    /**
     * Time bhi likhte hain, sirf status nahi.
     *
     * Customer ke page pe har kadam ke saamne uska waqt dikhta hai. Pehle
     * "Shipped" ke saamne `dispatchedAt` dikhta tha — wo warehouse ke dabba
     * bandh karne ka waqt hai, agent ke uthane ka nahi. Do-teen ghante ka
     * farak aa jaata tha, aur customer ko galat lagta.
     */
    const stamp = {
      shipped: { shippedAt: new Date() },
      out_for_delivery: { outForDeliveryAt: new Date() },
      delivered: { deliveredAt: new Date() },
    }[target];

    const res = await Order.updateOne(
      { _id: orderId, status: { $in: allowedFrom } },
      { $set: { status: target, ...stamp } }
    );

    if (!res.modifiedCount) continue;   // pehle se aage tha, ya cancel ho chuka
    moved += 1;

    log(`◆ ${orderId} → ${target}`);
  }

  return { checked: open.length, moved };
}

// ── Ek chakkar ─────────────────────────────────────────────────────────

async function runOnce() {
  sellerCache.clear();

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  /**
   * Sirf seller wale order.
   *
   * Company ke order abhi is delivery system se bahar hain. Wo alag raaste se
   * bante hain aur unka warehouse flow bhi alag hai — unko bina soche shaamil
   * karna aise parcel bana deta jinke baare me kisi ne socha hi nahi.
   */
  const orders = await Order.find({
    ownerType: "seller",
    status: { $in: SYNC_STATUSES },
    updatedAt: { $gte: since },
  })
    .sort({ updatedAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  let synced = 0, failed = 0, pending = 0, readied = 0;

  for (const order of orders) {
    const groups = logistics.groupByWarehouse(order);

    if (!groups.size) {
      /**
       * Koi source warehouse hi nahi.
       *
       * Ek `skipped` row likh dete hain taaki ye order har chakkar me dobara na
       * dikhe — warna log har 20 second wahi line se bhar jaate hain. Wajah bhi
       * row me bach jaati hai.
       */
      await LogisticsSync.updateOne(
        { orderId: order._id, warehouseId: order._id },   // placeholder id
        {
          $setOnInsert: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            warehouseId: order._id,
            pincode: order.shippingAddress?.pincode,
            status: "skipped",
            lastError: "No source warehouse on this order, so no parcel could be raised",
          },
        },
        { upsert: true }
      ).catch(() => {});
      continue;
    }

    for (const [warehouseId, items] of groups) {
      /**
       * Pehle dekho ki ye parcel already ja chuka hai aur ab sirf "pack ho
       * gaya" ki khabar baaki hai. Ye aam raasta hai: parcel approve pe gaya,
       * aur ab warehouse ne pack kiya.
       */
      const existing = await LogisticsSync.findOne({ orderId: order._id, warehouseId });
      if (existing?.status === "synced") {
        const r = await sendReadyIfPacked(order, existing);
        if (r.ready) {
          readied += 1;
          log(
            `✔ ${order.orderNumber || order._id} → ${r.awb} is packed and ready` +
              (r.labels ? `  (${r.labels} label${r.labels === 1 ? "" : "s"})` : "  (no labels yet)")
          );
          continue;
        }
        if (r.labelled) {
          log(`🏷 ${order.orderNumber || order._id} → ${r.awb} got ${r.labels} label(s)`);
          continue;
        }
        if (r.stale) {
          // Purana AWB kisi aur ka nikla. Row saaf ho chuki hai — neeche
          // syncOne isko naya parcel bana dega, isi chakkar me.
          log(`⟳ ${order.orderNumber || order._id}: ${r.error}`);
        } else {
          continue;
        }
      }

      const result = await syncOne(order, warehouseId, items);

      if (result.synced) {
        synced += 1;
        log(
          `→ ${order.orderNumber || order._id} → ${result.awb}` +
            (result.ready ? "  (ready to collect)" : "  (warehouse is still packing)")
        );
      } else if (result.failed) {
        if (result.attempts >= MAX_ATTEMPTS) {
          failed += 1;
          log(`✗ ${order.orderNumber || order._id}: ${result.error}  [giving up]`);
        } else {
          pending += 1;
          log(`… ${order.orderNumber || order._id}: ${result.error}  [attempt ${result.attempts}]`);
        }
      }
    }
  }

  // Bhejne ke baad wapas laao: chal rahe parcel ka haal customer ke order pe
  // lagana hai.
  let tracked = { checked: 0, moved: 0 };
  try {
    tracked = await pullStatuses();
  } catch (err) {
    // Status laane me dikkat se parcel bhejna nahi rukna chahiye — dono alag
    // kaam hain.
    console.error("Status pull failed:", err.response?.data?.message || err.message);
  }

  return { checked: orders.length, synced, failed, pending, readied, moved: tracked.moved };
}

/** `failed` pe ruk gayi rows ko dobara qatar me daalta hai. */
async function retryFailed() {
  const r = await LogisticsSync.updateMany(
    { status: "failed" },
    { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() } }
  );
  log(`Requeued ${r.modifiedCount} failed row(s)`);
}

// ── Chalu karna ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const retry = args.includes("--retry-failed");

  if (!logistics.isConfigured()) {
    console.error(
      "\nLOGISTICS_URL and LOGISTICS_API_KEY are missing.\n" +
        "Create .env.logistics in khetify-backend and put them there.\n"
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  log(`Connected to ${mongoose.connection.name}`);
  log(`Logistics at ${logistics.BASE_URL}`);
  log(`Watching orders with status: ${SYNC_STATUSES.join(", ")}`);
  log(`Treated as packed: ${PACKED_STATUSES.join(", ")}`);

  if (retry) await retryFailed();

  if (once) {
    const r = await runOnce();
    log(
      `Done — ${r.checked} order(s) checked, ${r.synced} sent, ` +
        `${r.readied} marked packed, ${r.moved} order(s) updated, ` +
        `${r.pending} retrying, ${r.failed} gave up`
    );
    await mongoose.disconnect();
    return;
  }

  log(`Polling every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("Stopping...");
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  ["SIGINT", "SIGTERM"].forEach((s) => process.on(s, stop));

  /**
   * setTimeout ka loop, setInterval nahi.
   *
   * setInterval agla chakkar chalu kar deta hai chahe pichhla khatam hua ho ya
   * nahi. Logistics dhima ho jaye to chakkar ek doosre pe chadhne lagte hain
   * aur ek hi parcel do baar bhejne ki koshish hoti hai.
   */
  while (!stopping) {
    try {
      const r = await runOnce();
      if (r.synced || r.failed || r.pending || r.readied || r.moved) {
        log(
          `${r.synced} sent, ${r.readied} marked packed, ${r.moved} order(s) updated, ` +
            `${r.pending} retrying, ${r.failed} gave up`
        );
      }
    } catch (err) {
      console.error("Sync round failed:", err.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});