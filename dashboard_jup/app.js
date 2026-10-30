'use strict';
/* ==========================================================================
   IPD สิทธิบัตรทอง – Dashboard (app.js)
   0. CONFIG / STATE / HELPERS      5. TREND CHART (SVG)
   1. DATA LOADING                   6. NEON TREEMAP
   2. SCOPE + KPI + ROLLING NUMBERS 7. REFERRAL ROUTING
   3. MAP (Leaflet + GeoJSON)        8. DATA AUDIT
   4. PROVINCE PANEL + RANKING       9. TOAST NOTIFICATIONS
   ========================================================================== */

// -----------------------------------------------------------------------------
// 0. CONFIG / STATE / HELPERS
// -----------------------------------------------------------------------------
const CONFIG = {
  DATA_URL: 'ipd_dashboard_data.json',
  MOPH_URL: 'hosp_moph_top150.json',
  GEOJSON_URL: 'thailand_provinces.geojson',
  // ถ้า thailand_geojson.js ของคุณใช้ชื่อตัวแปรเฉพาะ ใส่ชื่อไว้ตรงนี้ได้เลย เช่น 'myThaiMap'
  GEOJSON_VAR: '',
  GEOJSON_VARS: ['thailandGeoJSON', 'thailand_geojson', 'thailandGeojson', 'thailandProvinces', 'thailand_provinces',
                 'thaiProvinces', 'provincesGeoJSON', 'provinceGeoJSON', 'geojsonData', 'geoData', 'GEOJSON', 'geojson', 'data'],
  NATIONAL_BOUNDS: [[5.55, 97.3], [20.55, 105.7]],
  TILE_URL: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', // ฟรี ไม่ต้องใช้ API key
};

const S = {
  data: null, moph: null,
  hospitals: [], hospOrig: [], issues: new Map(),
  fy: 2567, q: 0, region: 'all', metric: 'cases',
  province: null, disease: null, gran: 'quarter', tab: 'overview',
  audit: { filter: 'all', rule: null, q: '', page: 1, sortKey: 'sev', sortDir: 1 },
  ref: { hcode: null, status: 'all', q: '', prov: null, occupancy: new Map(), occupancyFileName: null },
  geoFC: null, zoneSort: 'cases'
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtC = n => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n)); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monthLabel = ym => TH_MONTHS[+ym.slice(4) - 1] + ' ' + String(+ym.slice(0, 4) + 543).slice(2);
const daysInYM = ym => new Date(+ym.slice(0, 4), +ym.slice(4), 0).getDate();

function roundFloat(val, dec = 1) { return parseFloat(Number(val).toFixed(dec)); }
const shortName = s => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const HALLOWEEN = {
  pumpkin: '#ff7518', purple: '#8b5cf6', slime: '#a3e635',
  purpleDark: '#3b2060', purpleMid: '#6d28d9', orangeDark: '#c2410c',
  text: '#f5ecff', muted: '#c4b5d5', grid: 'rgba(196,181,213,0.18)'
};
const DIS_COL = {
  A09: HALLOWEEN.purple, H25: '#a78bfa', J18: HALLOWEEN.pumpkin, J44: '#c084fc',
  D56: '#d8b4fe', I25: HALLOWEEN.pumpkin, O80: '#7c3aed', N18: HALLOWEEN.pumpkin,
  E11: HALLOWEEN.slime, I50: '#c2410c', I63: HALLOWEEN.pumpkin, S06: HALLOWEEN.pumpkin,
  N39: '#a78bfa', J20: '#c4b5fd', R50: '#a3e635', J12: '#8b5cf6',
  K35: HALLOWEEN.slime, I21: '#c2410c', J15: '#c4b5fd', K29: '#fdba74', L03: '#fed7aa'
};
const disColor = d => DIS_COL[d.pdx] || d.color || HALLOWEEN.muted;

