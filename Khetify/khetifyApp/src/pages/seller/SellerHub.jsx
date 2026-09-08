import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import { SELLER_MODULES } from "../../lib/sellerNav";
import {
  getSellerMe, getSellerLink, getSellerWarehouses, getSellerLots, getSellerSupplyOrders,
  searchSellerCompanies, ackSellerApproval,
} from "../../lib/sellerApi";
import { daysToExpiry, formatINR } from "../../lib/imsApi";
import { useSellerSubscription } from "../../context/SellerSubscriptionContext";
import { useSellerPermission } from "../../context/SellerPermissionContext";
import { useSellerNotifications, sellerNotifRoute } from "../../hooks/useSellerNotifications";
import HomeUpdates from "../../Components/HomeUpdates";

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: "top-end", timer: 2200, showConfirmButton: false });

// Supply-order statuses where the seller can scan the manifest to receive stock
// (mirrors SellerSupply.jsx) and the set still "in flight" (an open shipment).
const RECEIVABLE = ["dispatched", "in_transit", "arrived", "partially_received"];
const CLOSED = ["received", "delivered", "rejected", "cancelled"];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// Seller Hub — the post-login landing screen, styled to MIRROR the company Hub
// (KPI strip + action banner + module-card grid). Cards are gated exactly like
// the company: a role without the capability never sees a card; a paid module is
// shown locked until the OWNER seller's plan unlocks it.
const SellerHub = () => {
  const navigate = useNavigate();
  const { sellerCan, loading: subLoading } = useSellerSubscription();
  const { sellerCan: hasCap } = useSellerPermission();
  const canBill = hasCap("billing:manage"); // only seller_admin can upgrade
  // Live updates feed (same seller-scoped notifications as the header bell).
  const { items: updates, unread, markRead, markAll } = useSellerNotifications();

  const [name, setName] = useState("");
  const [link, setLink] = useState(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [kpi, setKpi] = useState({});
  const [counts, setCounts] = useState({});
  const [supply, setSupply] = useState([]);

  // NOTE: the supplying company's approval is deliberately NOT read here any
  // more. Modules open on the subscription alone (see lib/sellerNav.js), so the
  // Hub's KPIs, banners and cards no longer wait on it either.

  // Identity + supplying-company link (drives the greeting + the gate banner).
  const loadLink = () => {
    getSellerLink().then((r) => setLink(r?.data || null)).catch(() => setLink(null)).finally(() => setLinkLoading(false));
  };
  useEffect(() => {
    let alive = true;
    getSellerMe().then((r) => { if (alive) setName(r?.data?.name || r?.data?.sellerInfo?.businessName || ""); }).catch(() => {});
    loadLink();
    return () => { alive = false; };
  }, []);

  // Seller-scoped KPI + per-card metrics. Best-effort: every call degrades to
  // nothing on failure (e.g. a free plan 403s the paid lots endpoint) so the Hub
  // always renders. Lots/value need the paid Inventory feature; warehouses and
  // supply are free.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [whs, lots, orders] = await Promise.all([
        getSellerWarehouses().catch(() => null),
        getSellerLots().catch(() => null),       // paid (inventory_view) — may 403
        getSellerSupplyOrders().catch(() => null),
      ]);
      if (!alive) return;
      const whRows = whs?.data || [];
      const lotRows = lots?.data || null; // null = no inventory access (free)
      const orderRows = orders?.data || [];

      const inventoryValue = lotRows
        ? lotRows.reduce((s, l) => s + (l.availableStock || 0) * (l.productId?.mrp || 0), 0)
        : null;
      const lowStock = lotRows
        ? lotRows.filter((l) => (l.lowStockThreshold || 0) > 0 && (l.availableStock || 0) <= l.lowStockThreshold).length
        : 0;
      const expiring = lotRows
        ? lotRows.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; }).length
        : 0;
      const lotCount = lotRows ? lotRows.length : whRows.reduce((s, w) => s + (w.lotCount || 0), 0);
      const openShipments = orderRows.filter((o) => !CLOSED.includes(o.status)).length;

      setKpi({ inventoryValue, openShipments, lots: lotCount, alerts: lowStock + expiring });
      setCounts({ warehouses: whRows.length, lots: lotCount, lowStock });
      setSupply(orderRows);
    })();
    return () => { alive = false; };
  }, []);

  // Supply ready to scan-receive — the seller's actionable banner (mirrors the
  // company's "Transfers needing you").
  const toReceive = useMemo(() => supply.filter((o) => RECEIVABLE.includes(o.status)), [supply]);

  // Per-card metric/badge descriptor.
  const cardMeta = useMemo(() => ({
    warehouses: { metric: counts.warehouses != null ? `${counts.warehouses} site(s)` : "—" },
    catalog: { metric: "Browse products" },
    inbound: { metric: "Request & track", pending: toReceive.length ? `${toReceive.length} to receive` : null },
    inventory: { metric: counts.lots != null ? `${counts.lots} lot(s)` : "—", pending: counts.lowStock ? `${counts.lowStock} low stock` : null },
    transfers: { metric: "Move between sites" },
    labels: { metric: "Print & scan" },
    outbound: { metric: "Sell & fulfil" },
    customers: { metric: "Directory" },
  }), [counts, toReceive.length]);

  // Two gates, same as the company Hub:
  //  - HIDE (RBAC): a role without the capability never sees the card.
  //  - LOCK (subscription): a paid module the OWNER plan hasn't unlocked is
  //    shown but gated. The supplying company's approval is not a gate.
  const visible = (m) => !(m.cap && !hasCap(m.cap));
  const cards = SELLER_MODULES.filter(visible);

  const openCard = (m, planLocked) => {
    if (planLocked) {
      if (canBill) navigate("/seller/billing");
      else toast("info", "Ask your seller admin to upgrade the plan to unlock this.");
      return;
    }
    navigate(m.path);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
      {/* Heading */}
      <div className="mb-7">
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">
          {greeting()}{name ? `, ${name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-stone-500 mt-1">Here is your distribution at a glance. Pick a module to get started.</p>
      </div>

      {/* Supplying-company link state (one-time approval banner / apply flow) */}
      {!linkLoading && <SupplyingCompany link={link} canApply={hasCap("company:manage")} />}

      {/* Supply ready to receive — actionable banner (mirrors "Transfers needing you") */}
      {toReceive.length > 0 && (
        <div className="mt-6 mb-2 flex items-center gap-3 bg-[#EA2831]/5 border border-[#EA2831]/30 rounded-2xl p-4">
          <span className="material-symbols-outlined text-[#EA2831]">local_shipping</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-stone-900 text-sm">
              {toReceive.length} supply shipment{toReceive.length > 1 ? "s" : ""} ready to receive
            </p>
            <p className="text-xs text-stone-500">Scan the shipment label to receive the stock into your warehouse.</p>
          </div>
          <button onClick={() => navigate("/seller/supply")} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-[#d11f28] transition-colors">
            <span className="material-symbols-outlined text-base">qr_code_scanner</span> Scan to receive
          </button>
        </div>
      )}

      {/* KPI strip temporarily hidden — these metrics now live on the Seller Dashboard. */}
      {/*
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 mb-8">
        <KpiTile label="Inventory value (MRP)" value={kpi.inventoryValue == null ? "—" : formatINR(kpi.inventoryValue)} accent="text-stone-900" />
        <KpiTile label="Open shipments" value={kpi.openShipments ?? 0} accent="text-stone-900" />
        <KpiTile label="Lots" value={kpi.lots ?? 0} accent="text-stone-900" />
        <KpiTile label="Alerts" value={kpi.alerts ?? 0} accent="text-[#EA2831]" />
      </div>
      */}

      {/* Updates — the seller's live activity feed, right on Home (all roles) */}
      <div className="mb-8">
        <HomeUpdates items={updates} unread={unread} markRead={markRead} markAll={markAll} resolveRoute={sellerNotifRoute} fallbackRoute="/seller/hub" />
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((m) => {
          const meta = cardMeta[m.key] || {};
          const planOk = !subLoading && sellerCan(m.feature);
          // The plan is the only lock — see lib/sellerNav.js.
          const planLocked = !planOk;                    // paid module not in owner's plan
          const isLocked = planLocked;
          const lockHint = planLocked && canBill ? "Upgrade your plan to unlock"
            : planLocked ? "Ask your seller admin to upgrade"
            : "";
          return (
            <button
              key={m.key}
              onClick={() => openCard(m, planLocked)}
              aria-disabled={isLocked}
              title={lockHint || undefined}
              className={`group text-left bg-white border border-stone-200 rounded-2xl p-6 shadow-sm transition-all ${
                isLocked ? "opacity-90 hover:border-stone-300" : "hover:shadow-md hover:border-[#EA2831]/40"
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                  isLocked ? "bg-stone-100 text-stone-400" : "bg-[#EA2831]/10 text-[#EA2831]"
                }`}>
                  <span className="material-symbols-outlined text-[26px]">{m.icon}</span>
                </div>
                {planLocked ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 rounded-full px-2.5 py-1">
                    <span className="material-symbols-outlined text-[13px]">lock</span> Pro
                  </span>
                ) : meta.pending ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#EA2831] bg-[#EA2831]/10 rounded-full px-2.5 py-1">
                    {meta.pending}
                  </span>
                ) : null}
              </div>
              <h3 className="text-lg font-bold text-stone-900 mb-1">{m.label}</h3>
              <p className="text-sm text-stone-500 leading-snug mb-4">{m.desc}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-stone-700 truncate min-w-0">
                  {planLocked
                    ? <span className="text-stone-500 font-medium">{canBill ? "Upgrade to unlock" : "Ask your admin"}</span>
                    : meta.metric}
                </span>
                <span className={`material-symbols-outlined shrink-0 ${isLocked ? "text-stone-300" : "text-stone-300 group-hover:text-[#EA2831] group-hover:translate-x-0.5 transition-all"}`}>
                  {isLocked ? "lock" : "arrow_forward"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const KpiTile = ({ label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm min-w-0">
    <p className="text-stone-400 text-[10px] font-bold uppercase mb-2 tracking-wider truncate">{label}</p>
    <p className={`text-xl sm:text-2xl font-bold leading-tight break-words ${accent}`}>{value}</p>
  </div>
);

// Supplying-company link state. `canApply` (company:manage) gates the apply flow
// — a manager/staff sees the status banners but not the company picker.
const SupplyingCompany = ({ link, canApply }) => {
  const status = link?.linkStatus || "unlinked";
  const companyName = link?.company?.businessName;
  const [dismissed, setDismissed] = useState(false);

  const showApprovedBanner = status === "approved" && !link?.linkApprovalAcknowledged && !dismissed;
  useEffect(() => {
    if (status === "approved" && !link?.linkApprovalAcknowledged) {
      ackSellerApproval().catch(() => {});
    }
  }, [status, link?.linkApprovalAcknowledged]);

  if (status === "approved") {
    if (!showApprovedBanner) return null; // acknowledged → no banner, modules stay unlocked
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex items-center gap-3">
        <span className="material-symbols-outlined text-green-600">verified</span>
        <div className="flex-1">
          <p className="font-bold text-green-800">Linked to {companyName}</p>
          <p className="text-sm text-green-700">You&apos;re approved — your modules are unlocked.</p>
        </div>
        <button onClick={() => setDismissed(true)} className="text-green-600 hover:text-green-800" title="Dismiss">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center gap-3">
        <span className="material-symbols-outlined text-amber-600">hourglass_top</span>
        <div>
          <p className="font-bold text-amber-800">Awaiting approval from {companyName}</p>
          <p className="text-sm text-amber-700">Your portal is open in the meantime — approval is what lets you order and resell {companyName}&apos;s products.</p>
        </div>
      </div>
    );
  }

  // unlinked or rejected → let an admin (re)apply; managers/staff just see the note.
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
      {status === "rejected" && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          <p className="font-bold text-red-700">Your application to {companyName} was rejected.</p>
          {link?.linkRejectionReason && <p className="text-red-600 mt-0.5">Reason: {link.linkRejectionReason}</p>}
          {canApply && <p className="text-red-600 mt-0.5">Pick another company below to re-apply.</p>}
        </div>
      )}
      <h3 className="text-base font-bold text-stone-900 mb-1">Get authorized to sell</h3>
      <p className="text-sm text-stone-500 mb-4">Sellers resell a company&apos;s products. Apply for a Principal Certificate from the company that supplies you — once it&apos;s issued, you&apos;re authorized.</p>
      {canApply
        ? <CompanyPicker />
        : <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Your seller admin applies for the Principal Certificate.</p>}
    </div>
  );
};

// Find a company and start a PC application (the new authorization entry point).
// Selecting a company routes to the Certifications page where the company's PC
// form is loaded and profile fields are auto-filled.
const CompanyPicker = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const term = q.trim();
    let alive = true;
    const t = setTimeout(() => {
      if (!term || selected) { if (alive) setResults([]); return; }
      searchSellerCompanies(term).then((r) => { if (alive) setResults(r?.data || []); }).catch(() => { if (alive) setResults([]); });
    }, term && !selected ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, selected]);

  const applyForPc = () => {
    if (!selected) return;
    navigate(`/seller/certifications?company=${selected._id}`);
  };

  return (
    <div>
      <input
        value={selected ? selected.businessName : q}
        onChange={(e) => { setSelected(null); setQ(e.target.value); }}
        placeholder="Search companies…"
        className="block w-full h-11 px-3 rounded-lg border border-stone-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm"
      />
      {!selected && q.trim() && (
        <div className="mt-2 border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-56 overflow-y-auto">
          {results.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">No companies found.</p>}
          {results.map((c) => (
            <button
              key={c._id}
              type="button"
              onClick={() => { setSelected(c); setQ(""); }}
              className="block w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              {c.businessName}{c.location ? <span className="text-stone-400"> · {c.location}</span> : null}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={applyForPc}
        disabled={!selected}
        className="mt-4 rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Apply for PC
      </button>
    </div>
  );
};

export default SellerHub;
