import { fmt, storageKeyFor, loadFromStorage, saveToStorage, normalizeRowGeneric, toNumber, escapeHtml } from './app-shared.js';

export function appSingle() {
  const storageKey = storageKeyFor('single');
  const normalizeRow = (raw) => normalizeRowGeneric(raw, {
    strings: ['Address','City','State','Notes','Tag','Link'],
    numbers: ['Beds','Baths','Sqft','Price','RentZestimate','TaxesAnnual','InsuranceAnnual','HOAmonthly','Lat','Lon'],
    lowerTags: true,
    idFrom: (r) => {
      const parts = [r.State, r.City, r.Address].map((s) => (s || '').toLowerCase().trim()).filter(Boolean);
      return parts.length ? parts.join('|') : null;
    },
  });

  function computeDerived(row) {
    const sqft = toNumber(row.Sqft) || 0;
    const price = toNumber(row.Price) || 0;
    const rent = toNumber(row.RentZestimate) || 0;
    row._PricePerSqft = sqft > 0 ? (price / sqft) : null;
    row._RentYield = price > 0 ? ((rent * 12) / price) : null; // annual rent / price
  }

  return {
    fmt,
    rows: [],
    filters: { state: '', minBeds: null, maxPrice: null, search: '' },
    modals: { add: false, bulk: false },
    form: { Address: '', City: '', State: '', Beds: null, Baths: null, Sqft: null, Price: null, RentZestimate: null, TaxesAnnual: null, InsuranceAnnual: null, HOAmonthly: null, Notes: '', Tag: 'inbox', Lat: null, Lon: null, Link: '' },
    bulk: { raw: '', preview: [], headers: [] },

    // Map
    map: null,
    markersLayer: null,
    pinCount: 0,

    init() {
      this.rows = loadFromStorage(storageKey, (r) => { const n = normalizeRow(r); computeDerived(n); return n; });
      this.$nextTick(() => { this.initMap(); this.refreshMarkers(); });
      this.$watch('rows', () => { saveToStorage(storageKey, this.rows); this.refreshMarkers(); });
      this.$watch('filters', () => this.refreshMarkers(), { deep: true });
    },

    uniqueStates() { return Array.from(new Set(this.rows.map((r) => r.State).filter(Boolean))).sort(); },

    filteredSorted() {
      const q = (this.filters.search || '').toLowerCase();
      const cur = this.rows.filter((r) => {
        if (this.filters.state && r.State !== this.filters.state) return false;
        if (this.filters.minBeds != null && (toNumber(r.Beds) ?? 0) < this.filters.minBeds) return false;
        if (this.filters.maxPrice != null && (toNumber(r.Price) ?? Infinity) > this.filters.maxPrice) return false;
        if (q) {
          const hay = [r.Address, r.City, r.Notes, r.Tag].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      cur.forEach(computeDerived);
      cur.sort((a, b) => ((b._RentYield ?? -Infinity) - (a._RentYield ?? -Infinity)) || ((a.Price ?? Infinity) - (b.Price ?? Infinity)));
      return cur;
    },

    // Map
    initMap() {
      this.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([41.3, -72.9], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
    },
    refreshMarkers() {
      if (!this.map || !this.markersLayer) return;
      this.markersLayer.clearLayers();
      const rows = this.filteredSorted().filter((r) => r.Lat != null && r.Lon != null && isFinite(r.Lat) && isFinite(r.Lon)).filter((r) => ['shortlist','visit'].includes((r.Tag || '').toLowerCase()));
      this.pinCount = rows.length;
      for (const r of rows) {
        const marker = L.circleMarker([r.Lat, r.Lon], { radius: 6, color: '#0ea5e9', fillColor: '#0ea5e9', weight: 1.5, fillOpacity: 0.75 });
        const popupHtml = `
          <div class="text-sm">
            <div class="font-semibold">${escapeHtml(r.Address)}</div>
            <div>${escapeHtml(r.City)}, ${escapeHtml(r.State)}</div>
            <div>Beds: ${escapeHtml(r.Beds)} · Baths: ${escapeHtml(r.Baths)} · Sqft: ${escapeHtml(r.Sqft)}</div>
            <div>Price: ${escapeHtml(fmt.currency(r.Price))} · Rent est.: ${escapeHtml(fmt.currency(r.RentZestimate))}</div>
          </div>`;
        marker.bindPopup(popupHtml).addTo(this.markersLayer);
      }
    },

    // CRUD
    onRowChanged(_row) { saveToStorage(storageKey, this.rows); },
    openAdd() { this.modals.add = true; },
    submitAdd() { const r = normalizeRow({ ...this.form }); computeDerived(r); this.rows.push(r); this.modals.add = false; },
    openBulk() { this.modals.bulk = true; this.bulk = { raw: '', preview: [], headers: [] }; },
    bulkPreview() { const t = this.bulk.raw || ''; if (!t.trim()) { this.bulk.preview = []; this.bulk.headers = []; return; } const res = Papa.parse(t, { header: true, skipEmptyLines: true }); const rows = res.data || []; const headers = res.meta?.fields || Object.keys(rows[0] || {}); this.bulk.preview = rows; this.bulk.headers = headers; },
    bulkCommit() { if (this.bulk.preview.length === 0) return; const normalized = this.bulk.preview.map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...normalized); this.modals.bulk = false; this.bulk = { raw: '', preview: [], headers: [] }; },

    importCsv(e) { const f = e.target.files?.[0]; if (!f) return; Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => { const rows = (res.data || []).map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); e.target.value=''; }, error: (err) => { alert('Failed to import CSV' + (err?.message ? ': ' + err.message : '')); e.target.value=''; } }); },
    importJson(e) { const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => { try { const arr = JSON.parse(String(reader.result || '[]')); if (!Array.isArray(arr)) throw new Error('Invalid JSON: expected array'); const rows = arr.map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); } catch (err) { alert('Failed to import JSON' + (err?.message ? ': ' + err.message : '')); } finally { e.target.value=''; } }; reader.readAsText(f); },
    exportCsv() { const headers = ['Address','City','State','Beds','Baths','Sqft','Price','RentZestimate','TaxesAnnual','InsuranceAnnual','HOAmonthly','Notes','Tag','Lat','Lon','Link']; const data = this.filteredSorted().map((r) => headers.map((h) => r[h] ?? '')); const csv = Papa.unparse({ fields: headers, data }); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='single_filtered.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); },
    exportJson() { const headers = ['Address','City','State','Beds','Baths','Sqft','Price','RentZestimate','TaxesAnnual','InsuranceAnnual','HOAmonthly','Notes','Tag','Lat','Lon','Link']; const data = this.filteredSorted().map((r) => { const o={}; headers.forEach((h)=>o[h]=r[h]??null); return o; }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='single_filtered.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); },
  };
}

document.addEventListener('alpine:init', () => {
  Alpine.data('app', appSingle);
});