// ---- Rolling numbers (หมุนสล็อตจาก 0 ถึงค่าจริง) ----
function rollTo(el, text, dur = 900, force = false) {
  if (!el) return;
  text = String(text);
  if (!force && el.dataset.rolled === text) return;
  el.dataset.rolled = text;
  el.setAttribute('aria-label', text);
  el.classList.add('roll');
  el.innerHTML = '';
  const digits = [];
  [...text].forEach(ch => {
    if (/[0-9]/.test(ch)) {
      const col = document.createElement('span'); col.className = 'rd';
      const strip = document.createElement('span'); strip.className = 'rd-strip';
      for (let k = 0; k < 20; k++) { const i = document.createElement('i'); i.textContent = k % 10; strip.appendChild(i); }
      col.appendChild(strip); el.appendChild(col); digits.push({ strip, d: +ch });
    } else {
      const c = document.createElement('span'); c.className = 'rc'; c.textContent = ch; el.appendChild(c);
    }
  });
  const target = d => `translateY(calc(var(--lh) * -${10 + d}))`;
  if (reduceMotion || document.hidden) { digits.forEach(({ strip, d }) => { strip.style.transform = target(d); }); return; }
  digits.forEach(({ strip }) => { strip.style.transition = 'none'; strip.style.transform = 'translateY(0)'; });
  void el.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    digits.forEach(({ strip, d }, i) => {
      strip.style.transition = `transform ${dur + i * 90}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
      strip.style.transform = target(d);
    });
  }));
}
function reRollPane(sel) { $$(sel + ' .roll').forEach(e => rollTo(e, e.getAttribute('aria-label') || '', 900, true)); }

// -----------------------------------------------------------------------------
// 1. DATA LOADING
// -----------------------------------------------------------------------------
async function loadJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

async function boot() {
  try { S.data = await loadJSON(CONFIG.DATA_URL); }
  catch (e) {
    console.warn('fetch ล้มเหลว (เปิดแบบ file:// ?)', e);
    $('#loader-bar').style.display = 'none';
    $('#loader-msg').textContent = 'อ่านไฟล์อัตโนมัติไม่ได้';
    $('#loader-fallback').classList.add('show');
    bindFileFallback();
    return;
  }
  try { S.moph = await loadJSON(CONFIG.MOPH_URL); } catch (e) { S.moph = null; }
  await start();
}

function bindFileFallback() {
  const read = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { rej(e); } }; r.onerror = rej; r.readAsText(file); });
  $('#file-moph').addEventListener('change', async e => { if (e.target.files[0]) { S.moph = await read(e.target.files[0]); if (S.data && S.hospitals.length) { runAudit(); renderHeaderKPIs(); } } });
  $('#file-ipd').addEventListener('change', async e => {
    if (!e.target.files[0]) return;
    try { S.data = await read(e.target.files[0]); await start(); } catch (err) { showToast('ไฟล์ JSON ไม่ถูกต้อง: ' + err.message, 'warn'); }
  });
}

async function start() {
  const d = S.data;
  S.hospOrig = JSON.parse(JSON.stringify(d.hospitals));
  S.hospitals = JSON.parse(JSON.stringify(d.hospitals));
  $('#app-title').textContent = 'ศูนย์บัญชาการข้อมูลผู้ป่วยใน สิทธิบัตรทอง';
  const dataSource = d.metadata.data_source.replace(/FY\s*(\d{4})\s*-\s*FY\s*(\d{4})/i, 'ปีข้อมูล $1–$2');
  $('#app-sub').textContent = `${d.metadata.sub_title} · ${dataSource}`;
  const sel = $('#f-region');
  Object.values(d.regions).forEach(r => { const o = document.createElement('option'); o.value = r.id; o.textContent = r.name_th; sel.appendChild(o); });
  buildProvIndex();
  const pj = $('#prov-jump');
  Object.entries(d.provinces).sort((a, b) => a[1].name_th.localeCompare(b[1].name_th, 'th')).forEach(([k, p]) => { const o = document.createElement('option'); o.value = k; o.textContent = p.name_th; pj.appendChild(o); });
  pj.addEventListener('change', e => { if (e.target.value) selectProvince(e.target.value); e.target.value = ''; });
  bindUI();
  runAudit();
  await initMap();
  renderAll();
  renderHeaderKPIs();
  const ld = $('#loader'); ld.classList.add('done'); setTimeout(() => ld.remove(), 600);
}

// -----------------------------------------------------------------------------
// 2. SCOPE + PERIOD MATH + KPI
// -----------------------------------------------------------------------------
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
function periodIdx(fy, q) { const base = fy === 2567 ? 12 : 0; return q ? range(base + (q - 1) * 3, base + (q - 1) * 3 + 3) : range(base, base + 12); }
const sumIdx = (arr, idx) => idx.reduce((a, i) => a + (arr[i] || 0), 0);
function forecastMonthly(series, horizon = 6) {
  const values = series.filter(Number.isFinite);
  if (!values.length) return [];
  const n = values.length;
  const pairedMonths = Math.min(6, Math.max(0, n - 12));
  const annualChanges = pairedMonths
    ? range(n - pairedMonths, n).map(i => values[i] - values[i - 12])
    : [];
  const trend = annualChanges.length ? annualChanges.reduce((sum, value) => sum + value, 0) / annualChanges.length : 0;
  const variance = annualChanges.length > 1
    ? annualChanges.reduce((sum, value) => sum + (value - trend) ** 2, 0) / (annualChanges.length - 1)
    : 0;
  const trendStdDev = Math.sqrt(variance);
  const fallback = values.slice(-Math.min(3, n));
  const fallbackTrend = fallback.length > 1 ? (fallback[fallback.length - 1] - fallback[0]) / (fallback.length - 1) : 0;

  return range(1, horizon + 1).map(step => {
    const seasonalIndex = n + step - 1 - 12;
    const baseline = seasonalIndex >= 0 ? values[seasonalIndex] : values[n - 1] + fallbackTrend * step;
    const forecast = Math.max(0, baseline + trend);
    const margin = 1.28 * trendStdDev * Math.sqrt(step);
    return {
      month: S.data.metadata.future_months[n - 24 + step - 1] || '',
      forecast,
      lower: Math.max(0, forecast - margin),
      upper: forecast + margin
    };
  });
}
function forecastRangeLabel() {
  const months = S.data.metadata.future_months;
  return months && months.length
    ? `${monthLabel(months[0])}–${monthLabel(months[Math.min(5, months.length - 1)])}`
    : 'หลังข้อมูลล่าสุด';
}
function forecastBacktestRangeLabel() {
  const months = S.data.metadata.months;
  return months && months.length >= 6
    ? `${monthLabel(months[months.length - 6])}–${monthLabel(months[months.length - 1])}`
    : '6 เดือนล่าสุด';
}
function forecastBacktest() {
  const data = S.data;
  const scopes = [data.national, ...Object.values(data.regions), ...Object.values(data.provinces)];
  const folds = [];
  [12, 18].forEach(origin => {
    let absoluteError = 0, actualTotal = 0, seasonalError = 0, scopeCount = 0;
    scopes.forEach(scope => {
      const series = scope.monthly_series;
      if (series.length < origin + 6) return;
      const predictions = forecastMonthly(series.slice(0, origin));
      scopeCount++;
      for (let i = 0; i < 6; i++) {
        absoluteError += Math.abs(series[origin + i] - predictions[i].forecast);
        seasonalError += Math.abs(series[origin + i] - series[origin + i - 12]);
        actualTotal += series[origin + i];
      }
    });
    if (actualTotal) {
      const months = data.metadata.months;
      folds.push({
        label: `${monthLabel(months[origin])}–${monthLabel(months[origin + 5])}`,
        wape: absoluteError / actualTotal * 100,
        seasonalWape: seasonalError / actualTotal * 100,
        actualTotal,
        scopeCount
      });
    }
  });
  const actualTotal = folds.reduce((sum, fold) => sum + fold.actualTotal, 0);
  return actualTotal ? {
    wape: folds.reduce((sum, fold) => sum + fold.wape * fold.actualTotal, 0) / actualTotal,
    seasonalWape: folds.reduce((sum, fold) => sum + fold.seasonalWape * fold.actualTotal, 0) / actualTotal,
    scopeCount: folds.reduce((sum, fold) => sum + fold.scopeCount, 0),
    folds
  } : null;
}
function cmp(series) {
  const cur = sumIdx(series, periodIdx(S.fy, S.q));
  const prev = S.fy === 2567 ? sumIdx(series, periodIdx(2566, S.q)) : null;
  return { cur, prev, yoy: prev ? (cur / prev - 1) * 100 : null };
}
const pctChange = (cur, prev) => (prev ? (cur / prev - 1) * 100 : null);
const periodLabel = () => `${S.q ? 'Q' + S.q + ' ' : 'ทั้งปี '}ปีข้อมูล ${S.fy}`;
const qRangeTH = q => ['', 'ต.ค.–ธ.ค.', 'ม.ค.–มี.ค.', 'เม.ย.–มิ.ย.', 'ก.ค.–ก.ย.'][q];

function getScope() {
  const d = S.data;
  if (S.province) {
    const p = d.provinces[S.province];
    return { level: 'province', label: p.name_th, series: p.monthly_series, forecast: forecastMonthly(p.monthly_series), diseases: p.top_diseases, total24: p.total_cases, gender: p.gender, ref: p };
  }
  if (S.region !== 'all') {
    const r = d.regions[S.region];
    return { level: 'region', label: r.name_th, series: r.monthly_series, forecast: forecastMonthly(r.monthly_series), diseases: r.top_diseases, total24: r.total_cases, gender: r.gender, ref: r };
  }
  const n = d.national;
  return { level: 'national', label: 'ทั้งประเทศ', series: n.monthly_series, forecast: forecastMonthly(n.monthly_series), diseases: n.top_diseases, total24: n.total_cases, gender: n.gender, ref: n };
}
function hospInScope() {
  if (S.province) { const code = S.data.provinces[S.province].code; return S.hospitals.filter(h => h.prov_id === code); }
  if (S.region !== 'all') return S.hospitals.filter(h => h.region === S.region);
  return S.hospitals;
}
function syncDisease() { if (S.disease && !getScope().diseases.some(x => x.pdx === S.disease)) S.disease = null; }

function yoyBadge(pct, label = 'YoY', title = '') {
  if (pct == null || !isFinite(pct)) return `<span class="yoy na" title="ไม่มีข้อมูลปีข้อมูลก่อนหน้าให้เปรียบเทียบ">— ไม่มีปีก่อนหน้า</span>`;
  const cls = Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '●';
  return `<span class="yoy ${cls}" title="${esc(title)}">${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% ${label}</span>`;
}

function renderKPIs() {
  const sc = getScope(), idx = periodIdx(S.fy, S.q), pidx = S.fy === 2567 ? periodIdx(2566, S.q) : null;
  const months = S.data.metadata.months;
  const c = cmp(sc.series);
  const dCur = idx.reduce((a, i) => a + daysInYM(months[i]), 0);
  const dPrev = pidx ? pidx.reduce((a, i) => a + daysInYM(months[i]), 0) : null;
  const perDay = c.cur / dCur, perDayPrev = dPrev ? c.prev / dPrev : null;
  const peakI = idx.reduce((b, i) => (sc.series[i] > sc.series[b] ? i : b), idx[0]);
  const peakPrev = pidx ? Math.max(...pidx.map(i => sc.series[i])) : null;
  const fcSum = sc.forecast.reduce((a, f) => a + f.forecast, 0);
  const fcPrev = sumIdx(sc.series, range(12, 18));
  const capacity = bedCapacity(hospInScope());
  const monthlyServicesPerBed = capacity.beds > 0 ? c.cur / idx.length / capacity.beds : null;

  const items = [
    { id: 'cases', color: HALLOWEEN.pumpkin, label: `บริการ IPD ทั้งหมด · ${periodLabel()}`, val: fmt(c.cur), badge: yoyBadge(c.yoy, 'YoY'), foot: c.prev != null ? 'ปีก่อน ' + fmt(c.prev) : '' },
    { id: 'day', color: HALLOWEEN.purple, label: 'บริการเฉลี่ยต่อวัน', val: fmt(perDay), badge: yoyBadge(perDayPrev ? pctChange(perDay, perDayPrev) : null, 'YoY'), foot: perDayPrev ? 'ปีก่อน ' + fmt(perDayPrev) : '' },
    { id: 'peak', color: '#c084fc', label: 'เดือนที่มีบริการสูงสุดในช่วงนี้', val: fmt(sc.series[peakI]), badge: yoyBadge(peakPrev ? pctChange(sc.series[peakI], peakPrev) : null, 'YoY'), foot: monthLabel(months[peakI]) },
    { id: 'perbed', color: HALLOWEEN.slime, label: 'บริการ IPD ต่อเตียง/เดือน (เฉลี่ยช่วงที่เลือก)', val: monthlyServicesPerBed == null ? '—' : monthlyServicesPerBed.toFixed(2), badge: '<span class="yoy na">จำนวนบริการ ÷ เตียงเปิดจริง ÷ จำนวนเดือน</span>', foot: `${fmt(c.cur)} บริการ / ${idx.length} เดือน · เตียงเปิดจริงจาก ${capacity.withOpenBeds} รพ. · มีข้อมูลจำนวนเตียง ${capacity.withData}/${capacity.totalHospitals} รพ. · ยอดบริการไม่ได้แยกราย รพ. · ไม่ใช่อัตราครองเตียง` },
    { id: 'fc', color: '#a78bfa', label: `พยากรณ์ 6 เดือนหลังข้อมูลล่าสุด (${forecastRangeLabel()})`, val: fmt(fcSum), badge: yoyBadge(pctChange(fcSum, fcPrev), 'YoY', 'เทียบกับยอดจริงช่วงเดียวกันของปีก่อน'), foot: 'ปีก่อน ' + fmt(fcPrev) }
  ];
  const grid = $('#kpi-grid');
  if (!grid.children.length) {
    grid.innerHTML = items.map(k => `<article class="glass kpi" data-k="${k.id}" style="--kc:${k.color}"><h3></h3><div class="kpi-val"></div><div class="kpi-foot"><span class="bd"></span><span class="ft"></span></div></article>`).join('');
  }
  items.forEach(k => {
    const el = $(`.kpi[data-k="${k.id}"]`, grid);
    $('h3', el).textContent = k.label;
    $('.bd', el).innerHTML = k.badge;
    $('.ft', el).textContent = k.foot;
    const v = $('.kpi-val', el); v.classList.add('roll');
    rollTo(v, k.val, 1000);
  });
}

function bedCapacity(hospitals) {
  const withData = hospitals.filter(h => Number.isFinite(h.beds) && h.beds >= 0);
  const withOpenBeds = withData.filter(h => h.beds > 0);
  return {
    beds: withOpenBeds.reduce((sum, h) => sum + h.beds, 0),
    withOpenBeds: withOpenBeds.length,
    withData: withData.length,
    totalHospitals: hospitals.length
  };
}
function hospStatus(h) {
  if (Number.isFinite(h.beds) && h.beds > 0) return { key: 'HAS_OPEN_BEDS', th: 'มีเตียงเปิดจริง', color: HALLOWEEN.slime };
  if (Number.isFinite(h.beds)) return { key: 'NO_OPEN_BEDS', th: 'ไม่มีเตียงเปิดจริง', color: '#fdba74' };
  return { key: 'UNKNOWN', th: 'ไม่มีข้อมูลจำนวนเตียง', color: HALLOWEEN.muted };
}
function occupancyStatus(h) {
  const imported = S.ref.occupancy.get(h.hcode);
  const occupiedBeds = imported ? imported.occupiedBeds : h.occupied_beds;
  if (!Number.isFinite(h.beds) || h.beds <= 0 || !Number.isFinite(occupiedBeds) || occupiedBeds < 0) {
    return { key: 'UNKNOWN_OCCUPANCY', label: 'ไม่มีข้อมูลครองเตียงย้อนหลัง', color: HALLOWEEN.muted, available: null, rate: null, occupiedBeds: null, record: null, historical: false };
  }
  const available = Math.max(0, h.beds - occupiedBeds);
  const rate = occupiedBeds / h.beds * 100;
  const status = rate >= 100
    ? { key: 'FULL', label: 'ครองเตียงย้อนหลัง ≥ เตียงเปิด', color: '#ef4444' }
    : rate >= 90
      ? { key: 'NEAR_FULL', label: 'ครองเตียงย้อนหลังใกล้เต็ม (≥90%)', color: HALLOWEEN.pumpkin }
      : { key: 'AVAILABLE', label: 'มีส่วนต่างเตียงตามข้อมูลย้อนหลัง', color: HALLOWEEN.slime };
  return { ...status, available, rate, occupiedBeds, record: imported || null, historical: !imported };
}
function occupancyUpdatedLabel(record) {
  if (!record) return 'วันอ้างอิงของตัวเลขนี้ไม่ระบุ';
  const date = new Date(record.updatedAt);
  return Number.isNaN(date.getTime()) ? 'ไม่ทราบเวลาอัปเดต' : date.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

let _hkPrev = {};
function renderHeaderKPIs() {
  const hospitals = S.hospitals.length;
  const open = S.hospitals.reduce((a, h) => a + (Number.isFinite(h.beds) && h.beds > 0 ? h.beds : 0), 0);
  const idx = periodIdx(S.fy, S.q), scope = getScope(), capacity = bedCapacity(hospInScope());
  const monthlyServicesPerBed = capacity.beds > 0 ? sumIdx(scope.series, idx) / idx.length / capacity.beds : null;
  let err = 0; S.issues.forEach(list => { if (list.some(i => i.sev === 'e')) err++; });
  const set = (id, v) => {
    const el = $(id); rollTo(el, typeof v === 'number' ? fmt(v) : v, 800);
    if (_hkPrev[id] != null && _hkPrev[id] !== v) { el.classList.remove('slot-updating'); void el.offsetWidth; el.classList.add('slot-updating'); }
    _hkPrev[id] = v;
  };
  set('#hk-hosp', hospitals); set('#hk-open', open); set('#hk-perbed', monthlyServicesPerBed == null ? '—' : monthlyServicesPerBed.toFixed(2)); set('#hk-err', err);
  $('#audit-badge').textContent = err;
}

function renderScopeChips() {
  const chips = [];
  if (S.region !== 'all') chips.push(`<span class="chip">${esc(S.data.regions[S.region].name_th)} <button data-clear="region" aria-label="ล้างภูมิภาค">×</button></span>`);
  if (S.province) chips.push(`<span class="chip">จ.${esc(S.data.provinces[S.province].name_th)} <button data-clear="province" aria-label="ล้างจังหวัด">×</button></span>`);
  if (S.disease) { const d = getScope().diseases.find(x => x.pdx === S.disease); chips.push(`<span class="chip magenta">${esc(S.disease)} ${esc(d ? d.name_th.slice(0, 26) : '')} <button data-clear="disease" aria-label="ล้างตัวกรองโรค">×</button></span>`); }
  $('#scope-chips').innerHTML = chips.join('');
}

function renderAll() {
  syncDisease();
  renderScopeChips();
  renderKPIs();
  renderHeaderKPIs();
  refreshMap();
  renderRank();
  if (S.province) renderPanel();
  renderInsights();
  renderTabSpecific();
}
function renderTabSpecific() {
  if (S.tab === 'trend') { renderTrend(); renderTreemap(); renderDist(); }
  if (S.tab === 'zones') renderZones();
  if (S.tab === 'referral') renderReferral();
}

// -----------------------------------------------------------------------------
// UI BINDINGS + TABS
// -----------------------------------------------------------------------------
function setSeg(sel, attr, val) { $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset[attr] === String(val))); }

function bindUI() {
  $('#f-fy').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.fy = +b.dataset.fy; setSeg('#f-fy', 'fy', S.fy); renderAll(); });
  $('#f-q').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.q = +b.dataset.q; setSeg('#f-q', 'q', S.q); renderAll(); });
  $('#f-metric').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.metric = b.dataset.m; setSeg('#f-metric', 'm', S.metric); refreshMap(); renderRank(); });
  $('#f-region').addEventListener('change', e => {
    S.region = e.target.value;
    if (S.province && S.region !== 'all' && S.data.provinces[S.province].region !== S.region) { clearProvince(true); }
    renderAll();
  });
  $('#scope-chips').addEventListener('click', e => {
    const b = e.target.closest('button[data-clear]'); if (!b) return;
    const k = b.dataset.clear;
    if (k === 'region') { S.region = 'all'; $('#f-region').value = 'all'; }
    if (k === 'province') { clearProvince(); return; }
    if (k === 'disease') S.disease = null;
    renderAll();
  });
  $$('.nav-tab-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#trend-gran').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.gran = b.dataset.g; setSeg('#trend-gran', 'g', S.gran); renderTrend(); });
  $('#map-reset').addEventListener('click', () => clearProvince());
  $('#zone-sort').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.zoneSort = b.dataset.z; setSeg('#zone-sort', 'z', S.zoneSort); renderZones(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.province && S.tab === 'overview') clearProvince(); });
  window.addEventListener('resize', debounce(() => {
    if (S.tab === 'overview' && map) { map.invalidateSize(); if (!S.province) fitNational(false); }
    if (S.tab === 'trend') { renderTrend(); renderTreemap(); renderDist(); }
  }));
  bindReferralUI(); bindAuditUI();
}

function setTab(name) {
  S.tab = name;
  $$('.nav-tab-btn').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'overview') { map.invalidateSize(); if (!S.province) fitNational(false); reRollPane('#tab-overview'); }
  if (name === 'trend') { renderTrend(); renderTreemap(); renderDist(); }
  if (name === 'zones') { renderZones(); }
  if (name === 'referral') { initRefMap(); renderReferral(); }
  if (name === 'audit') { renderAudit(); reRollPane('#tab-audit'); }
}

// -----------------------------------------------------------------------------
// 3. MAP (Leaflet + GeoJSON จังหวัด) – National view ล็อกนิ่ง, คลิกจังหวัด → fitBounds/flyToBounds
// -----------------------------------------------------------------------------
let map = null, geoLayer = null, markerLayer = null, fallbackMode = false;
const layerByKey = {};      // province key -> [layers]
let provMetrics = {};
let cqBreaks = [];
let spbBreaks = [];

const norm = s => String(s || '').toLowerCase().replace(/จังหวัด|province|metropolis|มหานคร|changwat/g, '').replace(/ฯ/g, '').replace(/[^a-z0-9\u0E01-\u0E59]/g, '');
const PROV_ALIAS = { ayutthaya: 'Phra Nakhon Si Ayutthaya', krungthepmahanakhon: 'Bangkok Metropolis', bangkok: 'Bangkok Metropolis', krungthep: 'Bangkok Metropolis', กรุงเทพ: 'Bangkok Metropolis', อยุธยา: 'Phra Nakhon Si Ayutthaya' };
function lev(a, b) { const m = a.length, n = b.length; const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) dp[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return dp[m][n]; }

function buildProvIndex() {
  S.provIdx = {}; S.codeIdx = {};
  Object.entries(S.data.provinces).forEach(([k, p]) => {
    [k, p.name_th, p.name_en].forEach(n => { const x = norm(n); if (x) S.provIdx[x] = k; });
    S.codeIdx[Math.round(+p.code / 100)] = k;
  });
  Object.entries(PROV_ALIAS).forEach(([a, k]) => { if (!S.provIdx[norm(a)]) S.provIdx[norm(a)] = k; });
}
function matchFeature(f) {
  const props = f.properties || {};
  const entries = Object.entries(props);
  for (const [, v] of entries) if (typeof v === 'string') { const k = S.provIdx[norm(v)]; if (k) return k; }
  for (const [pk, v] of entries) {
    if (!/code|pcode|^id$|pv|prov|adm1|cc_1|gid/i.test(pk)) continue;
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) { if (S.codeIdx[n]) return S.codeIdx[n]; if (S.codeIdx[Math.floor(n / 100)]) return S.codeIdx[Math.floor(n / 100)]; }
  }
  for (const [, v] of entries) if (typeof v === 'string' && /^[A-Za-z .'-]{5,}$/.test(v)) {
    const nv = norm(v); let best = null, bd = 2;
    for (const key of Object.keys(S.provIdx)) if (/^[a-z]+$/.test(key)) { const dd = lev(nv, key); if (dd < bd) { bd = dd; best = key; } }
    if (best) return S.provIdx[best];
  }
  return null;
}
function asFC(v) {
  if (!v) return null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
  if (v.type === 'FeatureCollection' && Array.isArray(v.features)) return v;
  if (v.type === 'Feature') return { type: 'FeatureCollection', features: [v] };
  return null;
}
async function loadGeo() {
  const names = [CONFIG.GEOJSON_VAR, ...CONFIG.GEOJSON_VARS].filter(Boolean);
  for (const n of names) { try { const fc = asFC(new Function(`return typeof ${n}!=='undefined'?${n}:undefined`)()); if (fc) return fc; } catch (e) { } }
  for (const k of Object.keys(window)) { try { const fc = asFC(window[k]); if (fc) return fc; } catch (e) { } }
  try { const r = await fetch(CONFIG.GEOJSON_URL); if (r.ok) return asFC(await r.json()); } catch (e) { }
  return null;
}

function fitNational(animate = true) {
  const opt = { padding: [10, 10] };
  if (animate) map.flyToBounds(CONFIG.NATIONAL_BOUNDS, { ...opt, duration: 1.0 });
  else map.fitBounds(CONFIG.NATIONAL_BOUNDS, { ...opt, animate: false });
}

async function initMap() {
  map = L.map('map', {
    zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5,
    dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false
  });
  fitNational(false);
  map.setMinZoom(map.getZoom() - 0.5);
  map.setMaxBounds(L.latLngBounds(CONFIG.NATIONAL_BOUNDS).pad(0.35));
  map.on('click', () => clearProvince());

  computeMetrics();
  const fc = await loadGeo();
  S.geoFC = fc;
  const banner = $('#map-banner');
  if (fc) {
    fc.features.forEach(f => { f._key = matchFeature(f); });
    const unmatched = fc.features.filter(f => !f._key);
    const matched = new Set(fc.features.filter(f => f._key).map(f => f._key));
    if (unmatched.length || matched.size < 77) {
      console.warn('GeoJSON จับคู่ไม่ครบ:', { matched: matched.size, unmatched: unmatched.map(f => f.properties) });
      banner.innerHTML = `จับคู่ขอบเขตจังหวัดได้ ${matched.size}/77 จังหวัด — ดูรายละเอียดใน Console (F12) แล้วเพิ่มคีย์ชื่อใน <code>PROV_ALIAS</code>`;
      banner.classList.add('show');
    }
    geoLayer = L.geoJSON(fc, {
      style: f => styleForKey(f._key),
      onEachFeature: (f, layer) => {
        const key = f._key; if (!key) return;
        (layerByKey[key] = layerByKey[key] || []).push(layer);
        layer.on({
          click: e => { L.DomEvent.stopPropagation(e); selectProvince(key); },
          mouseover: () => { if (S.province !== key) layer.setStyle({ weight: 2, color: HALLOWEEN.pumpkin }); layer.bringToFront(); if (S.province && S.province !== key) (layerByKey[S.province] || []).forEach(l => l.bringToFront()); },
          mouseout: () => { if (S.province !== key) layer.setStyle(styleForKey(key)); }
        });
        layer.bindTooltip(() => tipHTML(key), { sticky: true, className: 'glass-tip', direction: 'top' });
      }
    }).addTo(map);
  } else {
    fallbackMode = true;
    banner.innerHTML = 'ไม่พบ <code>thailand_geojson.js</code> / <code>thailand_provinces.geojson</code> ในโฟลเดอร์เดียวกับ index.html — แสดงเป็นจุดจังหวัดแทนชั่วคราว';
    banner.classList.add('show');
    markerLayer = L.layerGroup().addTo(map);
    Object.entries(S.data.provinces).forEach(([key, p]) => {
      const m = L.circleMarker([p.lat, p.lng], { radius: 7, weight: 1, color: HALLOWEEN.pumpkin, fillOpacity: 0.8 }).addTo(markerLayer);
      (layerByKey[key] = [m]);
      m.on('click', e => { L.DomEvent.stopPropagation(e); selectProvince(key); });
      m.bindTooltip(() => tipHTML(key), { sticky: true, className: 'glass-tip' });
    });
  }
}

// ---- Metrics + color scales ----
function computeMetrics() {
  provMetrics = {};
  const vals = [], rates = [], idx = periodIdx(S.fy, S.q);
  Object.entries(S.data.provinces).forEach(([k, p]) => {
    const c = cmp(p.monthly_series);
    const capacity = bedCapacity(S.hospitals.filter(h => h.prov_id === p.code));
    const servicesPerBed = capacity.beds > 0 ? c.cur / idx.length / capacity.beds : null;
    provMetrics[k] = { cases: c.cur, prev: c.prev, yoy: c.yoy, ...capacity, servicesPerBed };
    vals.push(c.cur);
    if (servicesPerBed != null) rates.push(servicesPerBed);
  });
  vals.sort((a, b) => a - b);
  cqBreaks = [1, 2, 3, 4, 5].map(i => vals[Math.floor(vals.length * i / 6)]);
  rates.sort((a, b) => a - b);
  spbBreaks = [1, 2, 3, 4, 5].map(i => rates[Math.floor((rates.length - 1) * i / 6)] || 0);
}
const RAMP_CASES = [HALLOWEEN.purpleDark, '#4c1d95', HALLOWEEN.purpleMid, HALLOWEEN.purple, HALLOWEEN.orangeDark, HALLOWEEN.pumpkin];
function colorFor(key) {
  const m = provMetrics[key]; if (!m) return HALLOWEEN.purpleDark;
  if (S.metric === 'disease') return disColor(S.data.provinces[key].top_diseases[0]);
  if (S.metric === 'cases') { let i = 0; while (i < cqBreaks.length && m.cases >= cqBreaks[i]) i++; return RAMP_CASES[i]; }
  if (S.metric === 'perbed') {
    if (m.servicesPerBed == null) return '#4b3b5f';
    let i = 0; while (i < spbBreaks.length && m.servicesPerBed >= spbBreaks[i]) i++;
    return RAMP_CASES[i];
  }
  if (m.yoy == null) return '#4b3b5f';
  return m.yoy > 4 ? '#e11d48' : m.yoy > 1 ? '#fb7185' : m.yoy >= -1 ? '#475569' : m.yoy >= -4 ? '#34d399' : '#059669';
}
function legendRows() {
  if (S.metric === 'disease') {
    const cnt = {}, nm = {};
    Object.values(S.data.provinces).forEach(p => { const t = p.top_diseases[0]; cnt[t.pdx] = (cnt[t.pdx] || 0) + 1; nm[t.pdx] = t; });
    return { title: 'โรคที่พบมากสุดของแต่ละจังหวัด', rows: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(k => [disColor(nm[k]), `${k} ${shortName(nm[k].name_th).slice(0, 22)} · ${cnt[k]} จว.`]) };
  }
  if (S.metric === 'cases') return { title: `จำนวนบริการ IPD · ${periodLabel()}`, rows: RAMP_CASES.map((c, i) => [c, i === 0 ? `< ${fmtC(cqBreaks[0])}` : i === 5 ? `≥ ${fmtC(cqBreaks[4])}` : `${fmtC(cqBreaks[i - 1])} – ${fmtC(cqBreaks[i])}`]) };
  if (S.metric === 'perbed') return {
    title: `บริการ IPD ต่อเตียง/เดือน · เฉลี่ย ${periodLabel()}`,
    rows: RAMP_CASES.map((color, i) => [color, i === 0 ? `< ${spbBreaks[0].toFixed(2)}` : i === 5 ? `≥ ${spbBreaks[4].toFixed(2)}` : `${spbBreaks[i - 1].toFixed(2)}–${spbBreaks[i].toFixed(2)} ครั้ง/เตียง/เดือน`])
  };
  return { title: S.fy === 2567 ? `YoY · ${periodLabel()} เทียบปีก่อน` : 'YoY (ปี 2566 ไม่มีปีก่อนหน้า)', rows: [['#e11d48', '> +4%'], ['#fb7185', '+1 ถึง +4%'], ['#475569', '±1%'], ['#34d399', '−1 ถึง −4%'], ['#059669', '< −4%']] };
}
function styleForKey(key) {
  if (!key) return { weight: 0.5, color: 'rgba(196,181,213,0.35)', fillColor: HALLOWEEN.purpleDark, fillOpacity: 0.5, interactive: false, className: 'prov' };
  const p = S.data.provinces[key];
  const dim = S.region !== 'all' && p.region !== S.region;
  const sel = S.province === key;
  return {
    className: 'prov', weight: sel ? 2.6 : 0.9, color: sel ? HALLOWEEN.text : 'rgba(196,181,213,0.5)',
    fillColor: colorFor(key), fillOpacity: dim ? 0.1 : (S.province && !sel ? 0.42 : 0.82)
  };
}
function tipHTML(key) {
  const p = S.data.provinces[key], m = provMetrics[key];
  const t = p.top_diseases[0];
  const loadLine = m.servicesPerBed == null ? 'ไม่มีข้อมูลเตียงเปิดจริง' : `เฉลี่ย ${m.servicesPerBed.toFixed(2)} บริการ/เตียง/เดือน · เตียงเปิดจริง ${fmt(m.beds)} จาก ${m.withOpenBeds} รพ. · มีข้อมูลจำนวนเตียง ${m.withData}/${m.totalHospitals} รพ. · ยอดบริการพื้นที่ไม่ได้แยกราย รพ.`;
  return `<b>${esc(p.name_th)}</b><br>โรคเด่น: <span style="color:${disColor(t)}">${esc(shortName(t.name_th).slice(0, 26))}</span><br>${fmt(m.cases)} บริการรวม · ${m.yoy == null ? 'ไม่มี YoY' : (m.yoy > 0 ? '+' : '') + m.yoy.toFixed(1) + '% YoY'}<br>${loadLine} · เฉลี่ย ${periodLabel()}`;
}
function refreshMap() {
  if (!map) return;
  computeMetrics();
  Object.entries(layerByKey).forEach(([key, layers]) => layers.forEach(l => {
    if (fallbackMode) {
      const m = provMetrics[key];
      l.setStyle({ fillColor: colorFor(key), color: S.province === key ? '#fff' : HALLOWEEN.pumpkin, radius: 5 + Math.sqrt(m.cases) / 55, weight: S.province === key ? 3 : 1 });
    } else {
      l.setStyle(styleForKey(key));
      const el = l.getElement && l.getElement(); if (el) el.classList.toggle('prov-selected', S.province === key);
    }
  }));
  if (S.province) (layerByKey[S.province] || []).forEach(l => l.bringToFront());
  const lg = legendRows();
  $('#map-legend').innerHTML = `<div class="lg-title">${esc(lg.title)}</div>` + lg.rows.map(([c, t]) => `<div class="lg-row"><i style="background:${c}"></i>${esc(t)}</div>`).join('');
}
function boundsOf(key) {
  const ls = layerByKey[key] || [];
  if (!fallbackMode && ls.length) { let b = null; ls.forEach(l => { const lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); }); return b; }
  const p = S.data.provinces[key]; return L.latLngBounds([[p.lat - 0.35, p.lng - 0.35], [p.lat + 0.35, p.lng + 0.35]]);
}

// ---- Province select / clear ----
function selectProvince(key) {
  const p = S.data.provinces[key]; if (!p) return;
  if (S.region !== 'all' && p.region !== S.region) { S.region = p.region; $('#f-region').value = p.region; }
  S.province = key;
  S.tab !== 'overview' && setTab('overview');
  $('#prov-panel').classList.add('open');
  $('#map-reset').classList.add('show');
  map.dragging.enable();
  renderAll();
  const wide = window.innerWidth > 960;
  map.flyToBounds(boundsOf(key), {
    paddingTopLeft: [24, 24], paddingBottomRight: [wide ? 392 : 24, wide ? 24 : 280],
    maxZoom: key === 'Bangkok Metropolis' ? 10 : 9, duration: 1.1
  });
}
function clearProvince(silentRender = false) {
  if (!S.province) return;
  S.province = null;
  $('#prov-panel').classList.remove('open');
  $('#map-reset').classList.remove('show');
  map.dragging.disable();
  fitNational(true);
  if (!silentRender) renderAll();
}

// -----------------------------------------------------------------------------
// 4. PROVINCE PANEL (Glassmorphism) + RANKING
// -----------------------------------------------------------------------------
function sparkSVG(series, forecast, hi, color) {
  const W = 320, H = 70, pad = 4;
  const all = [...series, ...forecast.map(f => f.forecast)];
  const mn = Math.min(...all) * 0.9, mx = Math.max(...all) * 1.04;
  const X = i => pad + i * (W - 2 * pad) / (all.length - 1), Y = v => H - pad - (v - mn) / (mx - mn) * (H - 2 * pad);
  const line = (arr, off) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const band = hi.length ? `<rect x="${X(hi[0]) - 4}" y="0" width="${X(hi[hi.length - 1]) - X(hi[0]) + 8}" height="${H}" fill="rgba(255,117,24,0.13)" rx="4"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${band}
    <path d="${line(series, 0)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${X(series.length - 1).toFixed(1)},${Y(series[series.length - 1]).toFixed(1)} ${line(forecast.map(f => f.forecast), series.length).replace(/^M/, 'L')}" fill="none" stroke="${HALLOWEEN.purple}" stroke-width="2" stroke-dasharray="4 4"/>
  </svg>`;
}
function renderPanel() {
  const key = S.province; if (!key) return;
  const p = S.data.provinces[key], c = cmp(p.monthly_series), hs = S.hospitals.filter(h => h.prov_id === p.code);
  const idx = periodIdx(S.fy, S.q), services = sumIdx(p.monthly_series, idx), capacity = bedCapacity(hs);
  const servicesPerBed = capacity.beds > 0 ? services / idx.length / capacity.beds : null;
  const maxD = p.top_diseases[0].cases;
  const td = p.top_diseases[0], natT = S.data.national.top_diseases.find(x => x.pdx === td.pdx);
  const tShare = td.cases / p.total_cases * 100, lq = natT ? tShare / (natT.cases / S.data.national.total_cases * 100) : null;
  $('#prov-panel').innerHTML = `
    <div class="pp-head">
      <div><h2>${esc(p.name_th)}</h2><small>${esc(p.name_en)}</small></div>
      <button class="pp-close" id="pp-close" aria-label="ปิดการ์ดข้อมูล">✕</button>
    </div>
    <div class="pp-tags"><span class="chip">${esc(p.region_th)}</span><span class="chip">${esc(p.zone_name)}</span></div>
    <div class="pp-hero" style="--hc:${disColor(td)}"><small>โรคเด่นของจังหวัด</small><b>${esc(shortName(td.name_th))}</b><span>${td.pdx} · ${tShare.toFixed(2)}% ของเคสทั้งหมด${lq ? ` · ${lq.toFixed(2)}× ของค่าประเทศ` : ''}</span></div>
    <div class="pp-main">
      <div>
        <div style="color:var(--muted);font-size:12px">บริการ IPD · ${periodLabel()}</div>
        <div class="big" id="pp-big"></div>
        <div style="margin-top:4px">${yoyBadge(c.yoy, 'YoY')} ${c.prev != null ? `<span style="color:var(--muted);font-size:12px">ปีก่อน ${fmt(c.prev)}</span>` : ''}</div>
      </div>
      <div class="pp-rate"><b>${servicesPerBed == null ? '—' : servicesPerBed.toFixed(2)}</b><small>บริการ/เตียง/เดือน เฉลี่ย</small></div>
    </div>
    <div class="ins-note">${fmt(services)} บริการใน ${idx.length} เดือน ÷ ${fmt(capacity.beds)} เตียงเปิดจริงจาก ${capacity.withOpenBeds} รพ. · มีข้อมูลจำนวนเตียง ${capacity.withData}/${capacity.totalHospitals} แห่ง · ยอดบริการเป็นยอดรวมจังหวัด ไม่ได้แยกราย รพ. จึงเป็นเพียงภาระบริการเฉลี่ย ไม่ใช่อัตราครองเตียงหรือการยืนยันว่าเตียงพอ/ว่าง</div>
    <div class="pp-sec"><h4>แนวโน้ม 24 เดือน + พยากรณ์ 6 เดือนหลังข้อมูลล่าสุด</h4>${sparkSVG(p.monthly_series, forecastMonthly(p.monthly_series), periodIdx(S.fy, S.q), HALLOWEEN.pumpkin)}</div>
    <div class="pp-sec"><h4>เพศ</h4>
      <div class="gbar"><i style="width:${p.gender.male_pct}%"></i><i style="width:${p.gender.female_pct}%"></i></div>
      <div class="glab"><span>ชาย ${p.gender.male_pct}%</span><span>หญิง ${p.gender.female_pct}%</span></div></div>
    <div class="pp-sec"><h4>โรคที่พบมากสุด 5 อันดับ (24 เดือน)</h4><ul class="dz">
      ${p.top_diseases.slice(0, 5).map(d => `<li><span>${esc(d.name_th.length > 34 ? d.name_th.slice(0, 34) + '…' : d.name_th)}</span><span>${fmt(d.cases)}</span><div class="b"><i style="width:${(d.cases / maxD * 100).toFixed(0)}%;background:${d.color}"></i></div></li>`).join('')}
    </ul></div>
    <div class="pp-sec"><h4>ภาระบริการ IPD รายเดือนเทียบเตียงเปิดจริง</h4><div class="hosp-mini"><div>จำนวนบริการรายเดือนแยกตามโรงพยาบาลไม่มีในชุดข้อมูล จึงคำนวณตัวชี้วัดนี้ได้ในระดับจังหวัด ไม่ใช่รายโรงพยาบาล</div></div></div>
    <button class="pp-btn" id="pp-trend">ดูแนวโน้ม &amp; พยากรณ์ของจังหวัดนี้</button>`;
  rollTo($('#pp-big'), fmt(c.cur), 1000);
  $('#pp-close').onclick = () => clearProvince();
  $('#pp-trend').onclick = () => setTab('trend');
}

function renderRank() {
  const metric = S.metric;
  let rows = Object.entries(S.data.provinces).filter(([, p]) => S.region === 'all' || p.region === S.region)
    .map(([k, p]) => ({ k, p, m: provMetrics[k] }));
  const val = r => metric === 'perbed' ? (r.m.servicesPerBed ?? -1) : metric === 'yoy' ? (r.m.yoy ?? -999) : r.m.cases;
  rows.sort((a, b) => val(b) - val(a));
  const max = Math.max(...rows.map(r => Math.abs(metric === 'yoy' ? (r.m.yoy ?? 0) : val(r))), 1);
  $('#rank-title').textContent = { cases: 'จังหวัดเรียงตามจำนวนบริการ', perbed: 'จังหวัดเรียงตามบริการ IPD ต่อเตียง/เดือน', yoy: 'จังหวัดเรียงตาม YoY', disease: 'จังหวัด · แยกตามโรคเด่น' }[metric];
  $('#rank-sub').textContent = `5 อันดับแรก · ${periodLabel()}${metric === 'perbed' ? ' · ค่าประมาณจากยอดบริการรวมจังหวัดและเตียงที่มีข้อมูล · ไม่ใช่อัตราครองเตียง' : ''}`;
  rows = rows.slice(0, 5);
  $('#rank-list').innerHTML = rows.map((r, i) => {
    const v = val(r), t = r.p.top_diseases[0];
    const txt = metric === 'cases' ? fmtC(v) : metric === 'disease' ? `<span style="color:${disColor(t)}">${t.pdx}</span>` : metric === 'perbed' ? (v < 0 ? '—' : v.toFixed(2)) : (r.m.yoy == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
    const col = metric === 'disease' ? disColor(t) : metric === 'yoy' ? (v > 0 ? 'var(--up)' : 'var(--down)') : metric === 'perbed' ? (v < 0 ? 'var(--muted)' : HALLOWEEN.pumpkin) : 'var(--cyan)';
    const w = metric === 'yoy' ? Math.abs(r.m.yoy ?? 0) / max * 100 : Math.max(v, 0) / max * 100;
    return `<li data-k="${esc(r.k)}" class="${S.province === r.k ? 'on' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.p.name_th)}</span><span class="vl" style="color:${col}">${txt}</span><div class="bar"><i style="width:${w.toFixed(0)}%;background:${col};box-shadow:0 0 8px ${col}"></i></div></li>`;
  }).join('');
  $$('#rank-list li').forEach(li => li.addEventListener('click', () => selectProvince(li.dataset.k)));
}

// -----------------------------------------------------------------------------
// 5. TREND CHART (SVG) – รายไตรมาส/รายเดือน + พยากรณ์ 6 เดือน + Cross-filter จาก Treemap
// -----------------------------------------------------------------------------
function getTrendData() {
  const sc = getScope();
  const dis = S.disease ? sc.diseases.find(d => d.pdx === S.disease) : null;
  const share = dis ? dis.cases / sc.total24 : 1;     // ประมาณจากสัดส่วนโรค (ต้นทางไม่มีรายเดือนต่อโรค)
  const act = sc.series.map(v => v * share);
  const fc = sc.forecast.map(f => ({ v: f.forecast * share, lo: f.lower * share, hi: f.upper * share }));
  const M = S.data.metadata, pts = [];
  if (S.gran === 'month') {
    act.forEach((v, i) => pts.push({ type: 'act', label: monthLabel(M.months[i]), v, monthIdx: i, prev: i >= 12 ? act[i - 12] : null, qn: Math.floor((i % 12) / 3) + 1 }));
    fc.forEach((f, j) => pts.push({ type: 'fc', label: monthLabel(M.future_months[j]), v: f.v, lo: f.lo, hi: f.hi, prev: act[12 + j], qn: Math.floor(j / 3) + 1 }));
  } else {
    for (let q = 0; q < 8; q++) pts.push({ type: 'act', label: `Q${q % 4 + 1} ${66 + Math.floor(q / 4)}`, v: sumIdx(act, range(q * 3, q * 3 + 3)), prev: q >= 4 ? pts[q - 4].v : null, qn: q % 4 + 1 });
    for (let j = 0; j < 2; j++) {
      const sl = fc.slice(j * 3, j * 3 + 3);
      pts.push({ type: 'fc', label: `Q${j + 1} 68`, v: sl.reduce((a, b) => a + b.v, 0), lo: sl.reduce((a, b) => a + b.lo, 0), hi: sl.reduce((a, b) => a + b.hi, 0), prev: pts[4 + j].v, qn: j + 1 });
    }
  }
  return { pts, sc, dis, share, act, fc };
}
function niceScale(min, max, ticks = 4) {
  const rg = Math.max(max - min, 1), raw = rg / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / mag;
  const s = (e >= 7 ? 10 : e >= 3 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  return { min: Math.floor(min / s) * s, max: Math.ceil(max / s) * s, step: s };
}
function smooth(P) {
  if (P.length < 3) return P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function renderTrend() {
  const { pts, sc, dis } = getTrendData();
  const col = dis ? '#c084fc' : HALLOWEEN.pumpkin;
  $('#trend-title').textContent = `แนวโน้ม${dis ? ' · ' + dis.name_th : 'ผู้ป่วยใน'} — ${sc.label}`;
  const backtest = forecastBacktest();
  const foldSummary = backtest ? backtest.folds.map(fold => `${fold.label}: ${fold.wape.toFixed(1)}%`).join(' · ') : 'คำนวณไม่ได้';
  const forecastMethod = `พยากรณ์ตามฤดูกาล: เดือนเดียวกันของปีก่อน ปรับด้วยค่าเปลี่ยนแปลงเฉลี่ยเทียบปีก่อนใน 6 เดือนล่าสุด · ทดสอบย้อนหลัง 2 ช่วง (${foldSummary}) รวม ${backtest ? backtest.scopeCount : 0} ชุดข้อมูล-ช่วง WAPE รวม ${backtest ? backtest.wape.toFixed(1) + '%' : 'คำนวณไม่ได้'} (seasonal naive ${backtest ? backtest.seasonalWape.toFixed(1) + '%' : '—'})`;
  const forecastValidation = dis
    ? `${forecastMethod} · ผลทดสอบนี้วัดยอดรวม ไม่ใช่ความแม่นยำรายโรค เพราะไม่มีข้อมูลจริงรายเดือนแยกโรค`
    : forecastMethod;
  $('#trend-sub').innerHTML = dis
    ? `<b style="color:${HALLOWEEN.slime};font-weight:500">ค่าประมาณรายโรค</b> จากสัดส่วนโรค ${dis.pdx} (${(dis.cases / sc.total24 * 100).toFixed(2)}% ของเคสทั้งหมด) × ยอดรวม · ${forecastValidation} · ช่วงพยากรณ์ ${forecastRangeLabel()}`
    : `ข้อมูลจริงรายเดือนจาก สปสช. รวมเป็นรายไตรมาสปีข้อมูล 2566–2567 (ต.ค.–ก.ย.) · ${forecastMethod} · พยากรณ์ ${forecastRangeLabel()} (เส้นประม่วง; แถบสีคือช่วงประมาณการจากความผันผวนย้อนหลัง ไม่ใช่ช่วงความเชื่อมั่น)`;

  const hostW = $('.trend-box'), W = Math.max(hostW.clientWidth || 1000, 340), H = W < 560 ? 300 : 360, ml = 58, mr = 22, mt = 18, mb = 40;
  $('#trend-svg').setAttribute('viewBox', `0 0 ${W} ${H}`);
  const n = pts.length, step = (W - ml - mr) / (n - 1);
  const X = i => ml + i * step;
  const vmax = Math.max(...pts.map(p => p.hi ?? p.v)), vmin = Math.min(...pts.map(p => p.lo ?? p.v));
  const sc2 = niceScale(Math.max(vmin * 0.82, 0), vmax * 1.06);
  const Y = v => mt + (1 - (v - sc2.min) / (sc2.max - sc2.min)) * (H - mt - mb);
  const act = pts.filter(p => p.type === 'act'), fcp = pts.filter(p => p.type === 'fc');
  const nA = act.length, last = pts[nA - 1];
  const actP = act.map((p, i) => [X(i), Y(p.v)]);
  const fcP = [[X(nA - 1), Y(last.v)], ...fcp.map((p, j) => [X(nA + j), Y(p.v)])];
  const hiP = [[X(nA - 1), Y(last.v)], ...fcp.map((p, j) => [X(nA + j), Y(p.hi)])];
  const loP = [[X(nA - 1), Y(last.v)], ...fcp.map((p, j) => [X(nA + j), Y(p.lo)])].reverse();
  const band = `M${[...hiP, ...loP].map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')} Z`;

  let grid = '';
  for (let v = sc2.min; v <= sc2.max + 1; v += sc2.step) grid += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${ml - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${fmtC(v)}</text>`;
  const labelEvery = S.gran === 'month' ? (W < 700 ? 6 : 3) : (W < 480 ? 2 : 1);
  let xl = ''; pts.forEach((p, i) => { if (i % labelEvery === 0 || i === n - 1) xl += `<text x="${X(i).toFixed(1)}" y="${H - 16}" text-anchor="middle" ${p.type === 'fc' ? 'fill="#a78bfa" style="fill:#a78bfa"' : ''}>${p.label}</text>`; });
  let hl = '';
  if (S.q) pts.forEach((p, i) => { if (p.qn === S.q && p.type === 'act') hl += `<rect x="${(X(i) - step * 0.42).toFixed(1)}" y="${mt}" width="${(step * 0.84).toFixed(1)}" height="${H - mt - mb}" rx="6" fill="rgba(255,117,24,0.08)"/>`; });
  const dx = (X(nA - 1) + X(nA)) / 2;
  const dots = pts.map((p, i) => {
    const cx = X(i).toFixed(1), cy = Y(p.v).toFixed(1), c = p.type === 'fc' ? '#a78bfa' : col;
    return `<circle class="dot-pop" cx="${cx}" cy="${cy}" r="4.5" fill="#120a1f" stroke="${c}" stroke-width="2" style="animation-delay:${(0.5 + i * 0.04).toFixed(2)}s"/><circle class="dot" data-i="${i}" cx="${cx}" cy="${cy}" r="15" fill="transparent"/>`;
  }).join('');

  $('#trend-svg').innerHTML = `
    <defs>
      <linearGradient id="gA" x1="0" x2="1"><stop offset="0" stop-color="${dis ? HALLOWEEN.purple : HALLOWEEN.orangeDark}"/><stop offset="1" stop-color="${col}"/></linearGradient>
      <linearGradient id="gB" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${HALLOWEEN.purple}" stop-opacity=".38"/><stop offset="1" stop-color="${HALLOWEEN.purple}" stop-opacity=".05"/></linearGradient>
      <filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${grid}${hl}
    <line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${mt}" y2="${H - mb}" stroke="rgba(139,92,246,0.6)" stroke-dasharray="4 5"/>
    <text x="${(dx + 8).toFixed(1)}" y="${mt + 10}" style="fill:${HALLOWEEN.purple}">พยากรณ์ →</text>
    <path d="${band}" fill="url(#gB)"/>
    <path id="tr-act" d="${smooth(actP)}" fill="none" stroke="url(#gA)" stroke-width="3.2" stroke-linecap="round" filter="url(#glow)"/>
    <path id="tr-fc" d="${smooth(fcP)}" fill="none" stroke="${HALLOWEEN.purple}" stroke-width="2.6" stroke-dasharray="7 6" stroke-linecap="round"/>
    ${dots}${xl}`;

  if (!reduceMotion) {
    const path = $('#tr-act'), len = path.getTotalLength();
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len; void path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)'; path.style.strokeDashoffset = 0;
    const f = $('#tr-fc'); f.style.opacity = 0; f.style.transition = 'opacity .8s ease .9s'; requestAnimationFrame(() => { f.style.opacity = 1; });
  }

  // tooltip
  const tip = $('#trend-tip'), box = $('.trend-box');
  $$('#trend-svg .dot').forEach(c => {
    c.addEventListener('mouseenter', () => {
      const p = pts[+c.dataset.i], r = c.getBoundingClientRect(), b = box.getBoundingClientRect();
      const y = p.prev != null ? pctChange(p.v, p.prev) : null;
      const capacity = bedCapacity(hospInScope());
      const bedLoad = p.type === 'act' && p.monthIdx != null && capacity.beds > 0
        ? `<br>${(p.v / capacity.beds).toFixed(2)} บริการ/เตียงในเดือนนี้ · ${fmt(capacity.beds)} เตียงเปิดจริง (${capacity.withData}/${capacity.totalHospitals} รพ.มีข้อมูลจำนวนเตียง)`
        : '';
      tip.innerHTML = `<b>${p.label}</b>${p.type === 'fc' ? ' <span style="color:#a78bfa">พยากรณ์</span>' : ''}<br>${fmt(p.v)} บริการ${bedLoad}${p.type === 'fc' ? `<br><span style="color:var(--muted)">ช่วง ${fmtC(p.lo)} – ${fmtC(p.hi)}</span>` : ''}<br>${y == null ? '<span style="color:var(--muted)">ไม่มีข้อมูลปีก่อนหน้า</span>' : yoyBadge(y, 'YoY')}`;
      tip.style.left = (r.left + r.width / 2 - b.left) + 'px'; tip.style.top = (r.top + r.height / 2 - b.top) + 'px'; tip.classList.add('show');
    });
    c.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });

  // YoY chips (ปีข้อมูล 67 vs 66 ต่อไตรมาส)
  const share = getTrendData().share, series = sc.series.map(v => v * share);
  $('#q-chips').innerHTML = [1, 2, 3, 4].map(q => {
    const cur = sumIdx(series, periodIdx(2567, q)), prev = sumIdx(series, periodIdx(2566, q));
    return `<div class="q-chip ${S.q === q ? 'on' : ''}">Q${q} · ${qRangeTH(q)}<b>${fmtC(cur)}</b>${yoyBadge(pctChange(cur, prev), 'YoY')} <span>จาก ${fmtC(prev)}</span></div>`;
  }).join('');
  renderMonthlyBedLoad();
}

function renderMonthlyBedLoad() {
  const host = $('#monthly-bed-load');
  if (!host) return;
  const { sc, act, dis } = getTrendData(), capacity = bedCapacity(hospInScope());
  const offset = S.fy === 2567 ? 12 : 0;
  const months = S.data.metadata.months;
  const rows = range(offset, offset + 12).map(i => ({
    label: monthLabel(months[i]),
    services: act[i],
    rate: capacity.beds > 0 ? act[i] / capacity.beds : null
  }));
  const maxRate = Math.max(...rows.map(r => r.rate || 0), 1);
  host.innerHTML = `<div class="card-head"><div><h2>บริการรายเดือนเทียบกับเตียงเปิดจริง · ปีข้อมูล ${S.fy}</h2><p>${esc(sc.label)} · เตียงเปิดจริงรวม ${fmt(capacity.beds)} เตียงจาก ${capacity.withOpenBeds} รพ. · มีข้อมูลจำนวนเตียง ${capacity.withData}/${capacity.totalHospitals} รพ. · ${dis ? 'ตัวเลขรายโรคเป็นค่าประมาณ' : 'ยอดบริการตามเดือนจากข้อมูลต้นทาง'}${S.q ? ` · ไฮไลต์ไตรมาส Q${S.q}` : ''}</p></div></div>
    <div class="month-load-list">${rows.map((r, j) => `<div class="month-load-row ${S.q && Math.floor(j / 3) + 1 === S.q ? 'self' : ''}"><span class="month-load-label"><b>${r.label}</b><small>${fmt(r.services)} บริการ</small></span><span class="hb-bar"><em class="anim-w" style="width:0;background:${HALLOWEEN.pumpkin}" data-w="${r.rate == null ? 0 : (r.rate / maxRate * 100).toFixed(0)}%"></em></span><strong>${r.rate == null ? '—' : r.rate.toFixed(2)}</strong></div>`).join('')}</div>
    <p class="ins-note">สัดส่วน = จำนวนบริการ IPD รวมของพื้นที่ในเดือน ÷ จำนวนเตียงเปิดจริงที่มีข้อมูล (ไม่นับ รพ. ที่ไม่มีข้อมูลหรือระบุ 0 เตียงเป็นจำนวนเตียง) · แสดงบริการต่อเตียงเชิงเปรียบเทียบเท่านั้น เพราะยอดบริการไม่ได้แยกราย รพ. และเตียงไม่มีข้อมูลรายเดือน จึงไม่ใช่จำนวนผู้ป่วยไม่ซ้ำหรืออัตราครองเตียง และใช้ยืนยันว่าเตียงพอ/ว่างจริงไม่ได้</p>`;
  popIn(host);
}

// -----------------------------------------------------------------------------
// 6. NEON TREEMAP (squarified) – คลิกบล็อกโรค → Cross-filter กราฟเส้น
// -----------------------------------------------------------------------------
function squarify(items, x, y, w, h) {
  const total = items.reduce((a, b) => a + b.value, 0), k = w * h / total;
  const nodes = items.map(it => ({ it, area: it.value * k })), out = [];
  let rect = { x, y, w, h }, row = [];
  const worst = (r, side) => { const s = r.reduce((a, n) => a + n.area, 0), mx = Math.max(...r.map(n => n.area)), mn = Math.min(...r.map(n => n.area)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  const layout = r => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (rect.w >= rect.h) { const cw = s / rect.h; let yy = rect.y; r.forEach(n => { const hh = n.area / cw; out.push({ it: n.it, x: rect.x, y: yy, w: cw, h: hh }); yy += hh; }); rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h }; }
    else { const rh = s / rect.w; let xx = rect.x; r.forEach(n => { const ww = n.area / rh; out.push({ it: n.it, x: xx, y: rect.y, w: ww, h: rh }); xx += ww; }); rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh }; }
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(rect.w, rect.h), n = nodes[i];
    if (!row.length || worst([...row, n], side) <= worst(row, side)) { row.push(n); i++; } else { layout(row); row = []; }
  }
  if (row.length) layout(row);
  return out;
}
const RAMP_TM = [HALLOWEEN.purpleDark, '#4c1d95', HALLOWEEN.purpleMid, HALLOWEEN.purple, HALLOWEEN.orangeDark, HALLOWEEN.pumpkin];
function hex2rgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function rampColor(t) {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP_TM.length - 1), i = Math.min(Math.floor(x), RAMP_TM.length - 2), f = x - i;
  const a = hex2rgb(RAMP_TM[i]), b = hex2rgb(RAMP_TM[i + 1]);
  return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * f).toString(16).padStart(2, '0')).join('');
}

const tmEls = {};
function renderTreemap() {
  const host = $('#treemap'); if (!host || !host.clientWidth) return;
  const sc = getScope(), W = host.clientWidth, H = host.clientHeight;
  const items = sc.diseases.slice().sort((a, b) => b.cases - a.cases).map(d => ({ d, value: d.cases }));
  const c = cmp(sc.series), ratio = c.cur / sc.total24;
  const rects = squarify(items, 0, 0, W, H);
  const mx = Math.max(...items.map(i => i.value)), mn = Math.min(...items.map(i => i.value));
  const seen = new Set();
  rects.forEach(r => {
    const d = r.it.d; seen.add(d.pdx);
    let el = tmEls[d.pdx];
    if (!el) {
      el = tmEls[d.pdx] = document.createElement('button');
      el.className = 'tm-tile'; el.type = 'button'; el.style.opacity = 0;
      el.addEventListener('click', () => toggleDisease(d.pdx));
      host.appendChild(el); requestAnimationFrame(() => { el.style.opacity = ''; });
    }
    const t = Math.pow((d.cases - mn) / ((mx - mn) || 1), 0.55), colr = rampColor(t), g = 4;
    el.style.left = (r.x + g / 2) + 'px'; el.style.top = (r.y + g / 2) + 'px'; el.style.width = Math.max(r.w - g, 0) + 'px'; el.style.height = Math.max(r.h - g, 0) + 'px';
    el.style.setProperty('--tc', colr); el.style.setProperty('--tg', (6 + t * 28).toFixed(0) + 'px');
    el.className = 'tm-tile' + (r.w < 110 || r.h < 74 ? ' sm' : '') + (r.w < 62 || r.h < 46 ? ' xs' : '') + (S.disease === d.pdx ? ' sel' : '');
    el.title = `${d.pdx} · ${d.name_th} · ${d.name_en}\n24 เดือน: ${fmt(d.cases)} ราย (${(d.cases / sc.total24 * 100).toFixed(2)}%)`;
    el.innerHTML = `<span class="c">${esc(d.pdx)}</span><span class="n">${esc(d.name_th)}</span><span class="v">${fmt(d.cases * ratio)}</span><span class="p">${(d.cases / sc.total24 * 100).toFixed(2)}% ของเคสทั้งหมด</span>`;
  });
  Object.keys(tmEls).forEach(k => { if (!seen.has(k)) { tmEls[k].remove(); delete tmEls[k]; } });
  $('#tm-wrap').classList.toggle('has-sel', !!S.disease);
  $('#tm-caption').textContent = `${sc.label} · ${periodLabel()}`;
  $('#tm-note').innerHTML = `<b>หมายเหตุ</b> ข้อมูลต้นทางให้จำนวนเคสต่อโรครวม 24 เดือน ไม่ได้แยกรายเดือนต่อโรค — ตัวเลขในบล็อกคือสัดส่วนโรค × ยอดรวมของช่วงเวลาที่เลือก (ค่าประมาณ) ดังนั้น YoY รายโรคจึงมีค่าเท่ากับ YoY ภาพรวม`;
}
function toggleDisease(pdx) {
  S.disease = S.disease === pdx ? null : pdx;
  renderScopeChips(); renderTrend();
  $$('.tm-tile').forEach(el => el.classList.toggle('sel', !!S.disease && el.querySelector('.c').textContent === S.disease));
  $('#tm-wrap').classList.toggle('has-sel', !!S.disease);
  $('#trend-svg').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
}

// -----------------------------------------------------------------------------
// 7. REFERRAL ROUTING (ส่งต่อผู้ป่วยอัจฉริยะ)
// -----------------------------------------------------------------------------
let refMap = null, refMarkers = null, refRouteLayer = null;
const refLayerByKey = {};
let refStats = {};
function computeRefStats() {
  refStats = {};
  S.hospitals.forEach(h => {
    const k = S.codeIdx[Math.round(+h.prov_id / 100)]; if (!k) return;
    const st = refStats[k] = refStats[k] || { total: 0, beds: 0, withData: 0, withOpenBeds: 0, occupiedBeds: 0, occupancyBeds: 0, occupancyHospitals: 0 };
    st.total++;
    if (Number.isFinite(h.beds) && h.beds >= 0) st.withData++;
    if (Number.isFinite(h.beds) && h.beds > 0) {
      st.withOpenBeds++;
      st.beds += h.beds;
      const occupancy = occupancyStatus(h);
      if (occupancy.available != null) {
        st.occupancyHospitals++;
        st.occupancyBeds += h.beds;
        st.occupiedBeds += occupancy.occupiedBeds;
      }
    }
  });
}
function refPolyStyle(key) {
  if (!key) return { weight: 0.5, color: 'rgba(196,181,213,0.3)', fillColor: HALLOWEEN.purpleDark, fillOpacity: 0.4, interactive: false };
  const p = S.data.provinces[key], st = refStats[key];
  const noOccupancy = !st || !st.occupancyHospitals;
  const rate = noOccupancy ? null : st.occupiedBeds / st.occupancyBeds * 100;
  const sel = S.ref.prov === key;
  const dim = (S.region !== 'all' && p.region !== S.region) || (S.ref.prov && !sel);
  const fill = rate == null ? HALLOWEEN.purpleDark : rate >= 100 ? '#ef4444' : rate >= 90 ? HALLOWEEN.pumpkin : HALLOWEEN.slime;
  return { weight: sel ? 2.4 : 0.8, color: sel ? HALLOWEEN.text : 'rgba(196,181,213,0.45)', fillColor: fill, fillOpacity: dim ? 0.14 : noOccupancy ? 0.35 : 0.5 };
}
function refTip(key) {
  const p = S.data.provinces[key], st = refStats[key];
  if (!st) return `<b>${esc(p.name_th)}</b><br>ไม่มีข้อมูล รพ. ในชุดนี้`;
  const rate = st.occupancyBeds > 0 ? st.occupiedBeds / st.occupancyBeds * 100 : null;
  return `<b>${esc(p.name_th)}</b><br>สัดส่วนครองเตียงย้อนหลังรวม ${rate == null ? 'ไม่มีข้อมูล' : rate.toFixed(1) + '%'} · ${st.occupancyHospitals}/${st.total} รพ. มีข้อมูลในชุดนี้<br>เตียงที่ครอบคลุม ${fmt(st.occupancyBeds)} · ผู้ป่วยครองเตียง ${fmt(st.occupiedBeds)}<br>เป็นค่ารวมย้อนหลัง ไม่ใช่สถานะรายโรงพยาบาลหรือสถานะปัจจุบัน`;
}
function toggleRefProv(key) {
  S.ref.prov = S.ref.prov === key ? null : key;
  if (S.ref.prov) { const ls = refLayerByKey[key] || []; let b = null; ls.forEach(l => { const lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); }); if (b) refMap.flyToBounds(b, { padding: [40, 40], maxZoom: 9, duration: 0.9 }); }
  else refMap.flyToBounds(CONFIG.NATIONAL_BOUNDS, { padding: [10, 10], duration: 0.9 });
  S.ref.hcode = null; renderReferral();
}
function bindReferralUI() {
  $('#ref-q').addEventListener('input', debounce(e => { S.ref.q = e.target.value.trim(); renderReferral(); }, 120));
  $('#ref-status').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ref.status = b.dataset.s; setSeg('#ref-status', 's', S.ref.status); renderReferral(); });
  $('#ref-occupancy-file').addEventListener('change', importOccupancyCSV);
  $('#ref-occupancy-template').addEventListener('click', downloadOccupancyTemplate);
  $('#ref-occupancy-clear').addEventListener('click', () => {
    S.ref.occupancy.clear();
    S.ref.occupancyFileName = null;
    S.ref.hcode = null;
    renderReferral();
    showToast('ล้างข้อมูลครองเตียงที่นำเข้าแล้ว ขณะนี้ไม่สามารถยืนยันสถานะเต็ม/ว่างได้', 'info');
  });
}
function parseCSV(text) {
  const rows = [], row = [];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row.splice(0));
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (quoted) throw new Error('พบเครื่องหมายอัญประกาศที่ไม่ปิดในไฟล์ CSV');
  return rows;
}
function csvHeaderIndex(headers, candidates) {
  return headers.findIndex(header => candidates.includes(header.trim().toLowerCase().replace(/^\uFEFF/, '')));
}
async function importOccupancyCSV(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch (utf8Error) {
      try { text = new TextDecoder('windows-874', { fatal: true }).decode(buffer); }
      catch (encodingError) { throw new Error('อ่าน encoding ของไฟล์ไม่ได้ กรุณาบันทึกเป็น CSV UTF-8'); }
    }
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('ไฟล์ CSV ไม่มีข้อมูล');
    const headers = rows[0].map(value => value.trim().toLowerCase().replace(/^\uFEFF/, ''));
    const hcodeIndex = csvHeaderIndex(headers, ['hcode', 'hospital_code', 'รหัสโรงพยาบาล', 'รหัส รพ.']);
    const occupiedIndex = csvHeaderIndex(headers, ['occupied_beds', 'occupied beds', 'จำนวนผู้ป่วยครองเตียง', 'ผู้ป่วยครองเตียง']);
    const updatedIndex = csvHeaderIndex(headers, ['updated_at', 'updated at', 'วันที่เวลาอัปเดต', 'เวลาอัปเดต']);
    if (hcodeIndex < 0 || occupiedIndex < 0 || updatedIndex < 0) {
      throw new Error('ต้องมีคอลัมน์ hcode, occupied_beds และ updated_at ตามไฟล์แม่แบบ');
    }
    const knownCodes = new Set(S.hospitals.map(h => h.hcode));
    const imported = new Map(), duplicates = new Set();
    let invalidRows = 0, unmatchedRows = 0;
    rows.slice(1).forEach(values => {
      const hcode = (values[hcodeIndex] || '').trim();
      const occupiedText = (values[occupiedIndex] || '').trim();
      const updatedAt = (values[updatedIndex] || '').trim();
      if (!hcode && !occupiedText && !updatedAt) return;
      const occupiedBeds = Number(occupiedText);
      const parsedDate = new Date(updatedAt);
      if (!hcode || !occupiedText || !Number.isInteger(occupiedBeds) || occupiedBeds < 0 || !updatedAt || Number.isNaN(parsedDate.getTime())) {
        invalidRows++;
        return;
      }
      if (!knownCodes.has(hcode)) { unmatchedRows++; return; }
      if (imported.has(hcode)) { duplicates.add(hcode); return; }
      imported.set(hcode, { occupiedBeds, updatedAt: parsedDate.toISOString() });
    });
    if (duplicates.size) throw new Error(`พบรหัสโรงพยาบาลซ้ำ ${duplicates.size} รหัส กรุณาแก้ไฟล์ก่อนนำเข้า`);
    if (!imported.size) throw new Error('ไม่พบแถวข้อมูลที่ใช้ได้ ตรวจรหัส รพ. จำนวนครองเตียง และเวลาอัปเดต');
    S.ref.occupancy = imported;
    S.ref.occupancyFileName = file.name;
    const firstPriority = S.hospitals.find(h => ['FULL', 'NEAR_FULL'].includes(occupancyStatus(h).key) && (S.data.referral_routes[h.hcode] || []).some(r => targetOccupancy(r)));
    S.ref.hcode = firstPriority ? firstPriority.hcode : S.hospitals.find(h => imported.has(h.hcode))?.hcode || null;
    renderReferral();
    showToast(`นำเข้าข้อมูลครองเตียง ${imported.size} โรงพยาบาล${invalidRows ? ` · ข้ามแถวไม่ถูกต้อง ${invalidRows}` : ''}${unmatchedRows ? ` · ไม่พบรหัสในระบบ ${unmatchedRows}` : ''}`, invalidRows || unmatchedRows ? 'warn' : 'success');
  } catch (error) {
    showToast(`นำเข้าไฟล์ครองเตียงไม่สำเร็จ: ${error.message}`, 'warn');
  }
}
function downloadOccupancyTemplate() {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [['hcode', 'hospital_name', 'beds_open', 'occupied_beds', 'updated_at']];
  S.hospitals.forEach(h => rows.push([h.hcode, h.hname, Number.isFinite(h.beds) ? h.beds : '', '', '']));
  download('ipd_occupancy_template.csv', '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function targetHospital(route) {
  return S.hospitals.find(h => h.hcode === route.target_hcode) || null;
}
function targetOccupancy(route) {
  const target = targetHospital(route);
  if (!target) return null;
  const status = occupancyStatus(target);
  return status.available != null ? { target, ...status } : null;
}
function initRefMap() {
  if (refMap) { refMap.invalidateSize(); return; }
  refMap = L.map('ref-map', { zoomControl: true, attributionControl: false, zoomSnap: 0.25, scrollWheelZoom: true, minZoom: 5 });
  refMap.fitBounds(CONFIG.NATIONAL_BOUNDS, { padding: [10, 10], animate: false });
  refMap.setMaxBounds(L.latLngBounds(CONFIG.NATIONAL_BOUNDS).pad(0.4));
  if (S.geoFC) {
    L.geoJSON(S.geoFC, {
      style: f => refPolyStyle(f._key),
      onEachFeature: (f, layer) => {
        const key = f._key; if (!key) return;
        (refLayerByKey[key] = refLayerByKey[key] || []).push(layer);
        layer.on({
          click: e => { L.DomEvent.stopPropagation(e); toggleRefProv(key); },
          mouseover: () => layer.setStyle({ weight: 2, color: HALLOWEEN.pumpkin }),
          mouseout: () => layer.setStyle(refPolyStyle(key))
        });
        layer.bindTooltip(() => refTip(key), { sticky: true, className: 'glass-tip' });
      }
    }).addTo(refMap);
  }
  refMarkers = L.layerGroup().addTo(refMap); refRouteLayer = L.layerGroup().addTo(refMap);
  refMap.on('click', () => { if (S.ref.prov) toggleRefProv(S.ref.prov); });
}
function refList() {
  const q = S.ref.q.toLowerCase();
  return S.hospitals.filter(h => {
    if (S.province && h.prov_id !== S.data.provinces[S.province].code) return false;
    if (S.ref.prov && h.prov_id !== S.data.provinces[S.ref.prov].code) return false;
    if (S.region !== 'all' && h.region !== S.region) return false;
    const occupancy = occupancyStatus(h);
    if (S.ref.status === 'HAS_AVAILABLE' && !(occupancy.available > 0)) return false;
    if (S.ref.status !== 'all' && S.ref.status !== 'HAS_AVAILABLE' && occupancy.key !== S.ref.status) return false;
    return !q || h.hname.toLowerCase().includes(q) || (h.prov_th || '').includes(q) || h.hcode.includes(q);
  }).sort((a, b) => {
    const rank = { FULL: 0, NEAR_FULL: 1, AVAILABLE: 2, UNKNOWN_OCCUPANCY: 3 };
    const aStatus = occupancyStatus(a), bStatus = occupancyStatus(b);
    const statusDiff = rank[aStatus.key] - rank[bStatus.key];
    if (statusDiff) return statusDiff;
    if (aStatus.key === 'AVAILABLE') return bStatus.available - aStatus.available;
    if (aStatus.rate != null && bStatus.rate != null) return bStatus.rate - aStatus.rate;
    return 0;
  });
}
function validHospCoords(h) {
  return Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.lat >= 5.5 && h.lat <= 20.6 && h.lng >= 97.3 && h.lng <= 105.7;
}
function straightLineKm(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat), lngDelta = radians(b.lng - a.lng);
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)) * 10) / 10;
}
function sortedRoutes(h) {
  const prepared = S.data.referral_routes[h.hcode] || [];
  if (prepared.length || !validHospCoords(h)) return prepared.slice().sort((a, b) => b.match_score - a.match_score);
  return S.hospitals
    .filter(target => target.hcode !== h.hcode && validHospCoords(target) && Number.isFinite(target.beds) && target.beds > 0)
    .map(target => ({
      target_hcode: target.hcode,
      target_name: target.hname,
      target_prov: target.prov_th,
      target_lat: target.lat,
      target_lng: target.lng,
      distance_km: straightLineKm(h, target),
      fallback_distance: true
    }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 5);
}
function targetAvailableBeds(route) { return targetOccupancy(route)?.available ?? null; }

function renderReferral() {
  if (!refMap) initRefMap();
  computeRefStats();
  Object.entries(refLayerByKey).forEach(([k, ls]) => ls.forEach(l => l.setStyle(refPolyStyle(k))));
  const importedRows = [...S.ref.occupancy.values()];
  const latestUpdate = importedRows.reduce((latest, record) => record.updatedAt > latest ? record.updatedAt : latest, '');
  const historicalHospitals = S.hospitals.filter(h => Number.isFinite(h.occupied_beds) && Number.isFinite(h.beds) && h.beds > 0).length;
  const routeOrigins = Object.keys(S.data.referral_routes || {}).length;
  const routeTargets = new Set(Object.values(S.data.referral_routes || {}).flat().map(route => route.target_hcode)).size;
  const mappedHospitals = S.hospitals.filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.lat >= 5.5 && h.lat <= 20.6 && h.lng >= 97.3 && h.lng <= 105.7).length;
  const months = S.data.metadata.months;
  const servicePeriod = months && months.length
    ? `${monthLabel(months[0])}–${monthLabel(months[months.length - 1])}`
    : 'ไม่ระบุช่วงเวลา';
  $('#ref-occupancy-status').textContent = importedRows.length
    ? `ใช้ข้อมูลจาก ${S.ref.occupancyFileName || 'ไฟล์ที่นำเข้า'} ทับค่าประวัติ ${importedRows.length} โรงพยาบาล · เวลาในไฟล์ล่าสุด ${occupancyUpdatedLabel({ updatedAt: latestUpdate })} · ไฟล์นี้อยู่ในเบราว์เซอร์ชั่วคราว`
    : `ใช้ค่าครองเตียงย้อนหลังจากชุดข้อมูลหลัก ${historicalHospitals} โรงพยาบาล · ตัวชี้วัดเตียงไม่มีเดือน/วันอ้างอิงแยก จึงใช้ดูรูปแบบในอดีตเท่านั้น ไม่ใช่สถานะปัจจุบัน`;
  $('#ref-coverage').textContent = `ขอบเขต: โรงพยาบาลในข้อมูลหลัก ${fmt(S.hospitals.length)} แห่ง · มีค่าครองเตียง ${fmt(historicalHospitals)} แห่ง · เส้นทางที่เตรียมไว้ครอบคลุมต้นทาง ${fmt(routeOrigins)}/${fmt(S.hospitals.length)} แห่ง และปลายทาง ${fmt(routeTargets)} แห่ง · มีพิกัดแสดงบนแผนที่ ${fmt(mappedHospitals)} แห่ง · ยอดบริการรายเดือน ${servicePeriod}`;
  $('#ref-legend').innerHTML = `<div class="lg-title">สัดส่วนครองเตียงย้อนหลังรวมรายจังหวัด</div>
    <div class="lg-row"><i style="background:#ef4444"></i>ตั้งแต่ 100% (ยอดรวม รพ. ที่มีข้อมูล)</div>
    <div class="lg-row"><i style="background:${HALLOWEEN.pumpkin}"></i>90–ต่ำกว่า 100%</div>
    <div class="lg-row"><i style="background:${HALLOWEEN.slime}"></i>ต่ำกว่า 90%</div>
    <div class="lg-row"><i style="background:${HALLOWEEN.muted}"></i>ไม่มีข้อมูลครองเตียง</div>
    `;
  $('#ref-prov-chip').innerHTML = S.ref.prov ? `<span class="chip">จ.${esc(S.data.provinces[S.ref.prov].name_th)} <button data-x aria-label="ล้างจังหวัด">×</button></span>` : '<span style="color:var(--muted);font-size:12px">คลิกจังหวัดบนแผนที่เพื่อกรองรายการ รพ.</span>';
  const chipBtn = $('#ref-prov-chip button'); if (chipBtn) chipBtn.onclick = () => toggleRefProv(S.ref.prov);
  const occupancyCounts = S.hospitals.reduce((counts, h) => {
    const status = occupancyStatus(h);
    counts[status.key]++;
    if (status.available > 0) counts.HAS_AVAILABLE++;
    return counts;
  }, { FULL: 0, NEAR_FULL: 0, AVAILABLE: 0, UNKNOWN_OCCUPANCY: 0, HAS_AVAILABLE: 0 });
  Object.entries(occupancyCounts).forEach(([status, count]) => {
    const button = $(`#ref-status [data-s="${status}"]`);
    if (button) button.textContent = `${button.dataset.label} (${count})`;
  });
  const list = refList();
  if (!S.ref.hcode || !S.hospitals.some(h => h.hcode === S.ref.hcode)) S.ref.hcode = (list.find(h => (S.data.referral_routes[h.hcode] || []).length) || list[0] || {}).hcode || null;
  $('#ref-items').innerHTML = list.slice(0, 200).map(h => {
    const st = occupancyStatus(h);
    const occupiedBeds = st.occupiedBeds;
    const excess = st.available != null ? Math.max(0, occupiedBeds - h.beds) : 0;
    const sourceLabel = st.record ? `นำเข้า ${occupancyUpdatedLabel(st.record)}` : 'ข้อมูลย้อนหลัง · ไม่ระบุเดือนอ้างอิง';
    const occupancy = st.available == null ? 'ไม่มีข้อมูลครองเตียงย้อนหลัง' : `ครอง ${fmt(occupiedBeds)}/${fmt(h.beds)} · ${excess ? `เกินเตียงเปิด ${fmt(excess)}` : `ส่วนต่าง ${fmt(st.available)} เตียง`} · ${sourceLabel}`;
    return `<li data-h="${h.hcode}" class="${h.hcode === S.ref.hcode ? 'on' : ''}"><div class="t"><span><i class="sdot" style="background:${st.color};box-shadow:0 0 8px ${st.color}"></i>${esc(h.hname)}</span><span style="color:${st.color}">${st.rate == null ? '—' : st.rate.toFixed(0) + '%'}</span></div><div class="s">${esc(h.prov_th)} · ${st.label} · ${occupancy}</div></li>`;
  }).join('') || '<li style="color:var(--muted);cursor:default">ไม่พบโรงพยาบาลตามเงื่อนไข</li>';
  $$('#ref-items li[data-h]').forEach(li => li.addEventListener('click', () => { S.ref.hcode = li.dataset.h; renderReferral(); focusRefSource(); }));

  refMarkers.clearLayers();
  list.forEach(h => {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng) || h.lat < 5.5 || h.lat > 20.6 || h.lng < 97.3 || h.lng > 105.7) return;
    const occ = occupancyStatus(h);
    const excess = occ.available != null ? Math.max(0, occ.occupiedBeds - h.beds) : 0;
    const occText = occ.available == null ? 'ไม่มีข้อมูลครองเตียงย้อนหลัง' : `${occ.label} · ครอง ${fmt(occ.occupiedBeds)}/${fmt(h.beds)} · ${excess ? `เกินเตียงเปิด ${fmt(excess)}` : `ส่วนต่าง ${fmt(occ.available)} เตียง`} (${occ.rate.toFixed(1)}%) · ${occ.record ? `นำเข้า ${occupancyUpdatedLabel(occ.record)}` : 'ช่วงอ้างอิงในชุดข้อมูลไม่ระบุ'}`;
    L.circleMarker([h.lat, h.lng], { radius: h.hcode === S.ref.hcode ? 9 : 3 + Math.sqrt(h.beds || 0) / 13, color: h.hcode === S.ref.hcode ? '#fff' : occ.color, weight: h.hcode === S.ref.hcode ? 2.5 : 1, fillColor: occ.color, fillOpacity: 0.75 })
      .bindTooltip(`<b>${esc(h.hname)}</b><br>${esc(occText)} · เป็นข้อมูลย้อนหลัง ไม่ใช้ยืนยันสถานะปัจจุบัน`, { className: 'glass-tip' })
      .on('click', () => { S.ref.hcode = h.hcode; renderReferral(); focusRefSource(); }).addTo(refMarkers);
  });
  renderReferralRouting();
}

