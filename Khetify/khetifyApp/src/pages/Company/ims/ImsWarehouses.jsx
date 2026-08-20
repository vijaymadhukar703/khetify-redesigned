import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getWarehouses, createWarehouse, updateWarehouse, getLots, fmtDate } from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn } from './ImsUi';
import { usePermission } from '../../../context/PermissionContext';
import { State, City } from 'country-state-city';

const OTHER_CITY = '__other__';

// ── WAREHOUSE MANAGER (company member) ──
// A warehouse's manager is created WITH the warehouse; there is no separate
// Add Member flow anymore. These rules mirror validators/userValidators.js
// exactly, so the form and the API agree on what a valid manager looks like.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateManager = (m) => {
  const v = {
    name: m.name.trim(), email: m.email.trim(),
    phone: m.phone.trim(), password: m.password.trim(),
  };
  const e = {};
  if (!v.name) e.name = 'Manager name is required';
  if (!v.email) e.email = 'Email is required';
  else if (!EMAIL_RE.test(v.email)) e.email = 'Enter a valid email';
  if (!v.phone) e.phone = 'Phone is required';
  else if (!/^\d{10}$/.test(v.phone)) e.phone = 'Enter a valid 10-digit phone number';
  if (!v.password) e.password = 'Password is required';
  else if (v.password.length < 6) e.password = 'Password must be at least 6 characters';
  return e;
};

// ── WAREHOUSE ADDRESS & MAP LINK ──
// Address and Pincode are mandatory; the Google Maps link is OPTIONAL and must
// never block a save. These mirror validators/warehouseValidators.js exactly,
// so the form and the API agree.
const MAPS_URL_RE = /^https?:\/\/\S+$/i;

const validateWarehouse = (f) => {
  const e = {};
  if (!f.name.trim()) e.name = 'Warehouse name is required';
  if (!f.state) e.state = 'State is required';
  if (!f.city.trim()) e.city = 'City is required';
  if (!f.line1.trim()) e.line1 = 'Address is required';
  if (!f.pincode.trim()) e.pincode = 'Pincode is required';
  else if (!/^\d{6}$/.test(f.pincode.trim())) e.pincode = 'Enter a valid 6-digit pincode';
  // Optional: only a NON-EMPTY value is format-checked. Blank is always fine.
  const link = f.mapsUrl.trim();
  if (link && !MAPS_URL_RE.test(link)) {
    e.mapsUrl = 'Enter a valid link starting with http:// or https://';
  }
  return e;
};

/** A saved warehouse's [lng, lat], or null when never set (missing or [0, 0]). */
const coordsOf = (w) => {
  const c = w?.location?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng === 0 && lat === 0) return null;
  return { lng, lat };
};

const FieldError = ({ msg }) => (msg ? <p className="text-xs font-medium text-[#EA2831] mt-1">⚠ {msg}</p> : null);

/**
 * Occupancy figures from live units vs capacity.
 *  - pct       : the TRUE percentage — never clamped, so an overfilled
 *                warehouse reads e.g. 202.5% instead of a misleading 100%.
 *  - pctLabel  : pct formatted (integer when whole, else 1 decimal).
 *  - barWidth  : clamped to 100 — the visual track can't exceed its width.
 *  - over      : units stored above capacity (0 when within).
 * Returns null when the warehouse has no capacity set (uncapped).
 */
const occupancyInfo = (units, capacity) => {
  if (!capacity) return null;
  const pct = Math.round((units / capacity) * 1000) / 10;
  return {
    pct,
    pctLabel: Number.isInteger(pct) ? String(pct) : pct.toFixed(1),
    barWidth: Math.min(100, pct),
    over: Math.max(0, units - capacity),
  };
};

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

