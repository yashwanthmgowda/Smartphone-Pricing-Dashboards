/* Smartphone price tracker: a static page that reads data/prices.json.
 *
 * Every row in prices.json is one variant in one month:
 *   { key, seq, brand, model, variant, month: "YYYY-MM", mop, rp, other, note, source }
 * mop = minimum operating price, rp = DP/RP (retailer price). Either can be null.
 * Months are added by scripts/add_month.py; this file needs no change when they are.
 */
(() => {
  'use strict';

  // Price segments are based on each variant's latest MOP. A band includes its
  // lower value and stops just below its upper value (15k-20k = 15,000 to 19,999).
  const BANDS = [
    [10000, '<10k'], [15000, '10k-15k'], [20000, '15k-20k'], [25000, '20k-25k'],
    [30000, '25k-30k'], [40000, '30k-40k'], [60000, '40k-60k'], [Infinity, '60k+'],
  ];
  const NO_MOP = 'No MOP';
  const SEGMENTS = BANDS.map((b) => b[1]).concat(NO_MOP);
  const segmentIndex = (mop) => (mop == null ? BANDS.length : BANDS.findIndex((b) => mop < b[0]));

  const $ = (s) => document.querySelector(s);
  const nf = new Intl.NumberFormat('en-IN');
  const money = (v) => (v == null ? '' : nf.format(v));
  const change = (v) => (v == null ? '' : v === 0 ? '0' : (v > 0 ? '▲ ' : '▼ ') + nf.format(Math.abs(v)));
  const byText = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  const monthLabel = (m) => {
    const [y, mo] = m.split(/[-_]/);
    return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  // ---- data ---------------------------------------------------------------

  function summarise(prices) {
    const months = [...new Set(prices.map((r) => r.month))].sort();
    const last = months[months.length - 1];
    const cur = prices.filter((r) => r.month === last);
    return {
      months,
      last,
      variants: cur.length,
      brands: new Set(cur.map((r) => r.brand)).size,
      withMop: cur.filter((r) => r.mop != null).length,
      withRp: cur.filter((r) => r.rp != null).length,
    };
  }

  // One row per brand/model/variant with every month's prices, the latest of
  // each, the change from the previous month that had a price, and its segment.
  function buildPivot(prices) {
    const months = [...new Set(prices.map((r) => r.month))].sort();
    const mk = months.map((m) => m.replace('-', '_'));
    const by = new Map();
    const latestRow = new Map();
    for (const r of prices) {
      if (!by.has(r.key)) {
        const o = { key: r.key, seq: r.seq, brand: r.brand, model: r.model, variant: r.variant, other: '', note: '' };
        mk.forEach((m) => { o['mop_' + m] = null; o['rp_' + m] = null; });
        by.set(r.key, o);
      }
      const o = by.get(r.key);
      const m = r.month.replace('-', '_');
      o['mop_' + m] = r.mop;
      o['rp_' + m] = r.rp;
      const prev = latestRow.get(r.key);
      if (!prev || r.month > prev.month) latestRow.set(r.key, r);
    }
    const out = [];
    for (const o of by.values()) {
      for (const f of ['mop', 'rp']) {
        const vals = mk.map((m) => o[f + '_' + m]).filter((v) => v != null);
        o['latest_' + f] = vals.length ? vals[vals.length - 1] : null;
        o['chg_' + f] = vals.length > 1 ? vals[vals.length - 1] - vals[vals.length - 2] : null;
      }
      const idx = segmentIndex(o.latest_mop);
      o.segment = SEGMENTS[idx];
      o.seg_order = idx + 1;
      const lr = latestRow.get(o.key);
      o.other = lr.other || '';
      o.note = lr.note || '';
      out.push(o);
    }
    return { months: mk, rows: out };
  }

  function buildSegments(pivotRows) {
    const out = SEGMENTS.map((segment, i) => ({ segment, seg_order: i + 1, variants: 0, brands: new Set() }));
    pivotRows.forEach((r) => {
      const o = out[r.seg_order - 1];
      o.variants += 1;
      o.brands.add(r.brand);
    });
    return out.map((o) => ({
      segment: o.segment,
      variants: o.variants,
      brands: o.brands.size,
      brand_list: [...o.brands].sort(byText).join(', '),
    }));
  }

  // ---- state and rendering ------------------------------------------------

  const state = { view: 'brand', brand: '', segment: '', q: '', hide: false, sort: 'brand', dir: 1 };
  let pivot = { months: [], rows: [] };
  let segmentRows = [];

  const brandSel = $('.pt-brand'), segSel = $('.pt-seg'), search = $('.pt-search'), hide = $('.pt-hide');
  const thead = $('.pt-hr'), tbody = $('.pt-body'), msg = $('.pt-msg'), mainTable = $('.pt-main');

  function columns() {
    const months = pivot.months;
    const lead = state.view === 'segment'
      ? [{ f: 'segment', label: 'Price segment' }, { f: 'brand', label: 'Brand' }, { f: 'model', label: 'Model' }, { f: 'variant', label: 'Variant' }]
      : [{ f: 'brand', label: 'Brand' }, { f: 'model', label: 'Model' }, { f: 'variant', label: 'Variant' }, { f: 'segment', label: 'Price segment' }];
    const cols = [
      ...lead,
      { f: 'latest_rp', label: 'Latest DP/RP', num: true, fmt: money },
      { f: 'latest_mop', label: 'Latest MOP', num: true, fmt: money },
    ];
    if (months.length > 1) {
      cols.push({ f: 'chg_rp', label: 'DP/RP vs previous', num: true, fmt: change });
      cols.push({ f: 'chg_mop', label: 'MOP vs previous', num: true, fmt: change });
    }
    months.forEach((m) => {
      cols.push({ f: 'rp_' + m, label: 'DP/RP', sub: monthLabel(m), num: true, fmt: money });
      cols.push({ f: 'mop_' + m, label: 'MOP', sub: monthLabel(m), num: true, fmt: money });
    });
    cols.push({ f: 'other', label: 'Other prices in the list (latest)', muted: true });
    return cols;
  }

  function cmp(a, b, f) {
    const x = a[f], y = b[f];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return byText(String(x), String(y));
  }

  function drawMain() {
    thead.replaceChildren();
    tbody.replaceChildren();
    msg.hidden = true;
    const cols = columns();
    cols.forEach((c) => {
      const th = document.createElement('th');
      if (c.num) th.className = 'num';
      th.setAttribute('aria-sort', state.sort === c.f ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      const b = document.createElement('button');
      b.className = 'pt-th';
      b.type = 'button';
      b.dataset.sort = c.f;
      if (c.sub) {
        const s = document.createElement('small');
        s.textContent = c.sub;
        b.append(s);
      }
      b.append(document.createTextNode(c.label + (state.sort === c.f ? (state.dir > 0 ? ' ↑' : ' ↓') : '')));
      th.append(b);
      thead.append(th);
    });

    const q = state.q.trim().toLowerCase();
    let list = pivot.rows.filter((r) => {
      if (state.brand && r.brand !== state.brand) return false;
      if (state.segment && r.segment !== state.segment) return false;
      if (q && !(r.brand + ' ' + r.model + ' ' + r.variant).toLowerCase().includes(q)) return false;
      if (state.hide && r.latest_mop == null && r.latest_rp == null) return false;
      return true;
    });
    const s = state.sort;
    list = list.slice().sort((a, b) => {
      const c = s === 'segment'
        ? cmp(a, b, 'seg_order') || cmp(a, b, 'latest_mop') || cmp(a, b, 'brand')
        : cmp(a, b, s);
      return (c || cmp(a, b, 'seq')) * state.dir;
    });

    const frag = document.createDocumentFragment();
    list.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.key;
      if (r.note) { tr.className = 'pt-flagged'; tr.title = r.note; }
      cols.forEach((c) => {
        const td = document.createElement('td');
        if (c.num) td.className = 'num';
        else if (c.muted) td.className = 'muted';
        td.textContent = c.fmt ? c.fmt(r[c.f]) : (r[c.f] == null ? '' : String(r[c.f]));
        tr.append(td);
      });
      frag.append(tr);
    });
    tbody.append(frag);
    if (!list.length) {
      msg.hidden = false;
      msg.textContent = 'No rows match these filters.';
    }
  }

  function drawSegments() {
    const body = $('.pt-segs tbody');
    body.replaceChildren();
    segmentRows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.className = 'pt-click';
      tr.dataset.key = r.segment;
      [['segment'], ['variants', 'num'], ['brands', 'num'], ['brand_list', 'wrap']].forEach(([f, cls]) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = String(r[f]);
        tr.append(td);
      });
      body.append(tr);
    });
  }

  function fillSelects(brands) {
    brandSel.replaceChildren(new Option('All brands', ''), ...brands.map((b) => new Option(b, b)));
    segSel.replaceChildren(new Option('All price segments', ''), ...segmentRows.map((r) => new Option(r.segment, r.segment)));
  }

  function syncView() {
    document.querySelectorAll('.pt-view').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    $('#segments').hidden = state.view !== 'segment';
  }

  function wire() {
    document.querySelectorAll('.pt-view').forEach((b) => b.addEventListener('click', () => {
      state.view = b.dataset.view;
      state.sort = state.view === 'segment' ? 'segment' : 'brand';
      state.dir = 1;
      syncView();
      drawMain();
    }));
    brandSel.addEventListener('change', () => { state.brand = brandSel.value; drawMain(); });
    segSel.addEventListener('change', () => { state.segment = segSel.value; drawMain(); });
    search.addEventListener('input', () => { state.q = search.value; drawMain(); });
    hide.addEventListener('change', () => { state.hide = hide.checked; drawMain(); });
    thead.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sort]');
      if (!b) return;
      const f = b.dataset.sort;
      if (state.sort === f) state.dir = -state.dir;
      else { state.sort = f; state.dir = 1; }
      drawMain();
    });
    $('.pt-segs').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (!tr) return;
      state.segment = state.segment === tr.dataset.key ? '' : tr.dataset.key;
      segSel.value = state.segment;
      drawMain();
      $('#prices-table').scrollIntoView({ block: 'start' });
    });
  }

  // ---- start --------------------------------------------------------------

  async function loadJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(url + ' returned ' + res.status);
    return res.json();
  }

  function showError(err) {
    const box = $('#load-error');
    box.hidden = false;
    box.replaceChildren();
    box.append(document.createTextNode('Could not load data/prices.json (' + err.message + '). If you opened index.html straight from disk, serve the folder instead, for example '));
    const code = document.createElement('code');
    code.textContent = 'python3 -m http.server';
    box.append(code, document.createTextNode(' and open http://localhost:8000.'));
    $('#summary-line').textContent = 'No data loaded.';
  }

  async function main() {
    let prices;
    try {
      prices = await loadJson('data/prices.json');
    } catch (err) {
      showError(err);
      return;
    }
    if (!Array.isArray(prices) || !prices.length) {
      showError(new Error('the file is empty'));
      return;
    }

    const sum = summarise(prices);
    $('#tile-variants').textContent = String(sum.variants);
    $('#tile-brands').textContent = String(sum.brands);
    $('#tile-months').textContent = String(sum.months.length);
    $('#summary-line').textContent =
      'MOP and DP/RP from monthly price lists. Latest month: ' + monthLabel(sum.last) + '. ' +
      sum.withMop + ' of ' + sum.variants + ' variants have a MOP and ' + sum.withRp +
      ' have a DP/RP; the rest are blank because the list did not give one.';

    pivot = buildPivot(prices);
    segmentRows = buildSegments(pivot.rows);
    const latestBrands = [...new Set(prices.filter((r) => r.month === sum.last).map((r) => r.brand))].sort(byText);
    fillSelects(latestBrands);
    wire();
    syncView();
    drawSegments();
    drawMain();
  }

  main();
})();
