import { fmt, storageKeyFor, loadFromStorage, saveToStorage, normalizeRowGeneric, toNumber, escapeHtml } from './app-shared.js';

export function appMulti() {
  const storageKey = storageKeyFor('multi');
  const singleKey = storageKeyFor('single');
  // Starter sheets for CT (New Haven area)
  const CT_SHEET_A = [
    { Address: '123 Grand Ave', City: 'New Haven', State: 'CT', Units: 6, RentPerUnit: 1400, VacancyPercent: 5, OtherIncomeMonthly: 0, TaxesAnnual: 12000, InsuranceAnnual: 3800, OpExAnnual: 10500, Price: 850000, DownPercent: 25, RatePercent: 6.75, TermYears: 30, HOAmonthly: null, Notes: 'East Rock corridor', Tag: 'inbox', Lat: 41.318, Lon: -72.922, Link: '' },
    { Address: '45 Main St', City: 'Branford', State: 'CT', Units: 8, RentPerUnit: 1550, VacancyPercent: 4, OtherIncomeMonthly: 150, TaxesAnnual: 14500, InsuranceAnnual: 4200, OpExAnnual: 12000, Price: 1120000, DownPercent: 25, RatePercent: 6.75, TermYears: 30, HOAmonthly: null, Notes: 'Near train', Tag: 'watch', Lat: 41.279, Lon: -72.815, Link: '' },
    { Address: '200 Washington Ave', City: 'North Haven', State: 'CT', Units: 10, RentPerUnit: 1350, VacancyPercent: 6, OtherIncomeMonthly: 0, TaxesAnnual: 16000, InsuranceAnnual: 5000, OpExAnnual: 14000, Price: 1250000, DownPercent: 30, RatePercent: 6.9, TermYears: 30, HOAmonthly: null, Notes: 'Garden-style', Tag: 'inbox', Lat: 41.383, Lon: -72.864, Link: '' },
  ];
  const CT_SHEET_B = [
    { Address: '12 Whitfield St', City: 'Guilford', State: 'CT', Units: 4, RentPerUnit: 1800, VacancyPercent: 3, OtherIncomeMonthly: 0, TaxesAnnual: 9200, InsuranceAnnual: 3000, OpExAnnual: 8000, Price: 690000, DownPercent: 25, RatePercent: 6.65, TermYears: 30, HOAmonthly: null, Notes: 'Town center', Tag: 'shortlist', Lat: 41.283, Lon: -72.681, Link: '' },
    { Address: '78 Chapel St', City: 'New Haven', State: 'CT', Units: 12, RentPerUnit: 1450, VacancyPercent: 7, OtherIncomeMonthly: 200, TaxesAnnual: 22000, InsuranceAnnual: 6500, OpExAnnual: 20000, Price: 1650000, DownPercent: 25, RatePercent: 6.9, TermYears: 30, HOAmonthly: null, Notes: 'Downtown walkable', Tag: 'visit', Lat: 41.307, Lon: -72.929, Link: '' },
  ];
  const normalizeRow = (raw) => normalizeRowGeneric(raw, {
    strings: ['Address','City','State','Notes','Tag','Link'],
    numbers: ['Units','RentPerUnit','VacancyPercent','OtherIncomeMonthly','TaxesAnnual','InsuranceAnnual','OpExAnnual','Price','DownPercent','RatePercent','TermYears','HOAmonthly','Lat','Lon'],
    lowerTags: true,
    idFrom: (r) => {
      const parts = [r.State, r.City, r.Address].map((s) => (s || '').toLowerCase().trim()).filter(Boolean);
      return parts.length ? parts.join('|') : null;
    },
  });

  function computeDerived(row) {
    const units = toNumber(row.Units) || 0;
    const rent = toNumber(row.RentPerUnit) || 0;
    const vac = Math.max(0, Math.min(100, toNumber(row.VacancyPercent) ?? 0));
    const otherIncMo = toNumber(row.OtherIncomeMonthly) || 0;
    const taxes = toNumber(row.TaxesAnnual) || 0;
    const ins = toNumber(row.InsuranceAnnual) || 0;
    const opex = toNumber(row.OpExAnnual) || 0;
    const price = toNumber(row.Price) || 0;
    const downPct = Math.max(0, Math.min(100, toNumber(row.DownPercent) ?? 25));
    const ratePct = Math.max(0, toNumber(row.RatePercent) ?? 6.5);
    const termYears = Math.max(1, toNumber(row.TermYears) ?? 30);

    const egi = (units * rent * 12) * (1 - vac / 100) + otherIncMo * 12;
    const noi = egi - taxes - ins - opex;
    const loanAmount = Math.max(0, price * (1 - downPct / 100));
    const mRate = (ratePct / 100) / 12;
    const months = Math.round(termYears * 12);
    const monthlyPI = mRate === 0 ? (loanAmount / months) : (loanAmount * (mRate / (1 - Math.pow(1 + mRate, -months))));
    const annualDebt = monthlyPI * 12;
    const cap = price > 0 ? (noi / price) : 0;
    const dscr = annualDebt > 0 ? (noi / annualDebt) : 0;
    const pricePerUnit = units > 0 ? price / units : null;

    row._EGI = egi;
    row._NOI = noi;
    row._LoanAmount = loanAmount;
    row._MonthlyPI = monthlyPI;
    row._AnnualDebt = annualDebt;
    row._CapRate = cap;
    row._DSCR = dscr;
    row._PricePerUnit = pricePerUnit;
  }

  return {
    fmt,
    rows: [],
    singleRows: [],
    filters: { state: '', minDscr: null, minCap: null, maxPpu: null, search: '' },
    modals: { add: false, bulk: false },
    form: { Address: '', City: '', State: '', Units: null, RentPerUnit: null, VacancyPercent: null, OtherIncomeMonthly: null, TaxesAnnual: null, InsuranceAnnual: null, OpExAnnual: null, Price: null, DownPercent: 25, RatePercent: 6.5, TermYears: 30, HOAmonthly: null, Notes: '', Tag: 'inbox', Lat: null, Lon: null, Link: '' },
    bulk: { raw: '', preview: [], headers: [] },

    // Map
    map: null,
    markersLayer: null,
    pinCount: 0,

    // Quick calculator
    calc: { price: null, downPercent: 25, units: null, rentPerUnit: null },

    init() {
      this.rows = loadFromStorage(storageKey, (r) => {
        const n = normalizeRow(r);
        computeDerived(n);
        return n;
      });
      this.singleRows = loadFromStorage(singleKey, (r) => ({ Address: r.Address || '', City: r.City || '', State: r.State || '', Beds: toNumber(r.Beds), Baths: toNumber(r.Baths), Sqft: toNumber(r.Sqft), Price: toNumber(r.Price), RentZestimate: toNumber(r.RentZestimate), Notes: r.Notes || '', Tag: (r.Tag || 'inbox').toLowerCase(), Lat: toNumber(r.Lat), Lon: toNumber(r.Lon), Link: r.Link || '' }));
      this.$nextTick(() => { this.initMap(); this.refreshMarkers(); });
      this.$watch('rows', () => { saveToStorage(storageKey, this.rows); this.refreshMarkers(); });
      this.$watch('singleRows', () => { saveToStorage(singleKey, this.singleRows); });
      this.$watch('filters', () => this.refreshMarkers(), { deep: true });
    },

    uniqueStates() { return Array.from(new Set(this.rows.map((r) => r.State).filter(Boolean))).sort(); },

    // Sorting
    filteredSorted() {
      const q = (this.filters.search || '').toLowerCase();
      const cur = this.rows.filter((r) => {
        if (this.filters.state && r.State !== this.filters.state) return false;
        if (this.filters.minDscr != null && (r._DSCR ?? 0) < this.filters.minDscr) return false;
        if (this.filters.minCap != null && (r._CapRate ?? 0) < this.filters.minCap) return false;
        if (this.filters.maxPpu != null && (r._PricePerUnit ?? Infinity) > this.filters.maxPpu) return false;
        if (q) {
          const hay = [r.Address, r.City, r.Notes, r.Tag].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      cur.forEach(computeDerived);
      cur.sort((a, b) => (b._DSCR - a._DSCR) || (b._CapRate - a._CapRate) || ((a._PricePerUnit ?? Infinity) - (b._PricePerUnit ?? Infinity)));
      return cur;
    },

    // Calculator helpers
    calcDownPayment() { const p = Number(this.calc.price); const d = Number(this.calc.downPercent); if (!isFinite(p) || !isFinite(d)) return 0; const dp = Math.max(0, Math.min(100, d)); return Math.max(0, p * (dp / 100)); },
    calcTotalRentMonthly() { const u = Number(this.calc.units); const r = Number(this.calc.rentPerUnit); if (!isFinite(u) || !isFinite(r) || u <= 0 || r <= 0) return 0; return u * r; },

    // Map
    initMap() {
      this.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([42.3, -73.1], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
    },
    refreshMarkers() {
      if (!this.map || !this.markersLayer) return;
      this.markersLayer.clearLayers();
      const rows = this.filteredSorted().filter((r) => r.Lat != null && r.Lon != null && isFinite(r.Lat) && isFinite(r.Lon)).filter((r) => ['shortlist', 'visit'].includes((r.Tag || '').toLowerCase()));
      this.pinCount = rows.length;
      for (const r of rows) {
        const marker = L.circleMarker([r.Lat, r.Lon], { radius: 6, color: '#0ea5e9', fillColor: '#0ea5e9', weight: 1.5, fillOpacity: 0.75 });
        const popupHtml = `
          <div class="text-sm">
            <div class="font-semibold">${escapeHtml(r.Address)}</div>
            <div>${escapeHtml(r.City)}, ${escapeHtml(r.State)}</div>
            <div>Units: ${escapeHtml(r.Units)} · NOI: ${escapeHtml(fmt.currency(r._NOI))}</div>
            <div>Cap: ${escapeHtml((r._CapRate*100).toFixed(2))}% · DSCR: ${escapeHtml((r._DSCR).toFixed(2))}</div>
            ${r.Link ? `<div><a href="${escapeHtml(r.Link)}" target="_blank" class="text-indigo-600 underline">Link</a></div>` : ''}
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

    // Load CT sheets
    loadCtA() { const rows = CT_SHEET_A.map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); },
    loadCtB() { const rows = CT_SHEET_B.map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); },

    importCsv(e) { const f = e.target.files?.[0]; if (!f) return; Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => { const rows = (res.data || []).map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); e.target.value=''; }, error: (err) => { alert('Failed to import CSV' + (err?.message ? ': ' + err.message : '')); e.target.value=''; } }); },
    importJson(e) { const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => { try { const arr = JSON.parse(String(reader.result || '[]')); if (!Array.isArray(arr)) throw new Error('Invalid JSON: expected array'); const rows = arr.map((r) => { const n = normalizeRow(r); computeDerived(n); return n; }); this.rows.push(...rows); } catch (err) { alert('Failed to import JSON' + (err?.message ? ': ' + err.message : '')); } finally { e.target.value=''; } }; reader.readAsText(f); },
    exportCsv() { const headers = ['Address','City','State','Units','RentPerUnit','VacancyPercent','OtherIncomeMonthly','TaxesAnnual','InsuranceAnnual','OpExAnnual','Price','DownPercent','RatePercent','TermYears','HOAmonthly','Notes','Tag','Lat','Lon','Link']; const data = this.filteredSorted().map((r) => headers.map((h) => r[h] ?? '')); const csv = Papa.unparse({ fields: headers, data }); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='multi_filtered.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); },
    exportJson() { const headers = ['Address','City','State','Units','RentPerUnit','VacancyPercent','OtherIncomeMonthly','TaxesAnnual','InsuranceAnnual','OpExAnnual','Price','DownPercent','RatePercent','TermYears','HOAmonthly','Notes','Tag','Lat','Lon','Link']; const data = this.filteredSorted().map((r) => { const o={}; headers.forEach((h)=>o[h]=r[h]??null); return o; }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='multi_filtered.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); },

    // Single Family quick add
    sfAddQuick(addr, city, state, price) {
      this.singleRows.push({
        Address: addr || '', City: city || '', State: state || '',
        Beds: null, Baths: null, Sqft: null,
        Price: toNumber(price) || null, RentZestimate: null,
        Notes: '', Tag: 'inbox', Lat: null, Lon: null, Link: ''
      });
    },
  };
}

document.addEventListener('alpine:init', () => {
  Alpine.data('app', appMulti);
});