function renderReferralRouting() {
  const h = S.hospitals.find(x => x.hcode === S.ref.hcode);
  const side = $('#ref-side');
  refRouteLayer && refRouteLayer.clearLayers();
  if (!h) { side.innerHTML = '<p style="color:var(--muted)">เลือกโรงพยาบาลต้นทางจากรายการด้านซ้าย</p>'; return; }
  const st = occupancyStatus(h), routes = sortedRoutes(h);
  const hasPrecomputedRoutes = Boolean((S.data.referral_routes[h.hcode] || []).length);
  const hasFallbackRoutes = !hasPrecomputedRoutes && routes.some(route => route.fallback_distance);
  const destinations = routes.filter(r => (targetAvailableBeds(r) || 0) > 0);
  const candidates = routes.filter(candidatesForReferral);
  destinations.forEach(r => {
    if (Number.isFinite(h.lat) && Number.isFinite(h.lng) && Number.isFinite(r.target_lat) && Number.isFinite(r.target_lng)) L.polyline([[h.lat, h.lng], [r.target_lat, r.target_lng]], { color: HALLOWEEN.purple, weight: 2, opacity: 0.7, dashArray: '6 6' }).addTo(refRouteLayer);
    if (Number.isFinite(r.target_lat) && Number.isFinite(r.target_lng)) L.circleMarker([r.target_lat, r.target_lng], { radius: 7, color: HALLOWEEN.purple, fillColor: '#120a1f', fillOpacity: 1, weight: 2 }).bindTooltip(esc(r.target_name), { className: 'glass-tip' }).addTo(refRouteLayer);
  });
  candidates.forEach(r => {
    if (Number.isFinite(h.lat) && Number.isFinite(h.lng) && Number.isFinite(r.target_lat) && Number.isFinite(r.target_lng)) L.polyline([[h.lat, h.lng], [r.target_lat, r.target_lng]], { color: HALLOWEEN.muted, weight: 1.5, opacity: 0.55, dashArray: '3 6' }).addTo(refRouteLayer);
    if (Number.isFinite(r.target_lat) && Number.isFinite(r.target_lng)) L.circleMarker([r.target_lat, r.target_lng], { radius: 6, color: HALLOWEEN.muted, fillColor: '#120a1f', fillOpacity: 1, weight: 2, dashArray: '3 3' }).bindTooltip(`${esc(r.target_name)} · ยังไม่ยืนยันเตียงว่าง`, { className: 'glass-tip' }).addTo(refRouteLayer);
  });
  const overCapacity = st.available != null && Number.isFinite(h.beds) ? Math.max(0, st.occupiedBeds - h.beds) : 0;
  const sourceState = st.available == null
    ? 'ไม่มีข้อมูลผู้ป่วยครองเตียงย้อนหลังของโรงพยาบาลนี้'
    : `${st.label} · ครอง ${fmt(st.occupiedBeds)}/${fmt(h.beds)} เตียง (${st.rate.toFixed(1)}%) · ${overCapacity ? `เกินเตียงเปิด ${fmt(overCapacity)} เตียง` : `ส่วนต่างตามข้อมูล ${fmt(st.available)} เตียง`} · ${st.record ? `นำเข้า ${occupancyUpdatedLabel(st.record)}` : 'ช่วงอ้างอิงในชุดข้อมูลไม่ระบุ'}`;
  side.innerHTML = `
    <div class="ins-note"><b>${S.ref.occupancy.size ? `กำลังใช้ไฟล์นำเข้า ${esc(occupancyUpdatedLabel({ updatedAt: [...S.ref.occupancy.values()].reduce((latest, record) => record.updatedAt > latest ? record.updatedAt : latest, '') }))}` : 'กำลังใช้ข้อมูลครองเตียงย้อนหลังจากชุดข้อมูลหลัก'}</b> · ตัวเลขใช้เปรียบเทียบภายในชุดข้อมูล ไม่ใช่สถานะปัจจุบัน</div>
    <div class="ref-src">
      <h3>${esc(h.hname)}</h3>
      <div style="color:var(--muted);font-size:12.5px">${esc(h.prov_th)} · ${esc(h.zone_name)} · ${esc(h.tier)}</div>
      <div style="display:flex;align-items:flex-end;gap:12px;margin-top:8px">
        <div class="bed-count" style="color:${st.color}">${st.rate == null ? '—' : st.rate.toFixed(1) + '%'}</div>
        <div style="font-size:12.5px;color:var(--muted);padding-bottom:5px">สัดส่วนผู้ป่วยครองเตียง<br>${esc(st.label)}</div>
      </div>
      <div style="font-size:13px;margin-top:6px">${esc(sourceState)}</div>
    </div>
    ${hasPrecomputedRoutes ? '' : `<p class="ins-note">${hasFallbackRoutes ? 'ไม่มีเส้นทางจับคู่ที่เตรียมไว้ จึงเรียงโรงพยาบาลที่มีพิกัดตามระยะเส้นตรงเท่านั้น ไม่ใช่เส้นทางถนนหรือคะแนนความเหมาะสม' : 'ไม่มีเส้นทางที่เตรียมไว้หรือพิกัดเพียงพอสำหรับแนะนำโรงพยาบาลใกล้เคียง'} · เส้นทางจับคู่ที่เตรียมไว้ครอบคลุม ${Object.keys(S.data.referral_routes || {}).length}/${S.hospitals.length} โรงพยาบาลต้นทาง</p>`}
    <h4 style="margin-top:14px;font-size:14px">โรงพยาบาลปลายทางที่มีส่วนต่างเตียงตามข้อมูลย้อนหลัง (${destinations.length})</h4>
    ${destinations.length ? destinations.map((r, i) => `
      <div class="route ${i === 0 ? 'best' : ''}">
        <div class="r1"><span>${esc(r.target_name)}</span><span class="badge ok">ส่วนต่างประมาณ ${fmt(targetAvailableBeds(r))} เตียง</span></div>
        <div class="r2"><span>${esc(r.target_prov)}</span><span>ครองเตียงย้อนหลัง <b>${targetOccupancy(r).rate.toFixed(1)}%</b></span><span>${targetOccupancy(r).record ? `นำเข้า ${esc(occupancyUpdatedLabel(targetOccupancy(r).record))}` : 'วันอ้างอิงไม่ระบุ'}</span><span>${r.fallback_distance ? 'ระยะเส้นตรง' : 'ห่าง'} <b>${r.distance_km}</b> กม.</span>${r.fallback_distance ? '' : `<span>ETA <b>${r.transit_mins}</b> นาที</span><span>คะแนนจับคู่ <b>${r.match_score}</b></span>`}</div>
      </div>`).join('') : '<p class="ins-note">ไม่พบโรงพยาบาลปลายทางที่มีข้อมูลเตียงย้อนหลังในเส้นทางนี้</p>'}
    <h4 style="margin-top:14px;font-size:14px">${hasFallbackRoutes ? 'โรงพยาบาลพิกัดใกล้ที่สุด (ระยะเส้นตรง)' : 'โรงพยาบาลใกล้เคียงที่ควรโทรสอบถาม'} (${candidates.length})</h4>
    ${candidates.length ? candidates.map(r => {
      const target = targetHospital(r);
      return `<div class="route">
        <div class="r1"><span>${esc(r.target_name)}</span><span class="badge">ยังไม่ยืนยันเตียงว่าง</span></div>
        <div class="r2"><span>${esc(r.target_prov)}</span><span>เตียงเปิดจริง ${fmt(target.beds)} เตียง (ไม่ใช่จำนวนเตียงว่าง)</span><span>${r.fallback_distance ? 'ระยะเส้นตรง' : 'ห่าง'} <b>${r.distance_km}</b> กม.</span>${r.fallback_distance ? '' : `<span>ETA <b>${r.transit_mins}</b> นาที</span><span>คะแนนจับคู่ <b>${r.match_score}</b></span>`}</div>
      </div>`;
    }).join('') : '<p style="color:var(--muted)">ไม่พบโรงพยาบาลใกล้เคียงที่มีข้อมูลเตียงเปิดจริงในชุดเส้นทางนี้</p>'}
    <p class="ins-note">${hasFallbackRoutes ? 'รายชื่อคำนวณจากระยะเส้นตรงระหว่างพิกัด ไม่ใช่เส้นทางถนนหรือความเหมาะสมทางคลินิก' : 'รายชื่อเรียงตามคะแนนจับคู่จากชุดเส้นทาง'} · “ส่วนต่างเตียง” คำนวณจากเตียงเปิดจริงลบผู้ป่วยครองเตียง ไม่เท่ากับเตียงว่างที่ยืนยันจริง และช่วงอ้างอิงของค่าครองเตียงไม่ได้ระบุแยกรายตัวชี้วัด</p>`;
}
function focusRefSource() {
  const h = S.hospitals.find(x => x.hcode === S.ref.hcode); if (!h || !refMap) return;
  const pts = [];
  if (Number.isFinite(h.lat) && Number.isFinite(h.lng)) pts.push([h.lat, h.lng]);
  sortedRoutes(h).filter(r => (targetAvailableBeds(r) || 0) > 0 || candidatesForReferral(r)).forEach(r => {
    if (Number.isFinite(r.target_lat) && Number.isFinite(r.target_lng)) pts.push([r.target_lat, r.target_lng]);
  });
  if (pts.length) refMap.flyToBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 10, duration: 0.9 });
}
function candidatesForReferral(route) {
  const target = targetHospital(route);
  return Boolean(target && Number.isFinite(target.beds) && target.beds > 0 && occupancyStatus(target).available == null);
}
function recalcHosp(h) {
  const st = hospStatus(h);
  h.status = st.key;
  h.status_th = st.th;
  h.status_color = st.color;
}
// -----------------------------------------------------------------------------
// 8. DATA AUDIT – ตารางคัดกรองข้อมูลดิบ + ไฮไลต์แถว Error สีส้มสะท้อนแสง
// -----------------------------------------------------------------------------
const RULES = {
  BED_INVALID: { sev: 'e', label: 'จำนวนเตียงเปิดจริงไม่ถูกต้อง' },
  BED_DATA_UNKNOWN: { sev: 'w', label: 'ไม่มีข้อมูลจำนวนเตียง' },
  NO_OPEN_BEDS: { sev: 'w', label: 'ไม่มีเตียงเปิดใช้งานจริง' },
  COORD_MISSING: { sev: 'w', label: 'ไม่มีพิกัดสำหรับแสดงบนแผนที่' },
  COORD_OUT: { sev: 'e', label: 'พิกัดอยู่นอกประเทศไทย' },
  COORD_FAR: { sev: 'w', label: 'พิกัดห่างจากจังหวัดมาก' },
  SPIKE: { sev: 'w', label: 'ยอดเดือนล่าสุดผิดปกติ' },
  MOPH_BED: { sev: 'e', label: 'ควรตรวจสอบ: จำนวนเตียงต่างจาก MOPH' },
  NO_ROUTE: { sev: 'w', label: 'ไม่มีเส้นทางส่งต่อ' }
};
function hav(a, b, c, d) { const R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

function auditHospital(h) {
  const out = [], add = (code, text) => out.push({ code, sev: RULES[code].sev, text });
  if (h.bed_data_status === 'zero_open') add('NO_OPEN_BEDS', 'มีข้อมูลจากแหล่งเตียง แต่ระบุว่าไม่มีเตียงเปิดจริง');
  else if (h.bed_data_status === 'unknown' || h.beds == null) add('BED_DATA_UNKNOWN', 'ไม่มีข้อมูลจำนวนเตียงเปิดจริง');
  else if (!Number.isFinite(h.beds) || !Number.isInteger(h.beds) || h.beds < 0) add('BED_INVALID', `จำนวนเตียง = ${h.beds ?? 'ไม่ระบุ'}`);
  if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) add('COORD_MISSING', 'ไม่มีพิกัด จึงไม่แสดงบนแผนที่ แต่ไม่กระทบยอดบริการหรือจำนวนเตียง');
  else if (!(h.lat >= 5.5 && h.lat <= 20.6 && h.lng >= 97.3 && h.lng <= 105.7)) add('COORD_OUT', `พิกัด ${h.lat}, ${h.lng}`);
  else { const p = Object.values(S.data.provinces).find(x => x.code === h.prov_id); if (p) { const dk = hav(h.lat, h.lng, p.lat, p.lng); if (dk > 120) add('COORD_FAR', `ห่างจุดกลางจังหวัด ${Math.round(dk)} กม.`); } }
  if (h.monthly_avg > 0) { const r = h.current_monthly / h.monthly_avg; if (r > 1.4 || r < 0.6) add('SPIKE', `เดือนล่าสุด ${fmt(h.current_monthly)} เทียบเฉลี่ย ${fmt(h.monthly_avg)} (${r > 1 ? '+' : ''}${((r - 1) * 100).toFixed(0)}%)`); }
  const mo = S.moph && S.moph[h.hcode]; if (mo && mo.bed !== h.beds) add('MOPH_BED', `IPD ${fmt(h.beds)} vs MOPH ${fmt(mo.bed)} · เป็นข้อมูลต่างแหล่งที่ควรตรวจสอบ ยังยืนยันไม่ได้ว่าค่าใดผิด`);
  if (!(S.data.referral_routes[h.hcode] || []).length) add('NO_ROUTE', 'ไม่มีปลายทางแนะนำ');
  return out;
}
function runAudit() { S.issues = new Map(); S.hospitals.forEach(h => S.issues.set(h.hcode, auditHospital(h))); }
const rowSev = list => (list.some(i => i.sev === 'e') ? 'err' : list.length ? 'warn' : 'ok');

