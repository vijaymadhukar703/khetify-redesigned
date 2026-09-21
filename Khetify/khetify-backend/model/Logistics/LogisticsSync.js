const mongoose = require("mongoose");

/**
 * Kaunsa parcel logistics me ja chuka hai, iska hisaab.
 *
 * ── YE ALAG COLLECTION KYUN HAI ─────────────────────────────────────────
 *
 * Seedha tarika ye hota ki `Order` model pe ek `logistics` field jod dein. Wo
 * padhne me aasan hota aur ek query kam lagti.
 *
 * Lekin uske liye `model/Order/Order.js` badalni padti — aur ye poora
 * integration is shart pe bana hai ki Khetify ki koi bhi MAUJOODA file na
 * chhedni pade. Ek naya collection us shart ko poora karta hai, aur uski keemat
 * sirf ek extra lookup hai.
 *
 * Fayda bhi hai: ye poora integration hatana ho to bas is collection ko drop
 * kar dijiye. Order me kahin kuch pada nahi rahega.
 *
 * ── EK ORDER, KAI ROW ───────────────────────────────────────────────────
 *
 * Ek order kai warehouse me bant sakta hai (`items[].sourceWarehouseId` alag
 * hone par). Har warehouse ka apna parcel banta hai, isliye har (order +
 * warehouse) ki apni row hai.
 */
const logisticsSyncSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },

    status: {
      type: String,
      enum: ["pending", "synced", "failed", "skipped"],
      default: "pending",
    },

    /** Logistics ka tracking number, jaise KHL-KHR-26-000142. */
    awb: { type: String },

    /** Customer ka pincode — dhoondhne aur report ke liye. */
    pincode: { type: String },

    /**
     * Logistics ko bata diya gaya ki order pack ho gaya.
     *
     * Parcel warehouse manager ke APPROVE karte hi bhej diya jaata hai, taaki
     * dispatcher plan kar sake. Us waqt saman abhi bandh raha hota hai, isliye
     * logistics use "abhi taiyaar nahi" maanta hai aur agent utha nahi sakta.
     *
     * Jab order `packed` hota hai, tab ek alag call jaati hai jo rok hata deti
     * hai. Ye flag us call ka hisaab rakhta hai — warna wo har chakkar me
     * dobara jaati rehti.
     */
    readySent: { type: Boolean, default: false },

    /**
     * Logistics me is parcel ka aakhri haal — created / assigned / picked_up /
     * out_for_delivery / delivered / failed.
     *
     * Ye yahan isliye rakha hai ki customer ko dikhne wala order status isi se
     * banta hai. Ek order ke kai parcel ho sakte hain, aur order tabhi
     * "delivered" hota hai jab SAB parcel deliver ho jaayein — us hisaab ke
     * liye har parcel ka apna haal alag chahiye.
     */
    deliveryStatus: { type: String, default: null },

    /** Kitne box label logistics ko bhej diye gaye. Sirf hisaab ke liye. */
    labelCount: { type: Number, default: 0 },
    deliveryUpdatedAt: { type: Date },

    lastError: { type: String },
    attempts: { type: Number, default: 0 },

    /**
     * Fail hone par agli koshish kab.
     *
     * Backoff isliye ki logistics band ho to har 20 second uspe request maarne
     * se kuch nahi milta. Aur permanent galti (jaise pincode kisi branch me hai
     * hi nahi) har baar wahi jawab degi — usko har minute dohrana logs bhar
     * deta hai aur asli problem chhup jaati hai.
     */
    nextAttemptAt: { type: Date, default: Date.now },

    syncedAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * Ek order + warehouse ki ek hi row. Ye unique index hi wo cheez hai jo do
 * saath chalti hui sync ko ek hi parcel do baar bhejne se rokti hai.
 */
logisticsSyncSchema.index({ orderId: 1, warehouseId: 1 }, { unique: true });
logisticsSyncSchema.index({ status: 1, nextAttemptAt: 1 });
logisticsSyncSchema.index({ awb: 1 }, { sparse: true });

module.exports = mongoose.model("LogisticsSync", logisticsSyncSchema);