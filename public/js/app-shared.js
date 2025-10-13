// Shared utilities for AGSCOUT apps (ES module)
// Keep generic helpers here: formatting, storage, parsing, ranks, merging

// ---------------- Formatting ----------------
export const fmt = {
  currency(value) {
    if (value == null || !isFinite(Number(value))) return "";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
  },
  number(value, fractionDigits = 2) {
    if (value == null || !isFinite(Number(value))) return "";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  },
  score(value) {
    if (value == null || !isFinite(Number(value))) return "";
    return Number(value).toFixed(2);
  },
};

// ---------------- Storage ----------------
export function storageKeyFor(namespace) {
  const ns = String(namespace).toLowerCase();
  if (ns === 'land') return 'agscout.rows';
  if (ns === 'multi') return 'agscout.multi';
  if (ns === 'single') return 'agscout.single';
  return `agscout.${ns}`;
}

export function loadFromStorage(key, normalizer) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const arr = JSON.parse(saved);
    if (!Array.isArray(arr)) return [];
    return normalizer ? arr.map(normalizer) : arr;
  } catch (_e) {
    return [];
  }
}

export function saveToStorage(key, rows) {
  try {
    localStorage.setItem(key, JSON.stringify(rows || []));
  } catch (_e) {}
}

// ---------------- Parsing helpers ----------------
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toBoolean(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return null;
}

export function normalizeRowGeneric(raw, schema) {
  // schema: { strings:[...], numbers:[...], booleans:[...], lowerTags?:boolean, idFrom?: (row)=>string|null }
  const trim = (v) => (v == null ? "" : String(v).trim());
  const row = {};
  for (const k of schema.strings || []) row[k] = trim(raw[k]);
  for (const k of schema.numbers || []) row[k] = toNumber(raw[k]);
  for (const k of schema.booleans || []) row[k] = toBoolean(raw[k]);
  if (schema.lowerTags && Object.prototype.hasOwnProperty.call(raw, "Tag")) {
    const t = trim(raw.Tag);
    row.Tag = (t || "inbox").toLowerCase();
    if (!row.Tag) row.Tag = "inbox";
  }
  if (schema.copy && Array.isArray(schema.copy)) {
    for (const k of schema.copy) row[k] = raw[k];
  }
  // ID (dedupe) - default from common address-like fields if not provided
  let id = null;
  if (schema.idFrom) id = schema.idFrom({ ...raw, ...row });
  if (!id) {
    const parts = [row.State, row.County, row.Town, row.Parcel]
      .map((s) => (s || "").toLowerCase().trim())
      .filter(Boolean);
    id = parts.length ? parts.join("|") : null;
  }
  row.id = id;
  return row;
}

// ---------------- Domain helpers ----------------
export function ppa(row) {
  const acres = row?.Acres;
  const price = row?.Price;
  if (!acres || !price || acres <= 0 || price <= 0) return null;
  return price / acres;
}

export function waterLabel(v) {
  if (v === 0) return "adjacent";
  if (v != null && isFinite(v) && v <= 900) return "near";
  return "far";
}

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------- Ranks/Scoring ----------------
export function rankLow(arr) {
  // arr: [{ id, v }]
  const vals = arr.slice().sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity));
  const map = new Map();
  vals.forEach((x, i) => map.set(x.id, i + 1));
  return map;
}

export function rankHigh(arr) {
  const vals = arr.slice().sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
  const map = new Map();
  vals.forEach((x, i) => map.set(x.id, i + 1));
  return map;
}

// Land-specific rank bundle, but generic enough to reuse
export function buildLandRanks(rows) {
  const ppaArr = rows.map((r) => ({ id: r.id, v: ppa(r) }));
  const acresArr = rows.map((r) => ({ id: r.id, v: r.Acres ?? null }));
  const waterArr = rows.map((r) => ({ id: r.id, v: r.WaterProximity ?? null }));
  return { ppaLow: rankLow(ppaArr), acresHigh: rankHigh(acresArr), waterLow: rankLow(waterArr) };
}

export function landScoreFromRanks(row, ranks, n) {
  const base =
    (ranks.ppaLow.get(row.id) ?? n) * 0.5 +
    (ranks.acresHigh.get(row.id) ?? n) * 0.3 +
    (ranks.waterLow.get(row.id) ?? n) * 0.2 +
    (row.Tag === "visit" ? -0.2 : 0);
  return base;
}

// ---------------- Merge/Dedupe ----------------
export function mergeRows(existingRows, incomingRows, normalizeRow) {
  const idToExisting = new Map(existingRows.map((r) => [r.id, r]));
  for (const incRaw of incomingRows) {
    const inc = normalizeRow ? normalizeRow(incRaw) : incRaw;
    if (!inc || !inc.id) continue;
    const existing = idToExisting.get(inc.id);
    if (!existing) {
      if (!inc.Tag) inc.Tag = "inbox";
      const copy = { ...inc };
      idToExisting.set(copy.id, copy);
      continue;
    }
    const merged = { ...existing };
    for (const k of Object.keys(inc)) {
      if (k === "id") continue;
      const v = inc[k];
      if (v !== null && v !== "" && v !== undefined) merged[k] = v;
    }
    if (inc.Tag) merged.Tag = String(inc.Tag).toLowerCase();
    idToExisting.set(existing.id, merged);
  }
  return Array.from(idToExisting.values());
}

// ---------------- CSV/JSON helpers ----------------
export function toCsvFromRows(rows, headers) {
  const data = rows.map((r) => headers.map((h) => (r[h] ?? "")));
  // Papa is loaded globally via CDN on pages
  const csv = window.Papa?.unparse ? window.Papa.unparse({ fields: headers, data }) : "";
  return csv;
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


