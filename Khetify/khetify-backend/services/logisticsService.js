const path = require("path");
const axios = require("axios");

/**
 * Apni khud ki config file padhta hai — Khetify ki `.env` NAHI.
 *
 * `.env` ek maujooda file hai, aur ye poora integration is shart pe bana hai ki
 * Khetify ka kuch bhi maujooda na chhede. Isliye settings `.env.logistics` me
 * rehti hain, jo ek nayi file hai.
 *
 * `override: false` isliye ki agar kabhi koi ye variables asli `.env` me daal
 * de, to wahi chalein — ye file unko dabaye nahi.
 */
require("dotenv").config({
  path: path.resolve(process.cwd(), ".env.logistics"),
  override: false,
});

const Warehouse = require("../model/Warehouse/Warehouse");
const User = require("../model/User/User");
const Package = require("../model/Outbound/Package");

/**
 * KHETIFY → LOGISTICS
 *
 * Warehouse manager ke order approve karte hi uska parcel Khetify Logistics me
 * chala jaata hai, jahan se apna delivery agent usko customer tak pahunchata
 * hai.
 *
 * Logistics ek ALAG service hai, alag database ke saath. Usse baat sirf HTTP se
 * hoti hai — uske model yahan import karne ki koshish mat karna, wo collections
 * is process me hain hi nahi.
 *
 * ── COORDINATES KAHIN NAHI HAIN ─────────────────────────────────────────
 *
 * Logistics PINCODE se tay karta hai ki delivery ho sakti hai ya nahi. Isliye
 * yahan kahin latitude-longitude nahi bheja jaata, aur na hi chahiye.
 *
 * Ye jaanbujh kar hai: Khetify (aur koi bhi e-commerce) customer se address aur
 * pincode leti hai, coordinates nahi. Delivery system ko usi data se kaam
 * chalana chahiye jo business asli me collect karta hai.
 */

const BASE_URL = process.env.LOGISTICS_URL || "";
const API_KEY = process.env.LOGISTICS_API_KEY || "";
const TIMEOUT_MS = Number(process.env.LOGISTICS_TIMEOUT_MS || 10000);

const isConfigured = () => Boolean(BASE_URL && API_KEY);

/**
 * Warehouse ko pickup address me badalta hai.
 *
 * Yahan coordinates ki zaroorat nahi — branch kaunsi hogi ye DROP pincode se
 * tay hota hai, pickup se nahi. Bas agent ko ye pata hona chahiye ki jaana
 * kahan hai.
 *
 * Phone number Warehouse pe hota hi nahi, isliye seller ka number bhejte hain.
 * Agent ko kisi se to baat karni hai jab wo warehouse pahunche.
 */
/**
 * Is warehouse ka manager kaun hai.
 *
 * Agent ko warehouse pahunch ke kisi se baat karni hoti hai — aur wo "koi"
 * warehouse manager hai, seller nahi. Seller ka number dukaan ka hota hai;
 * wahan se koi godown ka darwaza nahi kholta.
 *
 * Khetify me manager `User.warehouseIds` se juda hota hai. Ek warehouse ke kai
 * manager ho sakte hain — pehla le lete hain, kyunki agent ko ek number
 * chahiye, list nahi.
 *
 * Na mile to null — caller seller ke number pe gir jaata hai, jo kuch na hone
 * se behtar hai.
 */
async function findWarehouseManager(warehouseId) {
  const u = await User.findOne({
    warehouseIds: warehouseId,
    role: { $in: ["warehouse_manager", "operations_manager"] },
    isActive: { $ne: false },
  })
    .select("name phone")
    .lean();

  if (!u) return null;
  return { name: u.name, phone: u.phone || null };
}

/**
 * Warehouse ko pickup address me badalta hai.
 *
 * ── YAHAN WAREHOUSE KA NAAM AATA HAI, SELLER KA NAHI ────────────────────
 *
 * Saman WAREHOUSE se uthta hai, seller ki dukaan se nahi. Ek seller ke kai
 * warehouse ho sakte hain — agent ko ye pata hona chahiye ki kaunse godown
 * jaana hai, aur uske liye seller ka naam kaafi nahi hai.
 *
 * Phone bhi warehouse MANAGER ka jaata hai, seller ka nahi. Agent jab wahan
 * khada hoga, use wahi banda chahiye jo darwaza khol sake.
 *
 * Coordinates ki zaroorat nahi — branch kaunsi hogi ye DROP pincode se tay
 * hota hai, pickup se nahi.
 */
