(function(){
  const CACHE = { stats: null };

  function ppa(row){
    const price = Number(row?.Price);
    const acres = Number(row?.Acres);
    if (!isFinite(price) || !isFinite(acres) || acres <= 0 || price <= 0) return null;
    return price / acres;
  }

  function inferRegion(row){
    const town = String(row?.Town || '').toLowerCase();
    const county = String(row?.County || '').toLowerCase();
    const state = String(row?.State || '').toUpperCase();
    // Manual buckets by town names
    const townToRegion = new Map([
      ['monterey','Berkshires (Western MA)'],
      ['sheffield','Berkshires (Western MA)'],
      ['becket','Berkshires (Western MA)'],
      ['hinsdale','Hilltowns (MA)'],
      ['savoy','Hilltowns (MA)'],
      ['cummington','Hilltowns (MA)'],
      ['northampton','Pioneer Valley (MA)'],
      ['amherst','Pioneer Valley (MA)'],
      ['hadley','Pioneer Valley (MA)'],
      ['easthampton','Pioneer Valley (MA)'],
      ['torrington','Litchfield Hills (CT)'],
      ['kent','Litchfield Hills (CT)'],
      ['new milford','Litchfield Hills (CT)'],
      ['sharon','Litchfield Hills (CT)'],
    ]);
    const hit = townToRegion.get(town);
    if (hit) return hit;
    if (state === 'MA' && county === 'berkshire') return 'Berkshires (Western MA)';
    if (state === 'CT' && county === 'litchfield') return 'Litchfield Hills (CT)';
    // fallback by state to a unique region if any
    const regions = Object.keys(CACHE.stats || {});
    const byStateGuess = regions.find(r => (r.includes('(MA)') && state==='MA') || (r.includes('(CT)') && state==='CT'));
    return byStateGuess || null;
  }

  async function loadRegionStats(){
    if (CACHE.stats) return CACHE.stats;
    try {
      const res = await fetch('data/region_acre_stats.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const json = await res.json();
      CACHE.stats = (json && typeof json === 'object') ? json : {};
    } catch { CACHE.stats = {}; }
    return CACHE.stats;
  }

  function percentileRank(value, p25, p75){
    if (!isFinite(value) || !isFinite(p25) || !isFinite(p75) || p75 <= p25) return null;
    if (value <= p25) return 10; // bottom decile-ish
    if (value >= p75) return 90; // top decile-ish
    const span = p75 - p25;
    const pos = (value - p25) / span; // 0..1
    return Math.round(25 + pos * 50); // map to 25..75 for mid-range
  }

  function analyzeProperty(row, regionStats){
    const v = ppa(row);
    const regionName = inferRegion(row);
    const stats = regionName ? regionStats[regionName] : null;
    const median = Number(stats?.median_ppacre) || null;
    const p25 = Number(stats?.p25) || null;
    const p75 = Number(stats?.p75) || null;
    const pr = (median && v!=null) ? percentileRank(v, p25, p75) : null;

    let badge = null;
    let badgeColor = 'bg-gray-100 text-gray-700';
    let detail = '';

    if (median && v!=null) {
      const diffPct = ((median - v) / median) * 100;
      if (p25 && v < p25) { badge = '👍 undervalued'; badgeColor = 'bg-green-100 text-green-800'; }
      else if (p75 && v > p75) { badge = '🚫 overpriced'; badgeColor = 'bg-red-100 text-red-800'; }
      else { badge = '👀 fair value'; badgeColor = 'bg-yellow-100 text-yellow-800'; }
      detail = `${badge.includes('undervalued') ? 'Undervalued' : badge.includes('overpriced') ? 'Overpriced' : 'Near median'} vs ${regionName || 'region'} by ${Math.abs(Math.round(diffPct))}%`;
    }

    let score = null, signal = null;
    if (median && v!=null && median > 0) {
      score = ((median - v) / median) * 100;
      if (score > 25) signal = 'Strong Buy Signal';
      else if (score >= 5) signal = 'Watch';
      else signal = 'Pass';
    }

    // color scale for $/acre vs median
    let ppaColor = '';
    if (median && v!=null) {
      const delta = (v - median) / median;
      if (delta <= 0) ppaColor = 'text-green-700';
      else if (Math.abs(delta) <= 0.15) ppaColor = 'text-yellow-700';
      else ppaColor = 'text-red-700';
    }

    return { regionName, median, p25, p75, percentile: pr, badge, badgeColor, detail, score, signal, valuePpa: v, ppaColor };
  }

  window.acreAnalysis = { loadRegionStats, analyzeProperty, inferRegion, ppa };
})();
