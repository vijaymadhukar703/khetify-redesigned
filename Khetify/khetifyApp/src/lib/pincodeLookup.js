/* Pincode → district/state/city lookup, with a fallback source.
 *
 * PRIMARY — api.postalpincode.in: the free public India Post lookup. Usually
 * accurate, but it occasionally times out or has no record for a pincode.
 *
 * FALLBACK — a static JSON mirror of the Department of Posts dataset, hosted
 * on GitHub Pages (aniket-thapa/india-pincode-api). It is a DIFFERENT host and
 * a different snapshot of the same underlying government data, so an outage
 * or a gap in the primary source doesn't leave the pincode unresolved.
 *
 * NOTE ON LICENSING: the fallback dataset is published under CC BY-NC 4.0
 * (non-commercial use, with attribution: https://github.com/aniket-thapa/india-pincode-api).
 * That's fine for an internal tool or a non-commercial deployment; for a
 * commercial storefront, either keep this as a rarely-used fallback with
 * attribution, contact the author for a commercial licence, or swap this one
 * function for a different fallback source (e.g. a self-hosted copy of the
 * official data.gov.in pincode directory) — nothing else in the app needs to
 * change.
 *
 * Both sources are tried IN ORDER; the first one that resolves wins. Returns
 * { state, district, city } or null if neither source has the code.
 */

const titleCase = (s = "") =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

async function fromPrimary(pin) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const data = await res.json();
    const office = data?.[0]?.Status === "Success" ? data[0].PostOffice?.[0] : null;
    if (!office) return null;
    return { state: office.State, district: office.District, city: office.Name };
  } catch {
    return null;
  }
}

async function fromFallback(pin) {
  try {
    const res = await fetch(`https://aniket-thapa.github.io/india-pincode-api/pincodes/${pin}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.state || !data?.district) return null;
    // This source returns state/district in ALL CAPS; the primary source
    // returns them in Title Case — normalise so it never matters which one
    // actually resolved the address.
    return {
      state: titleCase(data.state),
      district: titleCase(data.district),
      city: data.offices?.[0]?.officeName ? titleCase(data.offices[0].officeName) : "",
    };
  } catch {
    return null;
  }
}

export async function lookupPincode(pin) {
  return (await fromPrimary(pin)) || (await fromFallback(pin));
}