async function buildPickup(warehouseId, seller) {
  const wh = await Warehouse.findById(warehouseId).lean();
  if (!wh) throw new Error(`Warehouse ${warehouseId} not found`);

  const a = wh.address || {};
  const manager = await findWarehouseManager(warehouseId).catch(() => null);

  return {
    // Warehouse ka naam pehle. Seller ka naam alag field me jaata hai
    // (khetifyOwnerName), taaki dono dikh sakein aur ek doosre ko dabaye
    // nahi.
    name: wh.name || "Warehouse",
    contactName: manager?.name || null,
    phone: manager?.phone || seller?.phone || "0000000000",
    line1: a.line1 || wh.name || "Warehouse",
    city: a.city,
    district: a.district,
    state: a.state,
    pincode: a.pincode,
  };
}

/**
 * Order ke shippingAddress ko drop address me badalta hai.
 *
 * `pincode` wo EK cheez hai jispe sab kuch tika hai — usse hi logistics tay
 * karta hai ki kaunsi branch serve karegi aur bhada kitna. Uske bina shipment
 * banta hi nahi.
 */
function buildDrop(order) {
  const a = order.shippingAddress || {};

  return {
    name: a.name || a.fullName || order.customerName || "Customer",
    phone: a.phone || "0000000000",
    line1: a.line1 || "Address not provided",
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    district: a.district,
    state: a.state,
    pincode: a.pincode,
  };
}

/**
 * Order ke item ko parcel ki jaankari me badalta hai.
 *
 * `description` agent ke liye hai — wo haath me pakde saman se milane ke liye
 * ise padhta hai. Isliye chhota aur asli bhasha me hai, na ki product id ki
 * list.
 *
 * `perishable` abhi hamesha false hai. Sahi tarika ye hota ki Product pe ek flag
 * ho, lekin wo Khetify me abhi hai nahi — aur naam se andaza lagana bhrosemand
 * nahi hai. Ye baat yahan likhi honi chahiye taaki koi ise sach na samjhe: abhi
 * HAR parcel ko 24 ghante ka waada milta hai, sabzi ko bhi.
 */