function bindAuditUI() {
  $('#aud-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.audit.filter = b.dataset.f; S.audit.page = 1; setSeg('#aud-filter', 'f', S.audit.filter); renderAudit(); });
  $('#aud-q').addEventListener('input', debounce(e => { S.audit.q = e.target.value.trim().toLowerCase(); S.audit.page = 1; renderAudit(); }, 120));
  $('#rule-chips').addEventListener('click', e => { const b = e.target.closest('[data-rule]'); if (!b) return; S.audit.rule = S.audit.rule === b.dataset.rule ? null : b.dataset.rule; S.audit.page = 1; renderAudit(); });
  $('#aud-head').addEventListener('click', e => { const th = e.target.closest('th[data-k]'); if (!th) return; const a = S.audit; a.sortDir = a.sortKey === th.dataset.k ? -a.sortDir : 1; a.sortKey = th.dataset.k; renderAudit(); });
  $('#aud-pager').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (!b) return; S.audit.page += +b.dataset.p; renderAudit(); });
  $('#aud-body').addEventListener('change', e => {
    const inp = e.target.closest('input.cell'); if (!inp) return;
    const h = S.hospitals.find(x => x.hcode === inp.dataset.h), v = Math.max(0, Math.round(Number(inp.value)));
    if (!h || !Number.isFinite(v)) return;
    h[inp.dataset.f] = v;
    h.bed_data_status = v === 0 ? 'zero_open' : 'known';
    h.bed_source = 'manual';
    recalcHosp(h);
    runAudit(); renderAudit(); renderHeaderKPIs(); renderKPIs(); if (S.tab === 'referral') renderReferral();
    showToast(`แก้ไขจำนวนเตียงเปิดจริงของ ${esc(h.hname)} แล้ว และตรวจสอบข้อมูลใหม่`, rowSev(S.issues.get(h.hcode)) === 'err' ? 'warn' : 'success');
  });
  $('#aud-body').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const h = S.hospitals.find(x => x.hcode === b.dataset.h); if (!h) return;
    if (b.dataset.act === 'map') { S.ref.hcode = h.hcode; S.ref.prov = null; S.ref.status = 'all'; S.ref.q = ''; $('#ref-q').value = ''; setSeg('#ref-status', 's', 'all'); setTab('referral'); setTimeout(focusRefSource, 120); }
  });
  $('#aud-csv').addEventListener('click', exportAuditCSV);
  $('#aud-json').addEventListener('click', () => download('hospitals_corrected.json', JSON.stringify({ exported_at: new Date().toISOString(), hospitals: S.hospitals }, null, 1), 'application/json'));
  $('#aud-reset').addEventListener('click', () => { S.hospitals = JSON.parse(JSON.stringify(S.hospOrig)); runAudit(); renderAudit(); renderHeaderKPIs(); renderKPIs(); showToast('คืนค่าข้อมูลโรงพยาบาลเป็นค่าตั้งต้นแล้ว', 'info'); });
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportAuditCSV() {
  const rows = [['hcode', 'hname', 'province', 'beds_opened', 'severity', 'issues']];
  S.hospitals.forEach(h => { const l = S.issues.get(h.hcode); if (l.length) rows.push([h.hcode, h.hname, h.prov_th, h.beds ?? '', rowSev(l) === 'err' ? 'ERROR - REVIEW' : 'WARNING', l.map(i => RULES[i.code].label + ': ' + i.text).join(' | ')]); });
  download('ipd_audit_issues.csv', '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

const AUD_COLS = [
  { k: 'sev', label: 'สถานะ', get: h => ({ err: 0, warn: 1, ok: 2 })[rowSev(S.issues.get(h.hcode))] },
  { k: 'hcode', label: 'รหัส', get: h => h.hcode },
  { k: 'hname', label: 'โรงพยาบาล', get: h => h.hname },
  { k: 'prov', label: 'จังหวัด', get: h => h.prov_th },
  { k: 'beds', label: 'เตียงเปิดจริง (แก้ไขได้)', num: 1, get: h => h.beds },
  { k: 'iss', label: 'ปัญหาที่พบ', get: h => S.issues.get(h.hcode).length },
  { k: 'act', label: 'ดำเนินการ', ns: 1, get: () => 0 }
];
const PAGE = 25;
function renderAudit() {
  const a = S.audit, all = S.hospitals;
  let eRows = 0, wRows = 0, cRows = 0; const ruleCount = {};
  all.forEach(h => { const l = S.issues.get(h.hcode), s = rowSev(l); if (s === 'err') eRows++; else if (s === 'warn') wRows++; else cRows++; new Set(l.map(i => i.code)).forEach(c => { ruleCount[c] = (ruleCount[c] || 0) + 1; }); });
  const sourceAudit = S.data.metadata.bed_quality_audit;
  const duplicateCodes = sourceAudit?.source_csv_duplicate_hcodes;
  const invalidBedRows = sourceAudit?.source_csv_invalid_open_bed_rows;
  const sourceIssueCount = Number.isFinite(duplicateCodes) && Number.isFinite(invalidBedRows)
    ? duplicateCodes + invalidBedRows
    : null;
  const sumHost = $('#audit-sum');
  if (!sumHost.children.length) sumHost.innerHTML = [['rows', 'โรงพยาบาลในชุดข้อมูล', HALLOWEEN.purple], ['err', 'Error / ควรตรวจสอบ', HALLOWEEN.pumpkin], ['warn', 'คำเตือนในข้อมูลโรงพยาบาล', '#fdba74'], ['ok', 'ปกติในข้อมูลโรงพยาบาล', HALLOWEEN.slime], ['source', 'จุดผิดปกติจาก CSV ต้นทาง', HALLOWEEN.pumpkin]].map(([id, t, c]) => `<article class="glass kpi" data-a="${id}" style="--kc:${c}"><h3>${t}</h3><div class="kpi-val"></div>${id === 'source' ? '<small class="kpi-note"></small>' : ''}</article>`).join('');
  [['rows', all.length], ['err', eRows], ['warn', wRows], ['ok', cRows]].forEach(([id, v]) => rollTo($(`[data-a="${id}"] .kpi-val`, sumHost), fmt(v), 900));
  const sourceValue = sourceIssueCount == null ? 'ไม่ทราบ' : fmt(sourceIssueCount);
  rollTo($('[data-a="source"] .kpi-val', sumHost), sourceValue, 900);
  $('[data-a="source"] .kpi-note', sumHost).textContent = sourceIssueCount == null
    ? 'ไฟล์นี้ไม่มีสรุปผลตรวจ CSV ต้นทาง'
    : `รหัสโรงพยาบาลซ้ำ ${fmt(duplicateCodes)} · แถวจำนวนเตียงอ่านไม่ได้ ${fmt(invalidBedRows)}`;

  renderAuditViz();
  $('#rule-chips').innerHTML = a.rule ? `<button class="rchip on" data-rule="${a.rule}">กำลังกรอง: ${RULES[a.rule].label} · ${ruleCount[a.rule] || 0} แถว ✕</button>` : '';

  let rows = all.filter(h => {
    const l = S.issues.get(h.hcode), s = rowSev(l);
    if (a.filter === 'issues' && s === 'ok') return false;
    if (a.filter === 'error' && s !== 'err') return false;
    if (a.filter === 'warn' && s !== 'warn') return false;
    if (a.filter === 'clean' && s !== 'ok') return false;
    if (a.rule && !l.some(i => i.code === a.rule)) return false;
    if (a.q && !(h.hcode + h.hname + h.prov_th + h.prov_en).toLowerCase().includes(a.q)) return false;
    return true;
  });
  const col = AUD_COLS.find(c => c.k === a.sortKey) || AUD_COLS[0];
  rows.sort((x, y) => { const vx = col.get(x), vy = col.get(y); const r = typeof vx === 'string' ? vx.localeCompare(vy, 'th') : vx - vy; return r * (col.k === 'iss' ? -a.sortDir : a.sortDir); });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); a.page = Math.min(Math.max(a.page, 1), pages);
  const slice = rows.slice((a.page - 1) * PAGE, a.page * PAGE);

  $('#aud-head').innerHTML = AUD_COLS.map(c => `<th ${c.ns ? '' : `data-k="${c.k}"`} class="${c.num ? 'num' : ''}">${c.label}${a.sortKey === c.k ? (a.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  $('#aud-body').innerHTML = slice.map(h => {
    const l = S.issues.get(h.hcode), s = rowSev(l);
    return `<tr class="${s === 'ok' ? '' : s}">
      <td>${s === 'err' ? '<b style="color:var(--orange)">ERROR · ตรวจสอบ</b>' : s === 'warn' ? '<span style="color:#fdba74">เตือน</span>' : '<span class="ok-mark">✓ ปกติ</span>'}</td>
      <td>${esc(h.hcode)}</td><td>${esc(h.hname)}<div style="font-size:11px;color:var(--muted)">${esc(h.tier)}</div></td><td>${esc(h.prov_th)}</td>
      <td class="num"><input class="cell" type="number" min="0" value="${h.beds ?? ''}" data-h="${h.hcode}" data-f="beds" aria-label="จำนวนเตียงเปิดจริง ${esc(h.hname)}"></td>
      <td>${l.map(i => `<span class="tag ${i.sev}" title="${esc(i.text)}">${esc(RULES[i.code].label)}</span>`).join('') || '—'}${l.length ? `<div style="font-size:11.5px;color:var(--muted)">${esc(l[0].text)}</div>` : ''}</td>
      <td style="white-space:nowrap"><button class="btn mini" data-act="map" data-h="${h.hcode}">แผนที่</button></td></tr>`;
  }).join('') || `<tr><td colspan="7" style="padding:26px;text-align:center;color:var(--muted)">ไม่พบแถวตามเงื่อนไขที่เลือก</td></tr>`;
  $('#aud-pager').innerHTML = `<span>${fmt(rows.length)} แถว · หน้า ${a.page}/${pages}</span><button class="btn" data-p="-1" ${a.page <= 1 ? 'disabled' : ''}>‹ ก่อนหน้า</button><button class="btn" data-p="1" ${a.page >= pages ? 'disabled' : ''}>ถัดไป ›</button>`;
}

// -----------------------------------------------------------------------------
// 9. TOAST NOTIFICATIONS
// -----------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size:15px">${type === 'success' ? '✅' : type === 'warn' ? '⚠️' : 'ℹ️'}</span>
    <span style="flex:1;font-weight:500;line-height:1.5">${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('in'), 50);
  setTimeout(() => { toast.classList.remove('in'); setTimeout(() => toast.remove(), 400); }, 4500);
}


// -----------------------------------------------------------------------------
// 10. INSIGHTS (หน้าภาพรวม) – โรคเด่น / เรดาร์กลุ่มโรค / เพศ / รพ.ตึง / สรุปอัตโนมัติ
// -----------------------------------------------------------------------------
function popIn(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('[data-w]', root).forEach(e => { e.style.width = e.dataset.w; });
    $$('[data-dash]', root).forEach(e => { e.setAttribute('stroke-dasharray', e.dataset.dash); });
    $$('[data-scale]', root).forEach(e => { e.style.transform = 'scale(1)'; e.style.opacity = 1; });
  }));
}
function weightedDomain(filter) {
  const acc = {}; let tw = 0;
  Object.values(S.data.provinces).filter(filter).forEach(p => { tw += p.total_cases; Object.entries(p.domain_scores || {}).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v * p.total_cases; }); });
  Object.keys(acc).forEach(k => { acc[k] /= tw; });
  return acc;
}
function domainMix(sc) {
  if (sc.level === 'national') return S.data.national.domain_scores;
  if (sc.level === 'province') return sc.ref.domain_scores;
  return weightedDomain(p => p.region === S.region);
}
function radarSVG(vals, base, labels) {
  const cx = 190, cy = 130, R = 84, n = labels.length;
  const mx = Math.ceil(Math.max(...labels.map(l => vals[l.id] || 0), ...labels.map(l => (base && base[l.id]) || 0)) * 1.12 / 10) * 10;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const P = (i, v) => [cx + Math.cos(ang(i)) * R * v / mx, cy + Math.sin(ang(i)) * R * v / mx];
  const poly = (o) => labels.map((l, i) => P(i, o[l.id] || 0).map(x => x.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${labels.map((l, i) => P(i, mx * f).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${HALLOWEEN.grid}"/>`).join('');
  const axes = labels.map((l, i) => { const [x, y] = P(i, mx), c = Math.cos(ang(i)); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(196,181,213,0.16)"/><text x="${(cx + Math.cos(ang(i)) * (R + 16)).toFixed(1)}" y="${(cy + Math.sin(ang(i)) * (R + 16) + 4).toFixed(1)}" text-anchor="${Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'}" fill="${HALLOWEEN.muted}" font-size="10.5">${esc(l.short)}</text>`; }).join('');
  const dots = labels.map((l, i) => { const [x, y] = P(i, vals[l.id] || 0); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${HALLOWEEN.purpleDark}" stroke="${HALLOWEEN.pumpkin}" stroke-width="2"><title>${esc(l.label)}: ${(vals[l.id] || 0).toFixed(1)}%</title></circle>`; }).join('');
  const ori = `${cx}px ${cy}px`;
  return `<svg viewBox="0 0 380 262" width="100%" role="img" aria-label="เรดาร์สัดส่วนกลุ่มโรค">${rings}${axes}
    ${base ? `<polygon points="${poly(base)}" fill="rgba(139,92,246,0.08)" stroke="${HALLOWEEN.purple}" stroke-width="1.6" stroke-dasharray="4 4"/>` : ''}
    <g style="transform-origin:${ori};transform:scale(0.15);opacity:0;transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .5s" data-scale="1"><polygon points="${poly(vals)}" fill="rgba(255,117,24,0.22)" stroke="${HALLOWEEN.pumpkin}" stroke-width="2.2" style="filter:drop-shadow(0 0 6px rgba(255,117,24,.7))"/>${dots}</g></svg>`;
}
function donutSVG(parts, size = 130, thick = 16, center = '') {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, tot = parts.reduce((a, p) => a + p.v, 0) || 1;
  let off = 0;
  const arcs = parts.map(p => { const len = p.v / tot * C, seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${thick}" stroke-dasharray="0 ${C.toFixed(1)}" data-dash="${Math.max(len - 2, 0).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dasharray 1s cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 0 5px ${p.c})"><title>${esc(p.t)}</title></circle>`; off += len; return seg; }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(196,181,213,0.2)" stroke-width="${thick}"/>${arcs}${center}</svg>`;
}

function renderInsights() {
  const host = $('#ins-grid'); if (!host || !S.data) return;
  const d = S.data, sc = getScope(), c = cmp(sc.series), nat = d.national, ratio = c.cur / sc.total24;
  const top = sc.diseases[0], share = top.cases / sc.total24 * 100, tcol = disColor(top);
  const natShare = pdx => { const n = nat.top_diseases.find(x => x.pdx === pdx); return n ? n.cases / nat.total_cases * 100 : null; };
  const lqs = sc.level === 'national' ? [] : sc.diseases.map(x => { const ns = natShare(x.pdx); return ns ? { x, lq: (x.cases / sc.total24 * 100) / ns } : null; }).filter(Boolean).sort((a, b) => b.lq - a.lq);
  const maxC = sc.diseases[0].cases;
  const top5share = sc.diseases.slice(0, 5).reduce((a, x) => a + x.cases, 0) / sc.total24 * 100;

  // ---- hero ----
  const hero = `<article class="glass ins hero" style="--hc:${tcol}">
    <div class="ins-k">โรคเด่นของ ${esc(sc.label)} · ${periodLabel()}</div>
    <h2 class="hero-dis">${esc(shortName(top.name_th))}</h2>
    <div class="hero-sub">${esc(top.pdx)} · ${esc(top.name_en)}</div>
    <div class="hero-stats">
      <div><b>${share.toFixed(2)}%</b><span>ของเคสทั้งหมด</span></div>
      <div><b>${fmt(top.cases * ratio)}</b><span>ราย (ประมาณช่วงที่เลือก)</span></div>
      <div><b>${top5share.toFixed(1)}%</b><span>5 โรคแรกรวมกัน</span></div>
      ${lqs[0] && lqs[0].lq > 1.1 ? `<div><b>${lqs[0].lq.toFixed(2)}×</b><span>${esc(lqs[0].x.pdx)} สูงกว่าค่าประเทศ</span></div>` : ''}
    </div>
    <div class="hb-list">${sc.diseases.slice(0, 6).map(x => `<button class="hb" data-pdx="${esc(x.pdx)}" title="คลิกเพื่อดูแนวโน้มของโรคนี้"><span class="hb-n"><i style="background:${disColor(x)}"></i>${esc(shortName(x.name_th))}</span><span class="hb-v">${(x.cases / sc.total24 * 100).toFixed(2)}%</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${disColor(x)};box-shadow:0 0 10px ${disColor(x)}" data-w="${(x.cases / maxC * 100).toFixed(0)}%"></em></span></button>`).join('')}</div>
    ${lqs.length ? `<div class="over"><span>เด่นเฉพาะพื้นที่ (เทียบสัดส่วนระดับประเทศ):</span>${lqs.filter(z => z.lq > 1.1).slice(0, 4).map(z => `<span class="chip" style="border-color:${disColor(z.x)}66">${esc(z.x.pdx)} ${z.lq.toFixed(2)}×</span>`).join('') || '<span style="color:var(--muted)">ใกล้เคียงค่าประเทศ</span>'}</div>` : ''}
  </article>`;

  // ---- radar ----
  const labels = d.national.domain_labels.map(l => ({ id: l.id, label: l.label, short: l.en }));
  const mix = domainMix(sc), natMix = sc.level === 'national' ? null : d.national.domain_scores;
  const topDom = labels.slice().sort((a, b) => (mix[b.id] || 0) - (mix[a.id] || 0))[0];
  const radar = `<article class="glass ins"><div class="ins-k">สัดส่วนกลุ่มโรค</div>${radarSVG(mix, natMix, labels)}
    <div class="legend-line"><span><i style="background:${HALLOWEEN.pumpkin}"></i>${esc(sc.label)}</span>${natMix ? `<span><i style="background:${HALLOWEEN.purple}"></i>ทั้งประเทศ</span>` : ''}</div>
    <div class="ins-note">กลุ่มสูงสุด: <b>${esc(topDom.label)}</b> ${(mix[topDom.id] || 0).toFixed(1)}%</div></article>`;

  // ---- gender ----
  const g = sc.gender;
  const gender = `<article class="glass ins"><div class="ins-k">สัดส่วนเพศผู้ป่วย</div>
    <div class="donut-row">${donutSVG([{ v: g.male, c: HALLOWEEN.purple, t: 'ชาย ' + fmt(g.male) }, { v: g.female, c: HALLOWEEN.pumpkin, t: 'หญิง ' + fmt(g.female) }], 140, 18, `<text x="70" y="68" text-anchor="middle" fill="${HALLOWEEN.text}" font-family="Chakra Petch" font-size="20" font-weight="600">${g.female_pct}%</text><text x="70" y="84" text-anchor="middle" fill="${HALLOWEEN.muted}" font-size="10">หญิง</text>`)}
    <div class="dl"><div><i style="background:${HALLOWEEN.purple}"></i>ชาย<b>${g.male_pct}%</b><small>${fmt(g.male)}</small></div><div><i style="background:${HALLOWEEN.pumpkin}"></i>หญิง<b>${g.female_pct}%</b><small>${fmt(g.female)}</small></div></div></div>
    <div class="ins-note">ผู้ป่วยรายบุคคล ${fmt(sc.ref.total_patients)} คน · เฉลี่ย ${(sc.total24 / sc.ref.total_patients).toFixed(2)} ครั้ง/คน</div></article>`;

  // ---- hospitals ----
  const allHospitals = hospInScope(), capacity = bedCapacity(allHospitals);
  const zeroBeds = allHospitals.filter(h => Number.isFinite(h.beds) && h.beds <= 0).length;
  const largestHospitals = allHospitals.filter(h => Number.isFinite(h.beds) && h.beds > 0).sort((a, b) => b.beds - a.beds);
  const hosp = `<article class="glass ins"><div class="ins-k">เตียงเปิดจริงในโรงพยาบาล</div>
    <div class="hp-sum"><span><b style="color:${HALLOWEEN.slime}">${capacity.withData}</b> จาก ${allHospitals.length} แห่งมีข้อมูลจำนวนเตียง</span><span><b style="color:#fdba74">${capacity.withOpenBeds}</b> แห่งมีเตียงเปิดจริงมากกว่า 0 · ${zeroBeds} แห่งระบุ 0</span></div>
    ${largestHospitals.slice(0, 6).map(h => { const st = hospStatus(h); return `<div class="hp"><span title="${esc(h.hname)}">${esc(h.hname)}</span><b style="color:${st.color}">${fmt(h.beds)} เตียง</b><span class="hb-bar"><em class="anim-w" style="width:0;background:${st.color}" data-w="${Math.min(h.beds, 1500) / 1500 * 100}%"></em></span></div>`; }).join('') || '<div class="ins-note">ไม่มีข้อมูลจำนวนเตียงเปิดจริงในพื้นที่นี้</div>'}
    <p class="ins-note">ยอดบริการรายเดือนเป็นยอดรวมพื้นที่ ไม่ได้แยกรายโรงพยาบาล · ${allHospitals.length - capacity.withData} แห่งไม่มีข้อมูลเตียง และ ${zeroBeds} แห่งระบุ 0 เตียง (ไม่นำมารวมเป็นเตียงเปิดจริง)</p>
    <button class="pp-btn" id="ins-go-ref" style="margin-top:10px">เปิดแผนที่ส่งต่อผู้ป่วย</button></article>`;

  // ---- auto summary ----
  const provs = Object.entries(d.provinces).map(([k, p]) => ({ k, v: sumIdx(p.monthly_series, periodIdx(S.fy, S.q)) })).sort((a, b) => b.v - a.v);
  const fcSum = sc.forecast.reduce((a, f) => a + f.forecast, 0), fcPrev = sumIdx(sc.series, range(12, 18)), fcY = pctChange(fcSum, fcPrev);
  const scopedHospitals = hospInScope(), scopedCapacity = bedCapacity(scopedHospitals);
  const scopedServicesPerBed = scopedCapacity.beds > 0 ? c.cur / periodIdx(S.fy, S.q).length / scopedCapacity.beds : null;
  const lines = [];
  lines.push(`${sc.label} มีบริการ IPD <b>${fmt(c.cur)}</b> ครั้ง (${periodLabel()})${c.yoy != null ? ` ${c.yoy >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} <b style="color:${c.yoy >= 0 ? 'var(--up)' : 'var(--down)'}">${Math.abs(c.yoy).toFixed(1)}%</b> จากปีก่อน` : ''}`);
  if (sc.level === 'province') lines.push(`อยู่อันดับ <b>${provs.findIndex(x => x.k === S.province) + 1}</b> จาก 77 จังหวัด คิดเป็น ${(c.cur / provs.reduce((a, b) => a + b.v, 0) * 100).toFixed(2)}% ของบริการทั้งประเทศ`);
  else if (sc.level === 'region') lines.push(`คิดเป็น ${(c.cur / sumIdx(nat.monthly_series, periodIdx(S.fy, S.q)) * 100).toFixed(1)}% ของบริการทั้งประเทศ`);
  else lines.push(`จังหวัดที่มีบริการ IPD สูงสุดคือ <b>${esc(d.provinces[provs[0].k].name_th)}</b> (${fmtC(provs[0].v)} ครั้ง) ตามด้วย ${esc(d.provinces[provs[1].k].name_th)} และ ${esc(d.provinces[provs[2].k].name_th)}`);
  lines.push(`โรคที่พบมากสุดคือ <b>${esc(shortName(top.name_th))}</b> (${share.toFixed(1)}%)${lqs[0] && lqs[0].lq > 1.1 ? ` และ ${esc(lqs[0].x.pdx)} พบสูงกว่าค่าประเทศ ${lqs[0].lq.toFixed(1)} เท่า` : ''}`);
  lines.push(`เฉลี่ย ${scopedServicesPerBed == null ? 'คำนวณไม่ได้' : scopedServicesPerBed.toFixed(2) + ' บริการ/เตียง/เดือน'} ในช่วงที่เลือก · ${fmt(c.cur)} บริการ ÷ ${periodIdx(S.fy, S.q).length} เดือน ÷ ${fmt(scopedCapacity.beds)} เตียงเปิดจริง (${scopedCapacity.withOpenBeds} รพ.) · มีข้อมูลจำนวนเตียง ${scopedCapacity.withData}/${scopedCapacity.totalHospitals} รพ. · ยอดบริการไม่แยกราย รพ. และไม่ใช่อัตราครองเตียง/หลักฐานว่าเตียงพอ · คาดการณ์หลังข้อมูลล่าสุด (${forecastRangeLabel()}) ${fmtC(fcSum)} ครั้ง${fcY != null ? ` (${fcY >= 0 ? '+' : ''}${fcY.toFixed(1)}% เทียบช่วงเดียวกันปีก่อน)` : ''}`);
  const sum = `<article class="glass ins"><div class="ins-k">สรุปสถานการณ์อัตโนมัติ</div><ul class="sum-list">${lines.map(l => `<li>${l}</li>`).join('')}</ul></article>`;

  host.innerHTML = hero + radar + gender + hosp + sum;
  popIn(host);
  $$('.hb[data-pdx]', host).forEach(b => b.addEventListener('click', () => { S.disease = b.dataset.pdx; renderScopeChips(); setTab('trend'); }));
  const go = $('#ins-go-ref', host); if (go) go.onclick = () => { if (S.province) { S.ref.prov = S.province; } setTab('referral'); };
}

// -----------------------------------------------------------------------------
// 11. DISTRIBUTION (แท็บแนวโน้ม) – กระจายตามพื้นที่ · Pareto · ฤดูกาล · เพศ
// -----------------------------------------------------------------------------
function distAreas() {
  const d = S.data;
  if (S.province) {
    const p = d.provinces[S.province];
    return { title: `จังหวัดในเขตเดียวกัน · ${p.zone_name}`, items: Object.entries(d.provinces).filter(([, x]) => x.zone === p.zone).map(([k, x]) => ({ key: k, name: x.name_th, o: x, color: d.regions[x.region].color, self: k === S.province })) };
  }
  if (S.region !== 'all') return { title: `เขตสุขภาพใน${d.regions[S.region].name_th}`, items: Object.values(d.zones).filter(z => z.region === S.region).map(z => ({ key: z.id, name: z.name, o: z, color: d.regions[z.region].color })) };
  return { title: 'ภูมิภาค', items: Object.values(d.regions).map(r => ({ key: r.id, name: r.name_th, o: r, color: r.color })) };
}
function areaValue(it) {
  const c = cmp(it.o.monthly_series);
  if (!S.disease) return { cur: c.cur, prev: c.prev, yoy: c.yoy, est: false };
  const dd = it.o.top_diseases.find(x => x.pdx === S.disease), f = dd ? dd.cases / it.o.total_cases : 0;
  return { cur: c.cur * f, prev: c.prev != null ? c.prev * f : null, yoy: c.yoy, est: true, none: !dd };
}
function renderDist() {
  const host = $('#dist-grid'); if (!host || !S.data) return;
  const d = S.data, A = distAreas(), dname = S.disease ? shortName((getScope().diseases.find(x => x.pdx === S.disease) || {}).name_th || S.disease) : null;
  const rows = A.items.map(it => ({ it, v: areaValue(it) })).sort((a, b) => b.v.cur - a.v.cur);
  const tot = rows.reduce((a, r) => a + r.v.cur, 0) || 1, mx = rows[0] ? rows[0].v.cur : 1;
  const barsHTML = rows.map(r => `<div class="dbar ${r.it.self ? 'self' : ''}"><span class="dn" title="${esc(r.it.name)}">${esc(r.it.name)}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${r.it.color};box-shadow:0 0 10px ${r.it.color}88" data-w="${(r.v.cur / mx * 100).toFixed(0)}%"></em></span><b>${(r.v.cur / tot * 100).toFixed(1)}%</b><small>${fmtC(r.v.cur)}</small>${r.v.none ? '<span class="yoy na">ไม่อยู่ใน 12 อันดับแรก</span>' : yoyBadge(r.v.yoy, 'YoY')}</div>`).join('');

  // Pareto – จังหวัด (ตามตัวกรองภูมิภาค)
  const pv = Object.entries(d.provinces).filter(([, p]) => S.region === 'all' || p.region === S.region).map(([k, p]) => ({ k, name: p.name_th, v: sumIdx(p.monthly_series, periodIdx(S.fy, S.q)) })).sort((a, b) => b.v - a.v);
  const ptot = pv.reduce((a, b) => a + b.v, 0) || 1, top = pv.slice(0, 10);
  let cum = 0; const cumArr = top.map(p => (cum += p.v) / ptot * 100);
  const W = 560, H = 250, ml = 38, mr = 40, mt = 14, mb = 56, bw = (W - ml - mr) / top.length;
  const ymax = top[0].v * 1.15;
  const pareto = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pareto จังหวัด">
    ${[0, 25, 50, 75, 100].map(t => `<line x1="${ml}" x2="${W - mr}" y1="${(mt + (1 - t / 100) * (H - mt - mb)).toFixed(1)}" y2="${(mt + (1 - t / 100) * (H - mt - mb)).toFixed(1)}" stroke="rgba(196,181,213,0.16)" stroke-dasharray="3 5"/><text x="${W - mr + 6}" y="${(mt + (1 - t / 100) * (H - mt - mb) + 4).toFixed(1)}" fill="${HALLOWEEN.muted}" font-size="10">${t}%</text>`).join('')}
    ${top.map((p, i) => { const h = p.v / ymax * (H - mt - mb), x = ml + i * bw + bw * 0.14; return `<rect x="${x.toFixed(1)}" y="${(H - mb - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${p.k === S.province ? HALLOWEEN.text : HALLOWEEN.pumpkin}" opacity="${p.k === S.province ? 1 : 0.75}" style="filter:drop-shadow(0 0 5px rgba(255,117,24,.5))"><title>${esc(p.name)} ${fmt(p.v)} ราย</title></rect><text transform="translate(${(x + bw * 0.36).toFixed(1)},${H - mb + 12}) rotate(40)" fill="${HALLOWEEN.muted}" font-size="10.5">${esc(p.name)}</text>`; }).join('')}
    <path d="${cumArr.map((v, i) => `${i ? 'L' : 'M'}${(ml + i * bw + bw / 2).toFixed(1)},${(mt + (1 - v / 100) * (H - mt - mb)).toFixed(1)}`).join(' ')}" fill="none" stroke="${HALLOWEEN.purple}" stroke-width="2.4" style="filter:drop-shadow(0 0 5px ${HALLOWEEN.purple})"/>
    ${cumArr.map((v, i) => `<circle cx="${(ml + i * bw + bw / 2).toFixed(1)}" cy="${(mt + (1 - v / 100) * (H - mt - mb)).toFixed(1)}" r="3.5" fill="${HALLOWEEN.purpleDark}" stroke="${HALLOWEEN.purple}" stroke-width="2"><title>สะสม ${v.toFixed(1)}%</title></circle>`).join('')}
  </svg>`;

  // Seasonality heatmap
  const sc = getScope(), dis = S.disease ? sc.diseases.find(x => x.pdx === S.disease) : null, f = dis ? dis.cases / sc.total24 : 1;
  const ser = sc.series.map(v => v * f), mn = Math.min(...ser), mxs = Math.max(...ser);
  const mlab = i => TH_MONTHS[(9 + i) % 12];
  const cell = (i) => { const v = ser[i], t = (v - mn) / ((mxs - mn) || 1), q = Math.floor((i % 12) / 3) + 1; return `<div class="hm ${S.q === q ? 'selq' : ''}" style="background:rgba(139,92,246,${(0.08 + t * 0.82).toFixed(2)});color:${HALLOWEEN.text}" title="${monthLabel(S.data.metadata.months[i])}: ${fmt(v)} ราย">${fmtC(v)}</div>`; };
  const yoyCell = i => { const y = pctChange(ser[12 + i], ser[i]); const a = Math.min(Math.abs(y) / 15, 1); return `<div class="hm yy" style="background:${y >= 0 ? `rgba(251,113,133,${(0.12 + a * 0.6).toFixed(2)})` : `rgba(52,211,153,${(0.12 + a * 0.6).toFixed(2)})`}" title="YoY ${y.toFixed(1)}%">${y > 0 ? '+' : ''}${y.toFixed(0)}%</div>`; };
  const heat = `<div class="heat"><span></span>${range(0, 12).map(i => `<div class="hmh ${S.q === Math.floor(i / 3) + 1 ? 'selq' : ''}">${mlab(i)}</div>`).join('')}
    <span class="hl">ปีข้อมูล 66</span>${range(0, 12).map(cell).join('')}
    <span class="hl">ปีข้อมูล 67</span>${range(12, 24).map(cell).join('')}
    <span class="hl">YoY</span>${range(0, 12).map(yoyCell).join('')}</div>`;
  const peakI = ser.indexOf(mxs), lowI = ser.indexOf(mn);

  // Gender stacked
  const gHTML = A.items.slice().sort((a, b) => b.o.gender.female_pct - a.o.gender.female_pct).map(it => `<div class="gb"><span class="dn" title="${esc(it.name)}">${esc(it.name)}</span><div class="gbar"><i class="anim-w" style="width:0" data-w="${it.o.gender.male_pct}%"></i><i class="anim-w" style="width:0" data-w="${it.o.gender.female_pct}%"></i></div><small>ช ${it.o.gender.male_pct}% · ญ ${it.o.gender.female_pct}%</small></div>`).join('');

  host.innerHTML = `
    <article class="glass card"><div class="card-head"><div><h2>การกระจายผู้ป่วยตามพื้นที่</h2><p>${esc(A.title)} · ${periodLabel()}${dname ? ` · เฉพาะโรค ${esc(dname)} (ประมาณ)` : ''}</p></div></div><div class="dbars">${barsHTML}</div></article>
    <article class="glass card"><div class="card-head"><div><h2>ความกระจุกตัวรายจังหวัด (Pareto)</h2><p>10 จังหวัดแรกรวมกัน <b style="color:${HALLOWEEN.purple}">${cumArr[9].toFixed(1)}%</b> ของผู้ป่วย${S.region !== 'all' ? 'ในภูมิภาค' : 'ทั้งประเทศ'} · แท่ง = จำนวนเคส เส้น = สัดส่วนสะสม</p></div></div>${pareto}</article>
    <article class="glass card wide"><div class="card-head"><div><h2>ฤดูกาลของผู้ป่วย (เดือน × ปีข้อมูล)</h2><p>${esc(sc.label)}${dname ? ' · ' + esc(dname) + ' (ประมาณ)' : ''} · สูงสุด <b style="color:${HALLOWEEN.pumpkin}">${monthLabel(S.data.metadata.months[peakI])}</b> · ต่ำสุด ${monthLabel(S.data.metadata.months[lowI])}</p></div></div><div class="heat-wrap">${heat}</div></article>
    <article class="glass card wide"><div class="card-head"><div><h2>สัดส่วนเพศแยกตามพื้นที่</h2><p><span style="color:${HALLOWEEN.purple}">■</span> ชาย <span style="color:${HALLOWEEN.pumpkin}">■</span> หญิง · ${esc(A.title)}</p></div></div><div class="gbs">${gHTML}</div></article>`;
  popIn(host);
}

// -----------------------------------------------------------------------------
// 12. ZONES (เขตสุขภาพ) – small multiples
// -----------------------------------------------------------------------------
function renderZones() {
  const host = $('#zone-grid'); if (!host || !S.data) return;
  const d = S.data, idx = periodIdx(S.fy, S.q);
  let zs = Object.values(d.zones).filter(z => S.region === 'all' || z.region === S.region).map(z => {
    const c = cmp(z.monthly_series), capacity = bedCapacity(S.hospitals.filter(h => h.zone === z.id));
    const servicesPerBed = capacity.beds > 0 ? c.cur / idx.length / capacity.beds : null;
    return { z, c, ...capacity, servicesPerBed };
  });
  const key = { cases: r => r.c.cur, yoy: r => r.c.yoy ?? -999, perbed: r => r.servicesPerBed ?? -1 }[S.zoneSort];
  zs.sort((a, b) => key(b) - key(a));
  const mxC = Math.max(...zs.map(r => r.c.cur), 1);
  const mxRate = Math.max(...zs.map(r => r.servicesPerBed || 0), 1);
  host.innerHTML = zs.map((r, i) => {
    const z = r.z, hs = S.hospitals.filter(h => h.zone === z.id);
    const t = z.top_diseases[0], col = d.regions[z.region].color;
    return `<article class="glass zone" style="--zc:${col}" data-region="${z.region}">
      <div class="z-head"><div><h3>${esc(z.name)}</h3><small>${esc(d.regions[z.region].name_th)} · ${z.provinces.length} จังหวัด</small></div><span class="z-rank">#${i + 1}</span></div>
      <div class="z-val roll" data-zroll="${fmt(r.c.cur)}"></div>
      <div class="z-sub">${yoyBadge(r.c.yoy, 'YoY')} <span style="color:var(--muted);font-size:12px">${r.c.prev != null ? 'ปีก่อน ' + fmtC(r.c.prev) : ''}</span></div>
      ${sparkSVG(z.monthly_series, forecastMonthly(z.monthly_series), idx, col)}
      <div class="z-bar"><span>บริการ/เตียง</span><div class="hb-bar"><em class="anim-w" style="width:0;background:${HALLOWEEN.pumpkin}" data-w="${r.servicesPerBed == null ? 0 : Math.min(r.servicesPerBed / mxRate * 100, 100)}%"></em></div><b style="color:${HALLOWEEN.pumpkin}">${r.servicesPerBed == null ? '—' : r.servicesPerBed.toFixed(2)}</b></div>
      <div class="z-bar"><span>สัดส่วน</span><div class="hb-bar"><em class="anim-w" style="width:0;background:${col}" data-w="${(r.c.cur / mxC * 100).toFixed(0)}%"></em></div><b>${(r.c.cur / mxC * 100).toFixed(0)}%</b></div>
      <div class="z-foot"><span class="chip" style="border-color:${disColor(t)}77;background:${disColor(t)}18;color:#fff">${esc(t.pdx)} ${esc(shortName(t.name_th).slice(0, 18))}</span><span>เฉลี่ย ${r.servicesPerBed == null ? '—' : r.servicesPerBed.toFixed(2) + ' บริการ/เตียง/เดือน'} · เตียงเปิดจริง ${fmt(r.beds)} จาก ${r.withOpenBeds} รพ. · มีข้อมูลจำนวนเตียง ${r.withData}/${r.totalHospitals} รพ. · ${idx.length} เดือนที่เลือก (ยอดบริการไม่แยกราย รพ.)</span></div>
      <button class="pp-btn z-go" data-region="${z.region}">ดูจังหวัดในภูมิภาคนี้</button></article>`;
  }).join('');
  $$('[data-zroll]', host).forEach(e => rollTo(e, e.dataset.zroll, 900, true));
  $$('.z-go', host).forEach(b => b.addEventListener('click', () => { S.region = b.dataset.region; $('#f-region').value = S.region; if (S.province) clearProvince(true); renderAll(); setTab('overview'); }));
  popIn(host);
}

// -----------------------------------------------------------------------------
// 13. AUDIT VISUALS – Quality ring · Rule bars · Scatter · Region error rate
// -----------------------------------------------------------------------------
function renderAuditViz() {
  const host = $('#aud-viz'); if (!host) return;
  const hs = S.hospitals, n = hs.length;
  const sig = [...S.issues.values()].map(l => l.map(i => i.code).join()).join(';') + '|' + S.audit.rule + '|' + hs.reduce((a, h) => a + (h.beds || 0), 0) + '|' + hs.reduce((a, h) => a + (h.occupied_beds || 0), 0);
  if (host.dataset.sig === sig) return; host.dataset.sig = sig;
  let e = 0, w = 0, ok = 0; const rc = {};
  hs.forEach(h => { const l = S.issues.get(h.hcode), s = rowSev(l); if (s === 'err') e++; else if (s === 'warn') w++; else ok++; new Set(l.map(i => i.code)).forEach(c => { rc[c] = (rc[c] || 0) + 1; }); });
  const knownBeds = hs.filter(h => Number.isFinite(h.beds) && h.beds >= 0).length;
  const missingBeds = n - knownBeds;
  const bedCoverage = n ? knownBeds / n * 100 : 0;
  const bedValueRecords = hs.filter(h => Number.isFinite(h.beds));
  const validBedValues = bedValueRecords.filter(h => h.beds >= 0 && Number.isInteger(h.beds)).length;
  const openBedHospitals = hs.filter(h => Number.isFinite(h.beds) && h.beds > 0).length;
  const occupiedRecords = hs.filter(h => Number.isFinite(h.occupied_beds) && h.occupied_beds >= 0);
  const occupancyWithBeds = occupiedRecords.filter(h => Number.isFinite(h.beds) && h.beds > 0).length;
  const occupancyCoverage = openBedHospitals ? occupancyWithBeds / openBedHospitals * 100 : 0;
  const deltaChecks = occupiedRecords.filter(h => Number.isFinite(h.beds) && Number.isFinite(h.bed_delta));
  const deltaMatches = deltaChecks.filter(h => h.bed_delta === h.beds - h.occupied_beds).length;
  const borChecks = occupiedRecords.filter(h => Number.isFinite(h.beds) && h.beds > 0 && Number.isFinite(h.bor));
  const borMatches = borChecks.filter(h => Math.abs(h.bor - h.occupied_beds / h.beds * 100) < 0.11).length;
  const sourceAudit = S.data.metadata.bed_quality_audit || {};
  const sourceRows = Number(sourceAudit.source_csv_rows) || 0;
  const sourceCodes = Number(sourceAudit.source_csv_unique_hcodes) || 0;
  const sourceComparedRows = Number(sourceAudit.dashboard_matched_source_rows) || 0;
  const manualBedEdits = hs.filter(h => h.bed_source === 'manual').length;
  const sourceAgreedRows = Math.max(0, (Number(sourceAudit.dashboard_matching_open_beds) || 0) - manualBedEdits);
  const sourceAgreement = sourceComparedRows > 0
    ? sourceAgreedRows / sourceComparedRows * 100
    : 0;
  const deltaScore = deltaChecks.length ? deltaMatches / deltaChecks.length * 100 : 0;
  const borScore = borChecks.length ? borMatches / borChecks.length * 100 : 0;
  const duplicateFreeScore = sourceRows ? sourceCodes / sourceRows * 100 : 0;
  const completenessScore = (bedCoverage + occupancyCoverage) / 2;
  const validityScore = bedValueRecords.length ? validBedValues / bedValueRecords.length * 100 : 0;
  const consistencyScore = (sourceAgreement + deltaScore + borScore + duplicateFreeScore) / 4;
  const hasReferenceDate = h => [h.occupied_beds_as_of, h.bed_reference_date, h.beds_as_of, h.occupied_updated_at, h.bed_updated_at]
    .some(value => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  const datedBedRecords = hs.filter(h => Number.isFinite(h.beds) && hasReferenceDate(h)).length;
  const datedOccupancy = occupiedRecords.filter(hasReferenceDate).length;
  const traceabilityScore = ((bedValueRecords.length ? datedBedRecords / bedValueRecords.length * 100 : 0)
    + (occupiedRecords.length ? datedOccupancy / occupiedRecords.length * 100 : 0)) / 2;
  const qualityScore = (completenessScore + validityScore + consistencyScore + traceabilityScore) / 4;
  const scoreColor = qualityScore >= 85 ? HALLOWEEN.slime : qualityScore >= 65 ? '#fdba74' : HALLOWEEN.pumpkin;
  const ring = donutSVG([{ v: qualityScore, c: scoreColor, t: `ดัชนีคุณภาพข้อมูลเตียง ${qualityScore.toFixed(1)}%` }, { v: 100 - qualityScore, c: HALLOWEEN.muted, t: 'ส่วนที่ยังขาด/ตรวจสอบไม่ได้' }], 150, 18,
    `<text x="75" y="76" text-anchor="middle" fill="${scoreColor}" font-family="Chakra Petch" font-size="27" font-weight="700">${qualityScore.toFixed(1)}%</text><text x="75" y="93" text-anchor="middle" fill="${HALLOWEEN.muted}" font-size="10">ดัชนีข้อมูลเตียง</text>`);
  const ruleMax = Math.max(...Object.values(rc), 1);
  const ruleBars = Object.keys(RULES).filter(c => rc[c]).sort((a, b) => rc[b] - rc[a]).map(c => `<button class="rb ${S.audit.rule === c ? 'on' : ''}" data-rule="${c}"><span>${RULES[c].sev === 'e' ? '●' : '○'} ${RULES[c].label}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${RULES[c].sev === 'e' ? HALLOWEEN.pumpkin : '#fdba74'}" data-w="${rc[c] / ruleMax * 100}%"></em></span><b>${rc[c]}</b></button>`).join('');

  const bedBins = [
    { label: '0', min: 0, max: 0 },
    { label: '1–30', min: 1, max: 30 },
    { label: '31–60', min: 31, max: 60 },
    { label: '61–100', min: 61, max: 100 },
    { label: '101–300', min: 101, max: 300 },
    { label: '301+', min: 301, max: Infinity }
  ];
  bedBins.forEach(bin => { bin.count = hs.filter(h => Number.isFinite(h.beds) && h.beds >= bin.min && h.beds <= bin.max).length; });
  const maxBin = Math.max(...bedBins.map(b => b.count), 1);
  const bedChart = `<div class="dbars">${bedBins.map((b, i) => `<div class="dbar"><span class="dn">${b.label} เตียง</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${i === 0 ? '#fdba74' : i > 3 ? HALLOWEEN.pumpkin : HALLOWEEN.purple}" data-w="${(b.count / maxBin * 100).toFixed(0)}%"></em></span><b>${b.count}</b><small>รพ.</small></div>`).join('')}</div>
    <p class="ins-note">มีข้อมูลจำนวนเตียงเปิดจริง ${hs.filter(h => Number.isFinite(h.beds) && h.beds >= 0).length}/${n} โรงพยาบาล</p>`;
  const qualityDimensions = [
    ['ความครบถ้วน', completenessScore, `เตียงเปิดมีตัวเลข ${knownBeds}/${n} (${bedCoverage.toFixed(1)}%) · ครองเตียง ${occupancyWithBeds}/${openBedHospitals} รพ.ที่มีเตียงเปิด (${occupancyCoverage.toFixed(1)}%)`],
    ['ความถูกต้องของรูปแบบตัวเลข', validityScore, `จำนวนเตียงเป็นจำนวนเต็มไม่ติดลบ ${validBedValues}/${bedValueRecords.length} ค่าตัวเลข`],
    ['ความสอดคล้องของข้อมูล', consistencyScore, `เทียบ CSV ${sourceAgreedRows}/${sourceComparedRows} ตรงกัน${manualBedEdits ? ` · แก้ไขในหน้าเว็บ ${manualBedEdits} แห่งจึงไม่นับว่ายืนยันกับ CSV` : ''} · สูตรส่วนต่างเตียง ${deltaMatches}/${deltaChecks.length} · สูตร BOR ${borMatches}/${borChecks.length} · รหัส CSV ไม่ซ้ำ ${sourceCodes}/${sourceRows}`],
    ['การระบุวันอ้างอิง', traceabilityScore, `วันอ้างอิงจำนวนเตียง ${datedBedRecords}/${bedValueRecords.length} · วันอ้างอิงครองเตียง ${datedOccupancy}/${occupiedRecords.length}`]
  ];
  const qualityHTML = `<div class="dbars quality-dimensions">${qualityDimensions.map(([label, value, detail]) => `<div class="dbar"><span class="dn">${label}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${value < 50 ? HALLOWEEN.pumpkin : value < 85 ? '#fdba74' : HALLOWEEN.slime}" data-w="${value.toFixed(1)}%"></em></span><b>${value.toFixed(1)}%</b><small>${detail}</small></div>`).join('')}</div>
    <p class="ins-note">ดัชนีรวม = ค่าเฉลี่ยน้ำหนักเท่ากันของ 4 ด้านข้างต้น ไม่ใช่มาตรฐานรับรองคุณภาพ และไม่ได้พิสูจน์ว่าค่าต้นทางตรงกับสถานการณ์จริง · ไฟล์ CSV มี ${fmt(sourceAudit.source_csv_rows || 0)} แถว / ${fmt(sourceAudit.source_csv_unique_hcodes || 0)} รหัสไม่ซ้ำ / รหัสซ้ำ ${fmt(sourceAudit.source_csv_duplicate_hcodes || 0)} รหัส / แถวจำนวนเตียงเปิดจริงอ่านไม่ได้ ${fmt(sourceAudit.source_csv_invalid_open_bed_rows || 0)} · พบข้อมูลครองเตียงมากกว่าจำนวนเตียงเปิด ${occupiedRecords.filter(h => Number.isFinite(h.beds) && h.beds > 0 && h.occupied_beds > h.beds).length}/${occupancyWithBeds} แห่ง ต้องตรวจวันอ้างอิงและยืนยันความหมายก่อนตีความว่าเป็นข้อมูลผิด</p>`;

  // region error rate
  const regs = Object.values(S.data.regions).map(r => { const rs = hs.filter(h => h.region === r.id), er = rs.filter(h => rowSev(S.issues.get(h.hcode)) === 'err').length; return { r, n: rs.length, er }; }).filter(x => x.n).sort((a, b) => b.er / b.n - a.er / a.n);
  const regHTML = regs.map(x => `<div class="dbar"><span class="dn">${esc(x.r.name_th)}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${HALLOWEEN.pumpkin};box-shadow:0 0 8px ${HALLOWEEN.pumpkin}88" data-w="${(x.er / x.n * 100).toFixed(0)}%"></em></span><b style="color:#ffedd5">${(x.er / x.n * 100).toFixed(0)}%</b><small>${x.er}/${x.n} แห่ง</small></div>`).join('');

  host.innerHTML = `
    <article class="glass card"><div class="card-head"><div><h2>ดัชนีคุณภาพข้อมูลเตียงทั้งหมด</h2><p>รวมความครบถ้วน ความถูกต้องของรูปแบบ ความสอดคล้อง และการมีวันอ้างอิง · น้ำหนักเท่ากันทุกด้าน</p></div></div>
      <div class="donut-row">${ring}<div class="dl"><div><i style="background:${HALLOWEEN.slime}"></i>เตียงเปิดมีตัวเลข<b>${knownBeds}/${n} (${bedCoverage.toFixed(1)}%)</b></div><div><i style="background:${HALLOWEEN.purple}"></i>มีครองเตียงเทียบ รพ. เตียงบวก<b>${occupancyWithBeds}/${openBedHospitals} (${occupancyCoverage.toFixed(1)}%)</b></div><div><i style="background:${HALLOWEEN.muted}"></i>ขาดตัวเลขเตียง<b>${missingBeds}</b></div></div></div>
      <div class="ins-note">ดัชนีนี้ได้ ${qualityScore.toFixed(1)}/100 จากข้อมูลที่ตรวจได้จริง · ความครบถ้วน ${completenessScore.toFixed(1)}% · รูปแบบตัวเลข ${validityScore.toFixed(1)}% · ความสอดคล้อง ${consistencyScore.toFixed(1)}% · มีวันอ้างอิง ${traceabilityScore.toFixed(1)}%</div></article>
    <article class="glass card"><div class="card-head"><div><h2>การกระจายจำนวนเตียงเปิดจริง</h2><p>จำนวนโรงพยาบาลแยกตามช่วงจำนวนเตียง</p></div></div>${bedChart}</article>
    <article class="glass card"><div class="card-head"><div><h2>ปัญหาแยกตามกฎ</h2><p>คลิกเพื่อกรองตารางด้านล่าง</p></div></div><div class="rbs">${ruleBars || '<div class="ins-note">ไม่พบปัญหา</div>'}</div></article>
    <article class="glass card"><div class="card-head"><div><h2>สัดส่วน รพ. ที่มี Error / ควรตรวจสอบ ต่อภูมิภาค</h2><p>กรณีจำนวนเตียงต่างจาก MOPH ถูกจัดเป็นรายการตรวจสอบ ไม่ได้ยืนยันว่าตัวเลขจากแหล่งใดผิด</p></div></div><div class="dbars">${regHTML}</div></article>
    <article class="glass card"><div class="card-head"><div><h2>รายละเอียดคุณภาพข้อมูลเตียง</h2><p>แสดงหลักฐานและจำนวนที่ใช้คำนวณดัชนี แยกตามด้าน</p></div></div>${qualityHTML}</article>`;
  popIn(host);
  $$('.rb', host).forEach(b => b.addEventListener('click', () => { S.audit.rule = S.audit.rule === b.dataset.rule ? null : b.dataset.rule; S.audit.page = 1; renderAudit(); }));
}

boot();
