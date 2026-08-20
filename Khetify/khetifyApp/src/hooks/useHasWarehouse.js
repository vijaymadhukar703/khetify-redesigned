import { useEffect, useState } from "react";
import { getWarehouseDirectory, getWarehouses } from "../lib/imsApi";

/**
 * useHasWarehouse — does the CURRENT COMPANY own at least one warehouse?
 *
 * Business rule (Inventory): a Lot always lives in a warehouse, so Lot creation
 * stays locked until the company has set up at least one. This hook is the
 * single frontend source of truth for that check; the backend
 * (middlewares/requireWarehouseExists.js) enforces it authoritatively.
 *
 * It reads the WAREHOUSE DIRECTORY (GET /warehouse?directory=1) — an existing
 * endpoint that returns EVERY company warehouse (names only) regardless of the
 * caller's warehouse scope. Using the scoped list instead would wrongly report
 * "no warehouse" for a user who simply isn't assigned to one. GET /warehouse is
 * only used as a fallback if the directory call fails.
 *
 * Returns { checked, hasWarehouse }:
 *   checked      — the lookup finished and its answer can be trusted.
 *   hasWarehouse — true when at least one warehouse exists.
 *
 * FAILS OPEN by design: while loading, and if BOTH lookups error, it reports
 * { checked: false, hasWarehouse: true } so a network blip can never lock a
 * company out of its own Inventory. Gate your UI on `checked && !hasWarehouse`.
 */
export default function useHasWarehouse() {
  const [state, setState] = useState({ checked: false, hasWarehouse: true });

  useEffect(() => {
    let alive = true;
    const rowsOf = (r) => (Array.isArray(r) ? r : r?.data || []);

    (async () => {
      try {
        const rows = rowsOf(await getWarehouseDirectory());
        if (alive) setState({ checked: true, hasWarehouse: rows.length > 0 });
      } catch {
        try {
          const rows = rowsOf(await getWarehouses());
          if (alive) setState({ checked: true, hasWarehouse: rows.length > 0 });
        } catch {
          // Both lookups failed — stay open, let the backend decide.
          if (alive) setState({ checked: false, hasWarehouse: true });
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}