/** Warehouses — occupancy per warehouse, computed from live lot rows. */
const ImsWarehouses = () => {
  // Warehouses are company infrastructure: only the admin can add them
  // (warehouse:manage resolves only via the company_admin wildcard).
  const canManageWarehouses = usePermission('warehouse:manage');
  const [warehouses, setWarehouses] = useState([]);
  const [lots, setLots] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // warehouse being edited
  const [detail, setDetail] = useState(null); // { warehouse, occ } when a card is opened

  const refresh = () => {
    getWarehouses().then((r) => r?.success && setWarehouses(r.data)).catch(() => {});
    getLots().then((r) => r?.success && setLots(r.data)).catch(() => {});
  };
  useEffect(refresh, []);

  // Deep link from the Inventory gate ("Create Warehouse"): /warehouses?new=1
  // opens Add Warehouse straight away. Ignored for anyone without
  // warehouse:manage, and a no-op for every normal visit to this page.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') && canManageWarehouses) setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageWarehouses]);

  const byWarehouse = useMemo(() => {
    const map = {};
    for (const l of lots) {
      const id = l.warehouseId?._id || 'none';
      if (!map[id]) map[id] = { units: 0, lots: [] };
      if (l.availableStock > 0) {
        map[id].units += l.availableStock;
        map[id].lots.push(l);
      }
    }
    return map;
  }, [lots]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
            {warehouses.length} warehouse(s) · occupancy computed from live lots
          </p>
          {canManageWarehouses && (
            <PrimaryBtn onClick={() => setShowCreate(true)}>
              <span className="material-symbols-outlined text-base">add_business</span> Add Warehouse
            </PrimaryBtn>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {warehouses.map((w) => {
            const occ = byWarehouse[w._id] || { units: 0, lots: [] };
            const info = occupancyInfo(occ.units, w.capacityUnits);
            return (
              <div key={w._id} role="button" tabIndex={0}
                onClick={() => setDetail({ warehouse: w, occ })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail({ warehouse: w, occ }); } }}
                className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm cursor-pointer hover:shadow-md hover:border-[#EA2831]/40 transition-all">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-bold text-stone-900">{w.name}</h3>
                  <div className="flex items-center gap-1">
                    {canManageWarehouses && (
                      <button
                        type="button"
                        title="Edit warehouse"
                        onClick={(e) => { e.stopPropagation(); setEditing(w); }}
                        className="text-stone-400 hover:text-[#EA2831] transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                      </button>
                    )}
                    <span className="material-symbols-outlined text-stone-300">warehouse</span>
                  </div>
                </div>
                <p className="text-xs text-stone-400 mb-4">
                  {[w.address?.city, w.address?.state, w.address?.pincode].filter(Boolean).join(', ') || w.code || '—'}
                </p>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-900">{occ.units.toLocaleString('en-IN')} units</span>
                  {info && (
                    <span className={info.over > 0 ? 'text-red-600' : info.pct > 85 ? 'text-red-600' : 'text-stone-400'}>
                      {info.pctLabel}% of {w.capacityUnits.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
                {info && (
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full ${info.over > 0 || info.pct > 85 ? 'bg-red-500' : info.pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`}
                      style={{ width: `${info.barWidth}%` }}
                    />
                  </div>
                )}
                {info && info.over > 0 && (
                  <p className="text-[10px] font-bold text-red-600 mb-4">
                    Over capacity by {info.over.toLocaleString('en-IN')} units
                  </p>
                )}
                {info && info.over === 0 && <div className="mb-4" />}
                <div className="space-y-1.5">
                  {occ.lots.slice(0, 4).map((l) => (
                    <div key={l._id} className="flex justify-between text-xs border-b border-dashed border-stone-100 pb-1.5">
                      <span className="text-stone-500 truncate pr-2">
                        {l.productId?.productName} · <b>{l.lotNumber || l.batchNumber}</b>
                      </span>
                      <span className="font-bold text-stone-900">{l.availableStock}</span>
                    </div>
                  ))}
                  {occ.lots.length === 0 && <p className="text-xs text-stone-300">Empty</p>}
                  {occ.lots.length > 4 && <p className="text-[10px] text-stone-400">+{occ.lots.length - 4} more lots</p>}
                </div>
              </div>
            );
          })}
          {warehouses.length === 0 && (
            <p className="text-sm text-stone-400 col-span-full py-10 text-center">
              No warehouses yet — add your first one.
            </p>
          )}
        </div>
      </div>

      {detail && (
        <WarehouseDetailModal
          warehouse={detail.warehouse}
          occ={detail.occ}
          onClose={() => setDetail(null)}
        />
      )}

      {showCreate && (
        <WarehouseFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); refresh(); }}
        />
      )}

      {editing && (
        <WarehouseFormModal
          warehouse={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
};

const Meta = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm font-bold text-stone-800 break-words">{value}</p>
  </div>
);

/** Read-only warehouse detail: profile + occupancy + the full lot list. */
const WarehouseDetailModal = ({ warehouse: w, occ, onClose }) => {
  const info = occupancyInfo(occ.units, w.capacityUnits);
  const coords = coordsOf(w);
  // Prefer the saved share link; fall back to coordinates for older warehouses.
  const mapsHref = w.mapsUrl || (coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : null);
  const addr = [w.address?.line1, w.address?.city, w.address?.district, w.address?.state, w.address?.pincode]
    .filter(Boolean).join(', ');
  return (
    <Modal title={w.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Meta label="Code" value={w.code || '—'} />
        <Meta label="Address" value={addr || '—'} />
        <Meta label="Capacity" value={w.capacityUnits ? `${w.capacityUnits.toLocaleString('en-IN')} units` : '—'} />
        <Meta label="In stock" value={`${occ.units.toLocaleString('en-IN')} units`} />
      </div>

      {/* Map location — the optional Google Maps link. Older records that only
          have stored coordinates still get a working link from those. */}
      <div className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Map Location</p>
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-bold text-[#EA2831] hover:underline break-all"
          >
            <span className="material-symbols-outlined text-base">location_on</span> Open in Maps
          </a>
        ) : (
          <p className="text-sm font-bold text-stone-800">Not set</p>
        )}
      </div>

      {info && (
        <div className="mb-5">
          <div className="flex justify-between text-xs font-bold mb-1.5">
            <span className="text-stone-500">Occupancy</span>
            <span className={info.over > 0 || info.pct > 85 ? 'text-red-600' : 'text-stone-400'}>{info.pctLabel}% of {w.capacityUnits.toLocaleString('en-IN')}</span>
          </div>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${info.over > 0 || info.pct > 85 ? 'bg-red-500' : info.pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`}
              style={{ width: `${info.barWidth}%` }}
            />
          </div>
          {info.over > 0 && (
            <p className="text-xs font-bold text-red-600 mt-1.5">
              Over capacity by {info.over.toLocaleString('en-IN')} units
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
        Lots in this warehouse ({occ.lots.length})
      </p>
      <div className="border border-stone-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm min-w-[520px] resp-table">
            <thead>
              <tr className="bg-stone-50 text-[10px] uppercase text-stone-400">
                <th className="px-4 py-2 font-bold">Product</th>
                <th className="px-4 py-2 font-bold">Lot No.</th>
                <th className="px-4 py-2 font-bold">Expiry</th>
                <th className="px-4 py-2 font-bold text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {occ.lots.map((l) => (
                <tr key={l._id}>
                  <td data-label="Product" className="px-4 py-2 text-stone-700">{l.productId?.productName || '—'}</td>
                  <td data-label="Lot No." className="px-4 py-2 font-mono text-xs font-bold text-stone-900">{l.lotNumber || l.batchNumber || '—'}</td>
                  <td data-label="Expiry" className="px-4 py-2 text-xs text-stone-500">{l.expiryDate ? fmtDate(l.expiryDate) : '—'}</td>
                  <td data-label="Qty" className="px-4 py-2 text-right font-bold text-stone-900">{(l.availableStock ?? 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {occ.lots.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-stone-400">No stock in this warehouse.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
};

const WarehouseFormModal = ({ warehouse, onClose, onDone }) => {
  const isEdit = !!warehouse;

  // Dependent State → City dropdowns (data ships with country-state-city, no API).
  // We STORE the full names (f.state / f.city); stateIso only drives the city list.
  const states = useMemo(() => State.getStatesOfCountry('IN'), []);

  // In edit mode, resolve the stored state NAME back to its isoCode so the
  // dependent city list works, and decide whether the city is a listed one.
  const initialStateIso = useMemo(
    () => (warehouse?.address?.state ? states.find((s) => s.name === warehouse.address.state)?.isoCode || '' : ''),
    [warehouse, states],
  );
  const initialCityChoice = useMemo(() => {
    const c = warehouse?.address?.city;
    if (!c) return '';
    const list = initialStateIso ? City.getCitiesOfState('IN', initialStateIso) : [];
    return list.some((x) => x.name === c) ? c : OTHER_CITY;
  }, [warehouse, initialStateIso]);

  const [f, setF] = useState({
    name: warehouse?.name || '',
    code: warehouse?.code || '',
    city: warehouse?.address?.city || '',
    state: warehouse?.address?.state || '',
    pincode: warehouse?.address?.pincode || '',
    line1: warehouse?.address?.line1 || '',
    capacityUnits: warehouse?.capacityUnits ?? '',
    // OPTIONAL Google Maps share link. Blank is a perfectly valid warehouse.
    mapsUrl: warehouse?.mapsUrl || '',
  });
  const [wErrors, setWErrors] = useState({});
  // Editing a field clears its own message as it's fixed.
  const clearErr = (k) => setWErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  const u = (k) => (e) => { setF({ ...f, [k]: e.target.value }); clearErr(k); };
  // Pincode is digits only, capped at the 6 an Indian PIN has.
  const onPincode = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    setF((prev) => ({ ...prev, pincode: digits }));
    clearErr('pincode');
  };

  // Manager block — CREATE ONLY. Editing a warehouse never touches its
  // manager (that account already exists and is managed from Team & Roles),
  // so none of this renders or submits in edit mode.
  const [m, setM] = useState({ name: '', email: '', phone: '', password: '' });
  const [mErrors, setMErrors] = useState({});
  // Editing a field clears its own message as it is fixed.
  const um = (k) => (e) => {
    setM((prev) => ({ ...prev, [k]: e.target.value }));
    if (mErrors[k]) setMErrors((prev) => ({ ...prev, [k]: undefined }));
  };
  const onManagerPhone = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setM((prev) => ({ ...prev, phone: digits }));
    if (mErrors.phone) setMErrors((prev) => ({ ...prev, phone: undefined }));
  };
  const managerFilled = !!(m.name.trim() && m.email.trim() && m.phone.trim() && m.password.trim());

  const [stateIso, setStateIso] = useState(initialStateIso);
  const cities = useMemo(() => (stateIso ? City.getCitiesOfState('IN', stateIso) : []), [stateIso]);
  const [cityChoice, setCityChoice] = useState(initialCityChoice); // a listed city name or OTHER_CITY
  const [otherCity, setOtherCity] = useState(initialCityChoice === OTHER_CITY ? (warehouse?.address?.city || '') : '');

  const onStateChange = (e) => {
    const iso = e.target.value;
    const name = states.find((s) => s.isoCode === iso)?.name || '';
    setStateIso(iso);
    // Picking a new state always resets the city.
    setCityChoice('');
    setOtherCity('');
    setF((prev) => ({ ...prev, state: name, city: '' }));
  };
  const onCityChange = (e) => {
    const v = e.target.value;
    setCityChoice(v);
    setF((prev) => ({ ...prev, city: v === OTHER_CITY ? otherCity : v }));
  };
  const onOtherCity = (e) => {
    const v = e.target.value;
    setOtherCity(v);
    setF((prev) => ({ ...prev, city: v }));
    clearErr('city');
  };

  const submit = async () => {
    // Address / Pincode / Location are mandatory in BOTH create and edit, so a
    // warehouse can never be left without them. The backend re-validates the
    // same rules on create.
    const we = validateWarehouse(f);
    setWErrors(we);
    if (Object.keys(we).length) return;
    // Create needs a valid manager; format errors surface here, and the
    // backend re-validates the identical rules regardless.
    if (!isEdit) {
      const me = validateManager(m);
      setMErrors(me);
      if (Object.keys(me).length) return;
    }
    // Edit keeps '' so the server can clear capacity; create omits it (undefined).
    const capacity = f.capacityUnits === '' ? (isEdit ? '' : undefined) : Number(f.capacityUnits);
    const payload = {
      name: f.name,
      code: f.code,
      address: {
        line1: f.line1.trim(),
        city: f.city,
        state: f.state,
        pincode: f.pincode.trim(),
      },
      // Optional Google Maps link. Sent even when blank so an edit can CLEAR a
      // previously saved link; the backend treats "" as "remove it".
      mapsUrl: f.mapsUrl.trim(),
      capacityUnits: capacity,
    };
    try {
      if (isEdit) {
        await updateWarehouse(warehouse._id, payload);
        toast('success', 'Warehouse updated');
      } else {
        // Warehouse + its manager in ONE call — the backend creates both
        // together and assigns the manager to the new warehouse.
        await createWarehouse({
          ...payload,
          manager: {
            name: m.name.trim(),
            email: m.email.trim(),
            phone: m.phone.trim(),
            password: m.password.trim(),
          },
        });
        toast('success', 'Warehouse and manager created');
      }
      onDone();
    } catch (err) {
      // 403 on create usually means the plan lacks multi_warehouse — server enforces it
      toast('error', err?.response?.data?.message || `Could not ${isEdit ? 'update' : 'create'} warehouse`);
    }
  };
  return (
    <Modal title={isEdit ? 'Edit Warehouse' : 'Add Warehouse'} onClose={onClose}>
      <Field label="Name *">
        <input className={inputCls} value={f.name} onChange={u('name')} />
        <FieldError msg={wErrors.name} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Code"><input className={inputCls} value={f.code} onChange={u('code')} placeholder="WH-JBP" /></Field>
        <Field label="Capacity (units)"><input type="number" className={inputCls} value={f.capacityUnits} onChange={u('capacityUnits')} /></Field>
        <Field label="State *">
          <select className={inputCls} value={stateIso} onChange={onStateChange}>
            <option value="">Select state…</option>
            {states.map((s) => <option key={s.isoCode} value={s.isoCode}>{s.name}</option>)}
          </select>
          <FieldError msg={wErrors.state} />
        </Field>
        <Field label="City *">
          <select className={inputCls} value={cityChoice} onChange={onCityChange} disabled={!stateIso}>
            <option value="">{stateIso ? 'Select city…' : 'Select a state first'}</option>
            {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            <option value={OTHER_CITY}>Other…</option>
          </select>
          <FieldError msg={wErrors.city} />
        </Field>
      </div>
      {cityChoice === OTHER_CITY && (
        <Field label="Enter city"><input className={inputCls} value={otherCity} onChange={onOtherCity} placeholder="Type the city name" /></Field>
      )}
      <Field label="Address *">
        <textarea
          className={`${inputCls} min-h-[76px] resize-y`}
          value={f.line1}
          onChange={u('line1')}
          placeholder="Building / plot, street, landmark"
        />
        <FieldError msg={wErrors.line1} />
      </Field>
      <Field label="Pincode *">
        <input
          className={inputCls}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={f.pincode}
          onChange={onPincode}
          placeholder="6-digit PIN code"
        />
        <FieldError msg={wErrors.pincode} />
      </Field>

      {/* OPTIONAL — a warehouse saves perfectly well with this left blank. */}
      <Field label="Google Maps Location URL (Optional)">
        <input
          className={inputCls}
          type="url"
          inputMode="url"
          value={f.mapsUrl}
          onChange={u('mapsUrl')}
          placeholder="Paste Google Maps share link (Optional)"
        />
        <FieldError msg={wErrors.mapsUrl} />
      </Field>

      {/* WAREHOUSE MANAGER — created and assigned to this warehouse on save. */}
      {!isEdit && (
        <div className="mt-6 pt-5 border-t border-stone-200">
          <div className="flex items-start gap-2 mb-4">
            <span className="material-symbols-outlined text-[#EA2831] text-[20px]">badge</span>
            <div>
              <h4 className="text-sm font-bold text-stone-900">Warehouse Manager</h4>
              <p className="text-xs text-stone-500 mt-0.5">
                This account is created with the warehouse and assigned to it. They sign in with the email and password below.
              </p>
            </div>
          </div>

          <Field label="Full Name *">
            <input className={inputCls} value={m.name} onChange={um('name')} placeholder="Manager's full name" />
            <FieldError msg={mErrors.name} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Email *">
              <input className={inputCls} type="email" value={m.email} onChange={um('email')} placeholder="manager@company.com" />
              <FieldError msg={mErrors.email} />
            </Field>
            <Field label="Phone Number *">
              <input
                className={inputCls}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={m.phone}
                onChange={onManagerPhone}
                placeholder="10-digit mobile number"
              />
              <FieldError msg={mErrors.phone} />
            </Field>
          </div>
          <Field label="Password *">
            <input className={inputCls} type="password" value={m.password} onChange={um('password')} placeholder="At least 6 characters" />
            <FieldError msg={mErrors.password} />
          </Field>
        </div>
      )}
      <PrimaryBtn
        disabled={
          !f.name.trim() || !f.state || !f.city || !f.line1.trim() || !f.pincode.trim() ||
          (!isEdit && !managerFilled)
        }
        onClick={submit}
      >
        <span className="material-symbols-outlined text-base">{isEdit ? 'save' : 'add_business'}</span> {isEdit ? 'Save Changes' : 'Create'}
      </PrimaryBtn>
    </Modal>
  );
};

export default ImsWarehouses;