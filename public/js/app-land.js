import {
  fmt,
  ppa,
  waterLabel,
  escapeHtml,
  storageKeyFor,
  loadFromStorage,
  saveToStorage,
  toNumber,
  normalizeRowGeneric,
  mergeRows as mergeRowsShared,
  buildLandRanks,
  landScoreFromRanks,
} from './app-shared.js';

// Demo data now lives in data/land.json

// Alpine app factory
export function appLand() {
  const storageKey = storageKeyFor('land');
  const normalizeRow = (raw) =>
    normalizeRowGeneric(raw, {
      strings: ['State', 'County', 'Town', 'Parcel', 'Link', 'Note'],
      numbers: ['Acres', 'Price', 'WaterProximity', 'Lat', 'Lon', 'CommuteMin', 'Joy'],
      booleans: ['Walkable', 'WaterVibe'],
      lowerTags: true,
    });

  return {
    // State
    rows: [],
    activeTab: 'inbox',
    filters: { search: '', state: '', water: '', minAcres: null, maxPrice: null },
    selectedIds: new Set(),
    modals: { add: false, bulk: false },
    exportsOpen: false,
    form: { State: '', County: '', Town: '', Parcel: '', Acres: null, Price: null, WaterProximity: null, Link: '', Lat: null, Lon: null, Note: '', CommuteMin: null, Walkable: null, WaterVibe: null, Joy: null },
    bulk: { raw: '', preview: [], headers: [] },

    // Map
    map: null,
    markersLayer: null,
    idToMarker: new Map(),
    activeId: null,
    pinCount: 0,

    // Finance calculator state (same visuals/logic as before)
    finance: {
      state: 'MA',
      price: null,
      downPercent: 20,
      ratePercent: 6.5,
      termYears: 30,
      taxRatePercent: 1.2,
      insuranceMonthly: 80,
      hoaMonthly: 0,
    },
    defaultTaxRateByState: { CT: 1.8, MA: 1.1, ME: 1.3, NH: 1.9, RI: 1.6, VT: 1.6 },

    // Utilities
    fmt,
    ppa,
    waterLabel,

    // Init
    init() {
      // Load
      this.rows = loadFromStorage(storageKey, normalizeRow);
      // Also merge from local JSON file if present
      this.loadExternalJson();
      // Map after DOM
      this.$nextTick(() => {
        this.initMap();
        this.refreshMarkers();
      });
      this.$watch('rows', () => {
        saveToStorage(storageKey, this.rows);
        this.debounce(() => this.refreshMarkers());
      });
      this.$watch('filters', () => this.debounce(() => this.refreshMarkers()), { deep: true });
      this.$watch('activeTab', () => this.debounce(() => this.refreshMarkers()));
    },

    // Debounce
    _debounceTimer: null,
    debounce(fn, ms = 150) { clearTimeout(this._debounceTimer); this._debounceTimer = setTimeout(fn, ms); },

    // Load additional rows from /data/land.json and merge into localStorage rows
    async loadExternalJson() {
      try {
        const res = await fetch('data/land.json', { cache: 'no-store' });
        if (!res.ok) return;
        const arr = await res.json();
        if (!Array.isArray(arr)) return;
        this.rows = mergeRowsShared(this.rows, arr, normalizeRow);
      } catch (_e) { /* ignore */ }
    },

    isNewEngland(row) {
      const s = (row.State || '').toUpperCase();
      return ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'].includes(s);
    },

    // Filtering + computed
    tabPredicate(row) {
      const tag = (row.Tag || '').toLowerCase();
      if (this.activeTab === 'inbox') return tag === '' || tag === 'inbox';
      if (this.activeTab === 'shortlist') return ['shortlist', 'offer', 'visit'].includes(tag);
      if (this.activeTab === 'watch') return ['watch', 'hold'].includes(tag);
      if (this.activeTab === 'archived') return ['archived', 'skip'].includes(tag);
      return true;
    },

    filtered() {
      const q = (this.filters.search || '').toLowerCase();
      return this.rows.filter((row) => {
        if (!this.tabPredicate(row)) return false;
        if (this.filters.state && row.State !== this.filters.state) return false;
        if (this.filters.water === 'adjacent') { if (!(row.WaterProximity === 0)) return false; }
        else if (this.filters.water === 'near') { if (!(row.WaterProximity !== null && row.WaterProximity <= 900)) return false; }
        if (this.filters.minAcres != null && row.Acres != null && row.Acres < this.filters.minAcres) return false;
        if (this.filters.maxPrice != null && row.Price != null && row.Price > this.filters.maxPrice) return false;
        if (q) { const hay = [row.Town, row.Parcel, row.Note].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
        return true;
      });
    },

    // Location Fit fields and composite scoring
    computeLocScore(row) {
      const commuteMin = toNumber(row.CommuteMin);
      const walkable = row.Walkable === true ? 1 : row.Walkable === false ? 0 : 0.5; // neutral if missing
      const joy = toNumber(row.Joy);
      const joyScaled = joy != null ? Math.max(0, Math.min(5, joy)) / 5 : 0.5; // neutral
      const commutePenalty = Math.min(commuteMin ?? 90, 90) / 180; // neutral if missing
      const waterVibeBoost = row.WaterVibe === true ? 0.05 : 0; // small nudge
      const loc = 0.6 * joyScaled + 0.4 * walkable - commutePenalty + waterVibeBoost;
      return loc;
    },

    filteredSorted() {
      const cur = this.filtered();
      const ranks = buildLandRanks(cur);
      const n = cur.length || 1;
      const arr = cur.map((r) => {
        const landScore = landScoreFromRanks(r, ranks, n);
        r._score = landScore; // keep original
        const locScore = this.computeLocScore(r);
        const composite = 0.7 * landScore + 0.3 * (1 - locScore);
        r._score_display = composite;
        return { row: r, s: composite };
      });
      arr.sort((a, b) => a.s - b.s || (this.ppa(a.row) ?? Infinity) - (this.ppa(b.row) ?? Infinity));
      return arr.map((x) => x.row);
    },

    counts() {
      const c = { inbox: 0, visit: 0, watch: 0, offer: 0, skip: 0 };
      for (const r of this.rows) {
        const t = (r.Tag || '').toLowerCase();
        if (t === '' || t === 'inbox') c.inbox++;
        if (t === 'visit') c.visit++;
        if (t === 'watch') c.watch++;
        if (t === 'offer') c.offer++;
        if (t === 'skip') c.skip++;
      }
      return c;
    },

    uniqueStates() {
      const set = new Set(this.rows.map((r) => r.State).filter(Boolean));
      return Array.from(set).sort();
    },

    // Map
    initMap() {
      const NE_BOUNDS = L.latLngBounds([[40.9, -74.5], [47.6, -66.7]]);
      this.map = L.map('map', { zoomControl: true, attributionControl: true, maxBounds: NE_BOUNDS.pad(0.05), maxBoundsViscosity: 0.6 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
      this.map.fitBounds(NE_BOUNDS, { padding: [30, 30] });
    },

    markerColor(tag) {
      const t = (tag || '').toLowerCase();
      if (t === 'offer') return tailwind.theme.extend.colors.marker.offer;
      if (t === 'visit') return tailwind.theme.extend.colors.marker.visit;
      if (t === 'skip') return tailwind.theme.extend.colors.marker.skip;
      if (t === 'hold') return tailwind.theme.extend.colors.marker.hold;
      if (t === 'watch') return tailwind.theme.extend.colors.marker.watch;
      if (t === 'shortlist') return tailwind.theme.extend.colors.marker.shortlist;
      if (t === 'archived') return tailwind.theme.extend.colors.marker.archived;
      return tailwind.theme.extend.colors.marker.default;
    },

    refreshMarkers() {
      if (!this.map || !this.markersLayer) return;
      this.markersLayer.clearLayers();
      this.idToMarker.clear();
      const rows = this.filteredSorted().filter((r) => this.hasCoords(r) && this.isNewEngland(r) && (r.Tag || '').toLowerCase() === 'shortlist');
      this.pinCount = rows.length;
      const bounds = [];
      for (const r of rows) {
        const color = this.markerColor(r.Tag);
        const marker = L.circleMarker([r.Lat, r.Lon], {
          radius: this.activeId === r.id ? 9 : 6,
          color,
          fillColor: color,
          weight: this.activeId === r.id ? 3 : 1.5,
          fillOpacity: 0.75,
        });
        const popupHtml = `
          <div class="text-sm">
            <div class="font-semibold">${escapeHtml(r.Town)} — ${escapeHtml(r.Parcel)}</div>
            <div>${escapeHtml(fmt.number(r.Acres))} acres · ${escapeHtml(fmt.currency(r.Price))}</div>
            <div>Water: ${escapeHtml(waterLabel(r.WaterProximity))}</div>
            <div>Tag: ${escapeHtml((r.Tag || '').toLowerCase())}</div>
            ${r.Link ? `<div><a href="${escapeHtml(r.Link)}" target="_blank" class="text-indigo-600 underline">Link</a></div>` : ''}
          </div>`;
        marker.bindPopup(popupHtml);
        marker.on('click', () => {
          this.activeId = r.id;
          this.$nextTick(() => this.refreshMarkers());
          this.$nextTick(() => {
            const el = document.querySelector(`tr[aria-row-id="${r.id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
        marker.addTo(this.markersLayer);
        this.idToMarker.set(r.id, marker);
        bounds.push([r.Lat, r.Lon]);
      }
      if (bounds.length > 0) {
        try {
          const b = L.latLngBounds(bounds);
          if (!this.map.getBounds().pad(-0.2).contains(b)) this.map.fitBounds(b, { padding: [30, 30] });
        } catch {}
      }
    },

    centerOnRow(row) {
      if (!this.hasCoords(row)) return;
      this.activeId = row.id;
      const m = this.idToMarker.get(row.id);
      if (m) {
        this.map.flyTo(m.getLatLng(), Math.max(this.map.getZoom(), 13), { duration: 0.6 });
        m.openPopup();
      }
      this.refreshMarkers();
    },

    hasCoords(r) { return r.Lat !== null && r.Lon !== null && isFinite(r.Lat) && isFinite(r.Lon); },

    // Import/Export
    importCsv(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const rows = (res.data || []).map((r) => ({
            State: r.State,
            County: r.County,
            Town: r.Town,
            Parcel: r.Parcel,
            Acres: r.Acres,
            Price: r.Price,
            WaterProximity: r.WaterProximity,
            Link: r.Link,
            Lat: r.Lat,
            Lon: r.Lon,
            Tag: r.Tag,
            Note: r.Note,
            CommuteMin: r.CommuteMin,
            Walkable: r.Walkable,
            WaterVibe: r.WaterVibe,
            Joy: r.Joy,
          }));
          this.rows = mergeRowsShared(this.rows, rows, normalizeRow);
          e.target.value = '';
        },
        error: (err) => { alert('Failed to import CSV' + (err?.message ? ': ' + err.message : '')); e.target.value = ''; },
      });
    },

    importJson(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arr = JSON.parse(String(reader.result || '[]'));
          if (!Array.isArray(arr)) throw new Error('Invalid JSON: expected array');
          this.rows = mergeRowsShared(this.rows, arr, normalizeRow);
        } catch (err) {
          alert('Failed to import JSON' + (err?.message ? ': ' + err.message : ''));
        } finally { e.target.value = ''; }
      };
      reader.readAsText(file);
    },

    exportCsv() {
      const headers = ['State','County','Town','Parcel','Acres','Price','WaterProximity','Link','Lat','Lon','Tag','Note','CommuteMin','Walkable','WaterVibe','Joy'];
      const data = this.filteredSorted().map((r) => ({
        State: r.State, County: r.County, Town: r.Town, Parcel: r.Parcel,
        Acres: r.Acres ?? '', Price: r.Price ?? '', WaterProximity: r.WaterProximity ?? '',
        Link: r.Link || '', Lat: r.Lat ?? '', Lon: r.Lon ?? '', Tag: r.Tag ?? '', Note: r.Note ?? '',
        CommuteMin: r.CommuteMin ?? '', Walkable: r.Walkable ?? '', WaterVibe: r.WaterVibe ?? '', Joy: r.Joy ?? ''
      }));
      const csv = Papa.unparse({ fields: headers, data: data.map((d) => headers.map((h) => d[h])) });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'scout_filtered.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    },

    exportJson() {
      const data = this.filteredSorted().map((r) => ({
        State: r.State, County: r.County, Town: r.Town, Parcel: r.Parcel,
        Acres: r.Acres ?? null, Price: r.Price ?? null, WaterProximity: r.WaterProximity ?? null,
        Link: r.Link || '', Lat: r.Lat ?? null, Lon: r.Lon ?? null, Tag: r.Tag || 'inbox', Note: r.Note || '',
        CommuteMin: r.CommuteMin ?? null, Walkable: r.Walkable ?? null, WaterVibe: r.WaterVibe ?? null, Joy: r.Joy ?? null,
      }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'agscout_filtered.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    },

    exportPdf() {
      try {
        const rows = this.filteredSorted();
        const headers = ['State','County','Town','Parcel','Acres','Price','$ / acre','Water','Tag','LocScore','Composite'];
        const body = rows.map((r) => [
          r.State, r.County, r.Town, r.Parcel,
          fmt.number(r.Acres), fmt.currency(r.Price), fmt.currency(this.ppa(r)),
          waterLabel(r.WaterProximity), (r.Tag || '').toLowerCase(),
          fmt.score(this.computeLocScore(r)), fmt.score(r._score_display ?? r._score)
        ]);
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDF || !('autoTable' in (jsPDF.API || {}))) { alert('PDF libraries not loaded'); return; }
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
        doc.setFontSize(12); doc.text('AGSCOUT — Filtered Parcels', 40, 36);
        doc.autoTable({ head: [headers], body, startY: 50, styles: { fontSize: 8 } });
        doc.save('agscout_filtered.pdf');
      } catch (e) { alert('Failed to export PDF' + (e?.message ? ': ' + e.message : '')); }
    },

    // Add
    openAdd() {
      this.form = { State: '', County: '', Town: '', Parcel: '', Acres: null, Price: null, WaterProximity: null, Link: '', Lat: null, Lon: null, Note: '', CommuteMin: null, Walkable: null, WaterVibe: null, Joy: null };
      this.modals.add = true;
      this.$nextTick(() => document.querySelector('[x-model="form.State"]')?.focus());
    },
    submitAdd() {
      const r = normalizeRow({ ...this.form, Tag: 'inbox' });
      this.rows = mergeRowsShared(this.rows, [r], normalizeRow);
      this.modals.add = false;
    },

    // Bulk
    openBulk() { this.bulk = { raw: '', preview: [], headers: [] }; this.modals.bulk = true; },
    bulkPreview() {
      const text = this.bulk.raw || '';
      if (!text.trim()) { this.bulk.preview = []; this.bulk.headers = []; return; }
      const res = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = res.data || [];
      const headers = res.meta?.fields || Object.keys(rows[0] || {});
      this.bulk.preview = rows; this.bulk.headers = headers;
    },
    bulkCommit() {
      if (this.bulk.preview.length === 0) return;
      this.rows = mergeRowsShared(this.rows, this.bulk.preview, normalizeRow);
      this.modals.bulk = false; this.bulk = { raw: '', preview: [], headers: [] };
    },

    // Bulk move
    bulkMove(target) {
      const toTag = target === 'shortlist' ? 'shortlist' : target === 'watch' ? 'watch' : 'archived';
      for (const r of this.rows) { if (this.selectedIds.has(r.id)) r.Tag = toTag; }
      this.selectedIds.clear();
    },

    toggleShortlist(row) { row.Tag = row.Tag === 'shortlist' ? 'inbox' : 'shortlist'; this.onRowChanged(row); },
    onRowChanged(_row) { saveToStorage(storageKey, this.rows); this.debounce(() => this.refreshMarkers()); },
    quickTag(row, tag) { row.Tag = String(tag || '').toLowerCase(); this.onRowChanged(row); },
    toggleSelect(id, e) { if (e.target.checked) this.selectedIds.add(id); else this.selectedIds.delete(id); },
    toggleSelectAll(e) { if (e.target.checked) { for (const r of this.filteredSorted()) this.selectedIds.add(r.id); } else { this.selectedIds.clear(); } },

    // Finance helpers
    setFinanceArea(state) { this.finance.state = state; const tax = this.defaultTaxRateByState[state]; if (tax != null) this.finance.taxRatePercent = tax; },
    loanAmount() { const price = Number(this.finance.price); const down = Number(this.finance.downPercent); if (!isFinite(price) || !isFinite(down)) return 0; const dp = Math.max(0, Math.min(100, down)); return Math.max(0, price * (1 - dp / 100)); },
    monthlyPI() { const principal = this.loanAmount(); const annualRate = Number(this.finance.ratePercent) / 100; const months = Math.max(1, Math.round(Number(this.finance.termYears) * 12)); if (!isFinite(principal) || principal <= 0 || !isFinite(annualRate) || months <= 0) return 0; const r = annualRate / 12; if (r === 0) return principal / months; return principal * (r / (1 - Math.pow(1 + r, -months))); },
    monthlyTaxes() { const price = Number(this.finance.price); const taxRate = Number(this.finance.taxRatePercent) / 100; if (!isFinite(price) || !isFinite(taxRate) || price <= 0 || taxRate < 0) return 0; return (price * taxRate) / 12; },
    monthlyTotal() { const pi = this.monthlyPI(); const taxes = this.monthlyTaxes(); const ins = Number(this.finance.insuranceMonthly) || 0; const hoa = Number(this.finance.hoaMonthly) || 0; return pi + taxes + ins + hoa; },
    totalInterest() { const m = this.monthlyPI(); const principal = this.loanAmount(); const months = Math.max(1, Math.round(Number(this.finance.termYears) * 12)); if (m <= 0 || principal <= 0) return 0; return m * months - principal; },

    // UI actions from land.html header
    async loadSheet1() { await this.loadExternalJson(); },
    async loadSheet2() { await this.loadExternalJson(); },
    async loadSheet3() { await this.loadExternalJson(); },
    async loadDemo() { await this.loadExternalJson(); },
    clearAll() { this.rows = []; this.selectedIds.clear(); saveToStorage(storageKey, this.rows); this.refreshMarkers(); },
  };
}

// Wire into Alpine on page load
document.addEventListener('alpine:init', () => {
  // Finance calculator is encapsulated in the same module for convenience
  window.financeApp = function financeApp() {
    return {
      fmt,
      finance: { state: 'MA', price: null, downPercent: 20, ratePercent: 6.5, termYears: 30, taxRatePercent: 1.2, insuranceMonthly: 80, hoaMonthly: 0 },
      defaultTaxRateByState: { CT: 1.8, MA: 1.1, ME: 1.3, NH: 1.9, RI: 1.6, VT: 1.6 },
      setFinanceArea(state) { this.finance.state = state; const tax = this.defaultTaxRateByState[state]; if (tax != null) this.finance.taxRatePercent = tax; },
      loanAmount() { const price = Number(this.finance.price); const down = Number(this.finance.downPercent); if (!isFinite(price) || !isFinite(down)) return 0; const dp = Math.max(0, Math.min(100, down)); return Math.max(0, price * (1 - dp / 100)); },
      monthlyPI() { const principal = this.loanAmount(); const annualRate = Number(this.finance.ratePercent) / 100; const months = Math.max(1, Math.round(Number(this.finance.termYears) * 12)); if (!isFinite(principal) || principal <= 0 || !isFinite(annualRate) || months <= 0) return 0; const r = annualRate / 12; if (r === 0) return principal / months; return principal * (r / (1 - Math.pow(1 + r, -months))); },
      monthlyTaxes() { const price = Number(this.finance.price); const taxRate = Number(this.finance.taxRatePercent) / 100; if (!isFinite(price) || !isFinite(taxRate) || price <= 0 || taxRate < 0) return 0; return (price * taxRate) / 12; },
      monthlyTotal() { const pi = this.monthlyPI(); const taxes = this.monthlyTaxes(); const ins = Number(this.finance.insuranceMonthly) || 0; const hoa = Number(this.finance.hoaMonthly) || 0; return pi + taxes + ins + hoa; },
      totalInterest() { const m = this.monthlyPI(); const principal = this.loanAmount(); const months = Math.max(1, Math.round(Number(this.finance.termYears) * 12)); if (m <= 0 || principal <= 0) return 0; return m * months - principal; },
    };
  };
  Alpine.data('app', appLand);
});