function buildParcel(items) {
  const names = items.map((i) => `${i.qty || 1}x ${i.name || "item"}`).filter(Boolean);

  return {
    description:
      names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4} more` : ""),
    itemCount: items.reduce((sum, i) => sum + (i.qty || 0), 0),
    weightKg: items.reduce((sum, i) => sum + (i.weightKg || 0) * (i.qty || 1), 0),
    perishable: false,
  };
}

/**
 * Order ke items ko warehouse ke hisab se baantta hai.
 *
 * Ek order kai warehouse me bant sakta hai — Khetify khud `items[]
 * .sourceWarehouseId` alag-alag set karta hai. Delivery bhi waise hi bantni
 * chahiye: alag warehouse matlab alag jagah se uthna, matlab alag parcel.
 *
 * Ek hi parcel bana dena galat hoga — agent ek pate pe jaata aur aadha saman
 * kisi doosre warehouse me pada rehta.
 */
function groupByWarehouse(order) {
  const groups = new Map();

  for (const item of order.items || []) {
    const whId = String(item.sourceWarehouseId || order.sourceWarehouseId || "");
    if (!whId) continue;
    if (!groups.has(whId)) groups.set(whId, []);
    groups.get(whId).push(item);
  }

  return groups;
}

/**
 * Ek parcel logistics ko bhejta hai.
 *
 * `Idempotency-Key` me order AUR warehouse dono hain. Sirf order hota to split
 * order ka doosra parcel "duplicate" samajh ke chup-chaap chhoot jaata — aur
 * aadha saman kabhi deliver hi na hota.
 *
 * Isi key ki wajah se ye call dobara chalana surakshit hai: logistics purana hi
 * parcel wapas lauta deta hai, naya nahi banata.
 */
async function pushShipment({ order, warehouseId, items, seller, readyForPickup }) {
  if (!isConfigured()) {
    throw new Error("LOGISTICS_URL or LOGISTICS_API_KEY is missing from .env.logistics");
  }

  const drop = buildDrop(order);

  // Pincode ke bina logistics kuch nahi kar sakta, aur wo galti yahin pakadni
  // chahiye — network round trip se pehle. Iska hal Khetify me hai, logistics
  // me nahi, isliye message bhi wahi batata hai.
  if (!drop.pincode) {
    throw new Error(
      `Order ${order.orderNumber || order._id} has no pincode in its shipping address`
    );
  }

  const body = {
    khetifyOrderId: String(order._id),
    khetifyOrderNumber: order.orderNumber,
    khetifyOwnerType: order.ownerType,
    khetifyOwnerId: String(order.ownerId),
    khetifyOwnerName: seller?.name,
    khetifyWarehouseId: String(warehouseId),
    pickup: await buildPickup(warehouseId, seller),
    drop,
    parcel: buildParcel(items),
    payment:
      order.payment?.mode === "cod"
        ? { mode: "cod", codAmount: order.totalAmount }
        : { mode: "prepaid" },

    /**
     * Parcel warehouse manager ke approve hote hi bhejte hain, pack hone se
     * PEHLE.
     *
     * Us waqt saman abhi bandh raha hota hai, isliye logistics ko saaf batana
     * zaroori hai. Wo shipment bana leta hai (dispatcher plan kar sake, agent
     * laga sake) lekin agent ko uthane nahi deta jab tak `ready` ki call na
     * aaye.
     */
    readyForPickup: Boolean(readyForPickup),
  };

  const { data } = await axios.post(`${BASE_URL}/api/internal/shipments`, body, {
    timeout: TIMEOUT_MS,
    headers: {
      "x-api-key": API_KEY,
      "Idempotency-Key": `order-${order._id}-wh-${warehouseId}`,
    },
  });

  return data.data; // { awb, status, freightAmount, promisedBy }
}

/**
 * Is order ke box label — Khetify ke `Package` rows se.
 *
 * Khetify pack karte waqt har carton ko ek `PKG-...` number deta hai, jo uska
 * barcode bhi hai. Logistics ke paas customer ka pata aur warehouse sab pehle
 * se hai — sirf ye number aur har dabbe ka saman nahi hai.
 *
 * `items` me sirf productId hota hai, naam nahi. Naam ORDER ke items se milaate
 * hain — wahi naam customer ne dekha tha, aur wahi label pe hona chahiye. Ek
 * alag Product lookup se aisa naam aa sakta hai jo customer ne kabhi dekha hi
 * nahi (product baad me rename ho gaya ho).
 */
async function buildLabels(order, warehouseId) {
  const packages = await Package.find({ orderId: order._id })
    .select("packageNumber items weightKg dims createdAt")
    .sort({ createdAt: 1 })
    .lean();

  if (!packages.length) return [];

  // productId → naam, order ke apne items se
  const nameById = new Map(
    (order.items || [])
      .filter((i) => i.productId)
      .map((i) => [String(i.productId), i.name || "item"])
  );

  return packages.map((p, idx) => ({
    packageNumber: p.packageNumber,
    boxNumber: idx + 1,
    boxCount: packages.length,
    weightKg: p.weightKg ?? null,
    dims: p.dims || null,
    items: (p.items || []).map((it) => ({
      name: nameById.get(String(it.productId)) || "item",
      qty: it.qty || 1,
    })),
  }));
}

/**
 * Logistics ko batata hai ki warehouse ne order pack kar diya — ab utha ja
 * sakta hai.
 *
 * Ye alag call isliye hai ki ye shipment ka status badalti hi nahi. Shipment
 * `created` ya `assigned` pe hi rehta hai; bas agent ke liye ek rok hat jaati
 * hai.
 *
 * Dobara bhejna surakshit hai — logistics pehle se taiyaar shipment pe chupchap
 * kuch nahi karta.
 */
async function markReady(awb, orderId, labels = []) {
  if (!isConfigured()) throw new Error("Logistics is not configured");

  const { data } = await axios.post(
    `${BASE_URL}/api/internal/shipments/${awb}/ready`,
    {
      /**
       * Order ki id bhejna ZAROORI hai. Logistics milata hai ki ye AWB sach me
       * usi order ka hai. Iske bina purani sync row kisi aur ke parcel ka pickup
       * khol deti hai — aur wo galti chupchap hoti hai.
       */
      khetifyOrderId: String(orderId),

      /**
       * Box ke label isi call ke saath jaate hain — packing ka wahi lamha hai
       * jab wo bante hain. Alag call ka koi fayda nahi.
       */
      labels,
    },
    { timeout: TIMEOUT_MS, headers: { "x-api-key": API_KEY } }
  );

  return data.data;
}

/**
 * Kai AWB ka status ek saath.
 *
 * Ek-ek karke poochne se 30 parcel = 30 request har chakkar me. Wo network aur
 * database dono pe bekaar ka bojh hai, aur delivery me itni jaldi kabhi nahi
 * hoti ki ye kharcha wajib ho.
 */
async function fetchStatuses(awbs) {
  if (!isConfigured()) throw new Error("Logistics is not configured");
  if (!awbs.length) return [];

  const { data } = await axios.post(
    `${BASE_URL}/api/internal/shipments/statuses`,
    { awbs },
    { timeout: TIMEOUT_MS, headers: { "x-api-key": API_KEY } }
  );

  return data.data || [];
}

/**
 * Ek AWB ka asli haal logistics se — kiska hai, aur taiyaar hai ya nahi.
 *
 * Pehle ye sirf `khetifyOrderId` lautata tha, jabki jawab me poora shipment
 * aata hai. `readyForPickup` wahin pada tha aur istemal nahi ho raha tha —
 * isliye "ready ki khabar kho gayi" wali halat kisi ko dikhti hi nahi thi.
 *
 * Ab dono lautate hain. Isse ek bhi extra request nahi lagti.
 *
 * @returns {Promise<{orderId: string|null, readyForPickup: boolean}|null>}
 *          null matlab wo shipment ab hai hi nahi
 */
async function inspectAwb(awb) {
  if (!isConfigured()) throw new Error("Logistics is not configured");

  try {
    const { data } = await axios.get(`${BASE_URL}/api/internal/shipments/${awb}`, {
      timeout: TIMEOUT_MS,
      headers: { "x-api-key": API_KEY },
    });

    const sh = data.data?.shipment;
    if (!sh) return null;

    return {
      orderId: String(sh.khetifyOrderId || "") || null,
      // Purane logistics me ye field hai hi nahi — us halat me "taiyaar" maan
      // lete hain, warna agent ka button bina wajah band pada rehta.
      readyForPickup: sh.readyForPickup !== false,
      /**
       * Label pahunche ya nahi.
       *
       * Ye YAHIN se aana zaroori hai. Pehle caller `live.hasLabels` poochta
       * tha jabki ye function wo lautata hi nahi tha — `undefined === false`
       * kabhi sach nahi hota, isliye chhoote hue label kabhi dobara nahi
       * bheje jaate the. Aur wo galti chupchap thi.
       */
      hasLabels: Array.isArray(sh.labels) && sh.labels.length > 0,
      status: sh.status || null,
    };
  } catch (err) {
    // 404 matlab wo shipment ab hai hi nahi (reset ho gaya). Ye galti nahi,
    // ek jawab hai — caller isko sambhal leta hai.
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Checkout pe: is pincode pe delivery hoti hai ya nahi.
 *
 * Abhi ye kahin se bulaya nahi jaata. Jab Khetify ke checkout me ise lagana ho,
 * tab ye taiyaar milega — aur wo `shopOrderService.js` badalna hoga, isliye wo
 * kaam alag se, poochh kar hoga.
 */
async function checkPincode(pincode) {
  if (!isConfigured()) throw new Error("Logistics is not configured");

  const { data } = await axios.get(`${BASE_URL}/api/serviceability`, {
    params: { pincode },
    timeout: TIMEOUT_MS,
    headers: { "x-api-key": API_KEY },
  });

  return data.data;
}

module.exports = { pushShipment, markReady, buildLabels, fetchStatuses, inspectAwb, checkPincode, groupByWarehouse, isConfigured, BASE_URL };