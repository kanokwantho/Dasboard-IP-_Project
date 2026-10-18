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
  DISPATCH_PATIENTS: 3
};

const S = {
  data: null, moph: null,
  hospitals: [], hospOrig: [], issues: new Map(),
  fy: 2567, q: 0, region: 'all', metric: 'cases',
  province: null, disease: null, gran: 'quarter', tab: 'overview',
  audit: { filter: 'all', rule: null, q: '', page: 1, sortKey: 'sev', sortDir: 1 },
  ref: { hcode: null, status: 'all', q: '', prov: null },
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
const DIS_COL = { A09: '#22d3ee', H25: '#a78bfa', J18: '#3b82f6', J44: '#38bdf8', D56: '#f472b6', I25: '#fb7185', O80: '#e879f9', N18: '#f59e0b', E11: '#2dd4bf', I50: '#ef4444', I63: '#f43f5e', S06: '#fb923c', N39: '#60a5fa', J20: '#7dd3fc', R50: '#fde047', J12: '#818cf8', K35: '#34d399', I21: '#dc2626', J15: '#67e8f9', K29: '#fbbf24', L03: '#fdba74' };
const disColor = d => DIS_COL[d.pdx] || d.color || '#94a3b8';

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
  if (reduceMotion) { digits.forEach(({ strip, d }) => { strip.style.transform = `translateY(calc(var(--lh) * -${d}))`; }); return; }
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
async function loadJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

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
  $('#app-sub').textContent = `${d.metadata.sub_title} · ${d.metadata.data_source}`;
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
function cmp(series) {
  const cur = sumIdx(series, periodIdx(S.fy, S.q));
  const prev = S.fy === 2567 ? sumIdx(series, periodIdx(2566, S.q)) : null;
  return { cur, prev, yoy: prev ? (cur / prev - 1) * 100 : null };
}
const pctChange = (cur, prev) => (prev ? (cur / prev - 1) * 100 : null);
const periodLabel = () => `${S.q ? 'Q' + S.q + ' ' : 'ทั้งปี '}ปีงบ ${S.fy}`;
const qRangeTH = q => ['', 'ต.ค.–ธ.ค.', 'ม.ค.–มี.ค.', 'เม.ย.–มิ.ย.', 'ก.ค.–ก.ย.'][q];

function getScope() {
  const d = S.data;
  if (S.province) {
    const p = d.provinces[S.province];
    return { level: 'province', label: p.name_th, series: p.monthly_series, forecast: p.forecast, diseases: p.top_diseases, bor: p.bor, total24: p.total_cases, gender: p.gender, ref: p };
  }
  if (S.region !== 'all') {
    const r = d.regions[S.region];
    return { level: 'region', label: r.name_th, series: r.monthly_series, forecast: r.forecast, diseases: r.top_diseases, bor: r.bor, total24: r.total_cases, gender: r.gender, ref: r };
  }
  const n = d.national;
  return { level: 'national', label: 'ทั้งประเทศ', series: n.monthly_series, forecast: n.forecast, diseases: n.top_diseases, bor: n.overall_bor, total24: n.total_cases, gender: n.gender, ref: n };
}
function hospInScope() {
  if (S.province) { const code = S.data.provinces[S.province].code; return S.hospitals.filter(h => h.prov_id === code); }
  if (S.region !== 'all') return S.hospitals.filter(h => h.region === S.region);
  return S.hospitals;
}
function syncDisease() { if (S.disease && !getScope().diseases.some(x => x.pdx === S.disease)) S.disease = null; }

function yoyBadge(pct, label = 'YoY', title = '') {
  if (pct == null || !isFinite(pct)) return `<span class="yoy na" title="ไม่มีข้อมูลปีงบประมาณก่อนหน้าให้เปรียบเทียบ">— ไม่มีปีก่อนหน้า</span>`;
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
  const hs = hospInScope();
  const hCur = hs.reduce((a, h) => a + h.current_monthly, 0), hAvg = hs.reduce((a, h) => a + h.monthly_avg, 0);
  const borVs = hAvg ? pctChange(hCur, hAvg) : null;

  const items = [
    { id: 'cases', color: '#22d3ee', label: `ผู้ป่วยในทั้งหมด · ${periodLabel()}`, val: fmt(c.cur), badge: yoyBadge(c.yoy, 'YoY'), foot: c.prev != null ? 'ปีก่อน ' + fmt(c.prev) : '' },
    { id: 'day', color: '#3b82f6', label: 'เฉลี่ยต่อวัน (ราย/วัน)', val: fmt(perDay), badge: yoyBadge(perDayPrev ? pctChange(perDay, perDayPrev) : null, 'YoY'), foot: perDayPrev ? 'ปีก่อน ' + fmt(perDayPrev) : '' },
    { id: 'peak', color: '#8b5cf6', label: 'เดือนที่มีผู้ป่วยสูงสุดในช่วงนี้', val: fmt(sc.series[peakI]), badge: yoyBadge(peakPrev ? pctChange(sc.series[peakI], peakPrev) : null, 'YoY'), foot: monthLabel(months[peakI]) },
    { id: 'bor', color: '#34d399', label: 'อัตราครองเตียง (BOR)', val: sc.bor.toFixed(1) + '%', badge: yoyBadge(borVs, 'เทียบเฉลี่ย', 'ข้อมูล BOR ต้นทางไม่มีแยกรายปี จึงแสดงยอดบริการเดือนล่าสุดเทียบค่าเฉลี่ยรายเดือนของ รพ. ในพื้นที่นี้แทน'), foot: hs.length ? `${hs.length} รพ.` : '' },
    { id: 'fc', color: '#e879f9', label: 'พยากรณ์ 6 เดือนหน้า (ต.ค. 67 – มี.ค. 68)', val: fmt(fcSum), badge: yoyBadge(pctChange(fcSum, fcPrev), 'YoY', 'เทียบกับยอดจริงช่วง ต.ค. 66 – มี.ค. 67'), foot: 'ปีก่อน ' + fmt(fcPrev) }
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

function calcBor(h) { return h.beds > 0 ? roundFloat(h.occupied_beds / h.beds * 100, 1) : null; }
function hospStatus(h) {
  const b = calcBor(h);
  if (b == null) return { key: 'UNKNOWN', th: 'ข้อมูลเตียงไม่ถูกต้อง', color: '#94a3b8' };
  if (b >= 95) return { key: 'CRITICAL_OVERLOAD', th: 'เตียงวิกฤต/เกินพิกัด', color: '#ef4444' };
  if (b >= 85) return { key: 'NEAR_CAPACITY', th: 'เตียงใกล้เต็ม', color: '#f59e0b' };
  if (b >= 70) return { key: 'OPTIMAL_LOAD', th: 'รองรับได้ปกติ', color: '#10b981' };
  return { key: 'AVAILABLE_CAPACITY', th: 'มีเตียงว่างพร้อมรับ', color: '#06b6d4' };
}

let _hkPrev = {};
function renderHeaderKPIs() {
  const free = S.hospitals.reduce((a, h) => a + Math.max(h.beds - h.occupied_beds, 0), 0);
  const over = S.hospitals.filter(h => (calcBor(h) ?? 0) > 100).length;
  let err = 0; S.issues.forEach(list => { if (list.some(i => i.sev === 'e')) err++; });
  const set = (id, v) => {
    const el = $(id); rollTo(el, fmt(v), 800);
    if (_hkPrev[id] != null && _hkPrev[id] !== v) { el.classList.remove('slot-updating'); void el.offsetWidth; el.classList.add('slot-updating'); }
    _hkPrev[id] = v;
  };
  set('#hk-free', free); set('#hk-over', over); set('#hk-err', err);
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
          mouseover: () => { if (S.province !== key) layer.setStyle({ weight: 2, color: '#67e8f9' }); layer.bringToFront(); if (S.province && S.province !== key) (layerByKey[S.province] || []).forEach(l => l.bringToFront()); },
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
      const m = L.circleMarker([p.lat, p.lng], { radius: 7, weight: 1, color: '#67e8f9', fillOpacity: 0.8 }).addTo(markerLayer);
      (layerByKey[key] = [m]);
      m.on('click', e => { L.DomEvent.stopPropagation(e); selectProvince(key); });
      m.bindTooltip(() => tipHTML(key), { sticky: true, className: 'glass-tip' });
    });
  }
}

// ---- Metrics + color scales ----
function computeMetrics() {
  provMetrics = {};
  const vals = [];
  Object.entries(S.data.provinces).forEach(([k, p]) => {
    const c = cmp(p.monthly_series);
    provMetrics[k] = { cases: c.cur, prev: c.prev, yoy: c.yoy, bor: p.bor };
    vals.push(c.cur);
  });
  vals.sort((a, b) => a - b);
  cqBreaks = [1, 2, 3, 4, 5].map(i => vals[Math.floor(vals.length * i / 6)]);
}
const RAMP_CASES = ['#0b2a45', '#0d4a6b', '#0e7490', '#06b6d4', '#22d3ee', '#a5f3fc'];
function colorFor(key) {
  const m = provMetrics[key]; if (!m) return '#0f172a';
  if (S.metric === 'disease') return disColor(S.data.provinces[key].top_diseases[0]);
  if (S.metric === 'cases') { let i = 0; while (i < cqBreaks.length && m.cases >= cqBreaks[i]) i++; return RAMP_CASES[i]; }
  if (S.metric === 'bor') return m.bor > 100 ? '#ef4444' : m.bor >= 90 ? '#f97316' : m.bor >= 75 ? '#f59e0b' : m.bor >= 60 ? '#10b981' : '#0e7490';
  if (m.yoy == null) return '#334155';
  return m.yoy > 4 ? '#e11d48' : m.yoy > 1 ? '#fb7185' : m.yoy >= -1 ? '#475569' : m.yoy >= -4 ? '#34d399' : '#059669';
}
function legendRows() {
  if (S.metric === 'disease') {
    const cnt = {}, nm = {};
    Object.values(S.data.provinces).forEach(p => { const t = p.top_diseases[0]; cnt[t.pdx] = (cnt[t.pdx] || 0) + 1; nm[t.pdx] = t; });
    return { title: 'โรคที่พบมากสุดของแต่ละจังหวัด', rows: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(k => [disColor(nm[k]), `${k} ${shortName(nm[k].name_th).slice(0, 22)} · ${cnt[k]} จว.`]) };
  }
  if (S.metric === 'cases') return { title: `จำนวนเคส · ${periodLabel()}`, rows: RAMP_CASES.map((c, i) => [c, i === 0 ? `< ${fmtC(cqBreaks[0])}` : i === 5 ? `≥ ${fmtC(cqBreaks[4])}` : `${fmtC(cqBreaks[i - 1])} – ${fmtC(cqBreaks[i])}`]) };
  if (S.metric === 'bor') return { title: 'อัตราครองเตียง (BOR)', rows: [['#0e7490', '< 60%'], ['#10b981', '60 – 75%'], ['#f59e0b', '75 – 90%'], ['#f97316', '90 – 100%'], ['#ef4444', '> 100%']] };
  return { title: S.fy === 2567 ? `YoY · ${periodLabel()} เทียบปีก่อน` : 'YoY (ปี 2566 ไม่มีปีก่อนหน้า)', rows: [['#e11d48', '> +4%'], ['#fb7185', '+1 ถึง +4%'], ['#475569', '±1%'], ['#34d399', '−1 ถึง −4%'], ['#059669', '< −4%']] };
}
function styleForKey(key) {
  if (!key) return { weight: 0.5, color: 'rgba(100,116,139,0.35)', fillColor: '#0f172a', fillOpacity: 0.5, interactive: false, className: 'prov' };
  const p = S.data.provinces[key];
  const dim = S.region !== 'all' && p.region !== S.region;
  const sel = S.province === key;
  return {
    className: 'prov', weight: sel ? 2.6 : 0.9, color: sel ? '#e0faff' : 'rgba(148,163,184,0.5)',
    fillColor: colorFor(key), fillOpacity: dim ? 0.1 : (S.province && !sel ? 0.42 : 0.82)
  };
}
function tipHTML(key) {
  const p = S.data.provinces[key], m = provMetrics[key];
  const t = p.top_diseases[0];
  return `<b>${esc(p.name_th)}</b><br>โรคเด่น: <span style="color:${disColor(t)}">${esc(shortName(t.name_th).slice(0, 26))}</span><br>${fmt(m.cases)} ราย · ${m.yoy == null ? 'ไม่มี YoY' : (m.yoy > 0 ? '+' : '') + m.yoy.toFixed(1) + '% YoY'}<br>BOR ${p.bor.toFixed(1)}%`;
}
function refreshMap() {
  if (!map) return;
  computeMetrics();
  Object.entries(layerByKey).forEach(([key, layers]) => layers.forEach(l => {
    if (fallbackMode) {
      const m = provMetrics[key];
      l.setStyle({ fillColor: colorFor(key), color: S.province === key ? '#fff' : '#67e8f9', radius: 5 + Math.sqrt(m.cases) / 55, weight: S.province === key ? 3 : 1 });
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
  const band = hi.length ? `<rect x="${X(hi[0]) - 4}" y="0" width="${X(hi[hi.length - 1]) - X(hi[0]) + 8}" height="${H}" fill="rgba(34,211,238,0.13)" rx="4"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${band}
    <path d="${line(series, 0)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${X(series.length - 1).toFixed(1)},${Y(series[series.length - 1]).toFixed(1)} ${line(forecast.map(f => f.forecast), series.length).replace(/^M/, 'L')}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="4 4"/>
  </svg>`;
}
function renderPanel() {
  const key = S.province; if (!key) return;
  const p = S.data.provinces[key], c = cmp(p.monthly_series), hs = S.hospitals.filter(h => h.prov_id === p.code);
  const free = hs.reduce((a, h) => a + Math.max(h.beds - h.occupied_beds, 0), 0);
  const topH = hs.slice().sort((a, b) => (calcBor(b) ?? 0) - (calcBor(a) ?? 0)).slice(0, 3);
  const maxD = p.top_diseases[0].cases;
  const td = p.top_diseases[0], natT = S.data.national.top_diseases.find(x => x.pdx === td.pdx);
  const tShare = td.cases / p.total_cases * 100, lq = natT ? tShare / (natT.cases / S.data.national.total_cases * 100) : null;
  const borPct = Math.min(p.bor, 100), circ = 2 * Math.PI * 38;
  const borCol = p.bor > 100 ? '#ef4444' : p.bor >= 90 ? '#f97316' : p.bor >= 75 ? '#f59e0b' : '#34d399';
  $('#prov-panel').innerHTML = `
    <div class="pp-head">
      <div><h2>${esc(p.name_th)}</h2><small>${esc(p.name_en)}</small></div>
      <button class="pp-close" id="pp-close" aria-label="ปิดการ์ดข้อมูล">✕</button>
    </div>
    <div class="pp-tags"><span class="chip">${esc(p.region_th)}</span><span class="chip">${esc(p.zone_name)}</span></div>
    <div class="pp-hero" style="--hc:${disColor(td)}"><small>โรคเด่นของจังหวัด</small><b>${esc(shortName(td.name_th))}</b><span>${td.pdx} · ${tShare.toFixed(2)}% ของเคสทั้งหมด${lq ? ` · ${lq.toFixed(2)}× ของค่าประเทศ` : ''}</span></div>
    <div class="pp-main">
      <div>
        <div style="color:var(--muted);font-size:12px">ผู้ป่วยใน · ${periodLabel()}</div>
        <div class="big" id="pp-big"></div>
        <div style="margin-top:4px">${yoyBadge(c.yoy, 'YoY')} ${c.prev != null ? `<span style="color:var(--muted);font-size:12px">ปีก่อน ${fmt(c.prev)}</span>` : ''}</div>
      </div>
      <svg viewBox="0 0 96 96" width="96" height="96" aria-label="BOR ${p.bor}%">
        <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="8"/>
        <circle cx="48" cy="48" r="38" fill="none" stroke="${borCol}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(circ * borPct / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 48 48)" style="filter:drop-shadow(0 0 6px ${borCol})"/>
        <text x="48" y="52" text-anchor="middle" fill="#fff" font-family="Chakra Petch" font-size="17" font-weight="600">${p.bor.toFixed(1)}%</text>
        <text x="48" y="66" text-anchor="middle" fill="#8a9bb4" font-size="9">BOR</text>
      </svg>
    </div>
    <div class="pp-sec"><h4>แนวโน้ม 24 เดือน + พยากรณ์ 6 เดือน (ไฮไลต์ = ช่วงที่เลือก)</h4>${sparkSVG(p.monthly_series, p.forecast, periodIdx(S.fy, S.q), '#22d3ee')}</div>
    <div class="pp-sec"><h4>เพศ</h4>
      <div class="gbar"><i style="width:${p.gender.male_pct}%"></i><i style="width:${p.gender.female_pct}%"></i></div>
      <div class="glab"><span>ชาย ${p.gender.male_pct}%</span><span>หญิง ${p.gender.female_pct}%</span></div></div>
    <div class="pp-sec"><h4>โรคที่พบมากสุด 5 อันดับ (24 เดือน)</h4><ul class="dz">
      ${p.top_diseases.slice(0, 5).map(d => `<li><span>${esc(d.name_th.length > 34 ? d.name_th.slice(0, 34) + '…' : d.name_th)}</span><span>${fmt(d.cases)}</span><div class="b"><i style="width:${(d.cases / maxD * 100).toFixed(0)}%;background:${d.color}"></i></div></li>`).join('')}
    </ul></div>
    <div class="pp-sec"><h4>โรงพยาบาลในจังหวัด · ${hs.length} แห่ง · เตียงว่างรวม ${fmt(free)}</h4>
      <div class="hosp-mini">${topH.length ? topH.map(h => `<div><span>${esc(h.hname)}</span><span style="color:${hospStatus(h).color}">${calcBor(h)}%</span></div>`).join('') : '<div style="color:var(--muted)">ไม่มีข้อมูล รพ. ในชุดข้อมูลนี้</div>'}</div></div>
    <button class="pp-btn" id="pp-trend">ดูแนวโน้ม &amp; พยากรณ์ของจังหวัดนี้</button>`;
  rollTo($('#pp-big'), fmt(c.cur), 1000);
  $('#pp-close').onclick = () => clearProvince();
  $('#pp-trend').onclick = () => setTab('trend');
}

function renderRank() {
  const metric = S.metric;
  let rows = Object.entries(S.data.provinces).filter(([, p]) => S.region === 'all' || p.region === S.region)
    .map(([k, p]) => ({ k, p, m: provMetrics[k] }));
  const val = r => metric === 'bor' ? r.m.bor : metric === 'yoy' ? (r.m.yoy ?? -999) : r.m.cases;
  rows.sort((a, b) => val(b) - val(a));
  const max = Math.max(...rows.map(r => Math.abs(metric === 'yoy' ? (r.m.yoy ?? 0) : val(r))), 1);
  $('#rank-title').textContent = { cases: 'จังหวัดเรียงตามจำนวนเคส', bor: 'จังหวัดเรียงตาม BOR', yoy: 'จังหวัดเรียงตาม YoY', disease: 'จังหวัด · แยกตามโรคเด่น' }[metric];
  $('#rank-sub').textContent = `5 อันดับแรก · ${periodLabel()}`;
  rows = rows.slice(0, 5);
  $('#rank-list').innerHTML = rows.map((r, i) => {
    const v = val(r), t = r.p.top_diseases[0];
    const txt = metric === 'cases' ? fmtC(v) : metric === 'disease' ? `<span style="color:${disColor(t)}">${t.pdx}</span>` : metric === 'bor' ? v.toFixed(1) + '%' : (r.m.yoy == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
    const col = metric === 'disease' ? disColor(t) : metric === 'yoy' ? (v > 0 ? 'var(--up)' : 'var(--down)') : metric === 'bor' ? (v > 100 ? '#ef4444' : v >= 85 ? '#f59e0b' : 'var(--cyan)') : 'var(--cyan)';
    const w = metric === 'yoy' ? Math.abs(r.m.yoy ?? 0) / max * 100 : v / max * 100;
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
    act.forEach((v, i) => pts.push({ type: 'act', label: monthLabel(M.months[i]), v, prev: i >= 12 ? act[i - 12] : null, qn: Math.floor((i % 12) / 3) + 1 }));
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
  const col = dis ? '#e879f9' : '#22d3ee';
  $('#trend-title').textContent = `แนวโน้ม${dis ? ' · ' + dis.name_th : 'ผู้ป่วยใน'} — ${sc.label}`;
  $('#trend-sub').innerHTML = dis
    ? `<b style="color:#fde68a;font-weight:500">ค่าประมาณ</b> จากสัดส่วนโรค ${dis.pdx} (${(dis.cases / sc.total24 * 100).toFixed(2)}% ของเคสทั้งหมด) × ยอดรวมรายเดือน/ไตรมาส · พยากรณ์ล่วงหน้า 6 เดือน (ต.ค. 67 – มี.ค. 68)`
    : 'ข้อมูลจริงรายเดือนจาก สปสช. รวมเป็นรายไตรมาสปีงบประมาณ 2566–2567 + พยากรณ์ล่วงหน้า 6 เดือน (เส้นประม่วง พร้อมช่วงความเชื่อมั่น)';

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
  if (S.q) pts.forEach((p, i) => { if (p.qn === S.q && p.type === 'act') hl += `<rect x="${(X(i) - step * 0.42).toFixed(1)}" y="${mt}" width="${(step * 0.84).toFixed(1)}" height="${H - mt - mb}" rx="6" fill="rgba(34,211,238,0.08)"/>`; });
  const dx = (X(nA - 1) + X(nA)) / 2;
  const dots = pts.map((p, i) => {
    const cx = X(i).toFixed(1), cy = Y(p.v).toFixed(1), c = p.type === 'fc' ? '#a78bfa' : col;
    return `<circle class="dot-pop" cx="${cx}" cy="${cy}" r="4.5" fill="#050a14" stroke="${c}" stroke-width="2" style="animation-delay:${(0.5 + i * 0.04).toFixed(2)}s"/><circle class="dot" data-i="${i}" cx="${cx}" cy="${cy}" r="15" fill="transparent"/>`;
  }).join('');

  $('#trend-svg').innerHTML = `
    <defs>
      <linearGradient id="gA" x1="0" x2="1"><stop offset="0" stop-color="${dis ? '#a855f7' : '#3b82f6'}"/><stop offset="1" stop-color="${col}"/></linearGradient>
      <linearGradient id="gB" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a78bfa" stop-opacity=".38"/><stop offset="1" stop-color="#a78bfa" stop-opacity=".05"/></linearGradient>
      <filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${grid}${hl}
    <line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${mt}" y2="${H - mb}" stroke="rgba(167,139,250,0.5)" stroke-dasharray="4 5"/>
    <text x="${(dx + 8).toFixed(1)}" y="${mt + 10}" style="fill:#a78bfa">พยากรณ์ →</text>
    <path d="${band}" fill="url(#gB)"/>
    <path id="tr-act" d="${smooth(actP)}" fill="none" stroke="url(#gA)" stroke-width="3.2" stroke-linecap="round" filter="url(#glow)"/>
    <path id="tr-fc" d="${smooth(fcP)}" fill="none" stroke="#a78bfa" stroke-width="2.6" stroke-dasharray="7 6" stroke-linecap="round"/>
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
      tip.innerHTML = `<b>${p.label}</b>${p.type === 'fc' ? ' <span style="color:#a78bfa">พยากรณ์</span>' : ''}<br>${fmt(p.v)} ราย${p.type === 'fc' ? `<br><span style="color:var(--muted)">ช่วง ${fmtC(p.lo)} – ${fmtC(p.hi)}</span>` : ''}<br>${y == null ? '<span style="color:var(--muted)">ไม่มีข้อมูลปีก่อนหน้า</span>' : yoyBadge(y, 'YoY')}`;
      tip.style.left = (r.left + r.width / 2 - b.left) + 'px'; tip.style.top = (r.top + r.height / 2 - b.top) + 'px'; tip.classList.add('show');
    });
    c.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });

  // YoY chips (ปีงบ 67 vs 66 ต่อไตรมาส)
  const share = getTrendData().share, series = sc.series.map(v => v * share);
  $('#q-chips').innerHTML = [1, 2, 3, 4].map(q => {
    const cur = sumIdx(series, periodIdx(2567, q)), prev = sumIdx(series, periodIdx(2566, q));
    return `<div class="q-chip ${S.q === q ? 'on' : ''}">Q${q} · ${qRangeTH(q)}<b>${fmtC(cur)}</b>${yoyBadge(pctChange(cur, prev), 'YoY')} <span>จาก ${fmtC(prev)}</span></div>`;
  }).join('');
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
const RAMP_TM = ['#155e75', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#fb923c'];
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
    const st = refStats[k] = refStats[k] || { n: 0, sum: 0, crit: 0, free: 0 };
    const b = calcBor(h) ?? 0; st.n++; st.sum += Math.min(b, 140); st.free += Math.max(h.beds - h.occupied_beds, 0); if (b >= 95) st.crit++;
  });
}
function refPolyStyle(key) {
  if (!key) return { weight: 0.5, color: 'rgba(100,116,139,0.3)', fillColor: '#0b1426', fillOpacity: 0.4, interactive: false };
  const p = S.data.provinces[key], st = refStats[key];
  const avg = st ? st.sum / st.n : null, sel = S.ref.prov === key;
  const dim = (S.region !== 'all' && p.region !== S.region) || (S.ref.prov && !sel);
  const fill = avg == null ? '#0d1830' : avg > 100 ? '#ef4444' : avg >= 90 ? '#f97316' : avg >= 75 ? '#f59e0b' : avg >= 60 ? '#10b981' : '#0e7490';
  return { weight: sel ? 2.4 : 0.8, color: sel ? '#ffffff' : 'rgba(148,163,184,0.45)', fillColor: fill, fillOpacity: dim ? 0.14 : avg == null ? 0.35 : 0.5 };
}
function refTip(key) {
  const p = S.data.provinces[key], st = refStats[key];
  return `<b>${esc(p.name_th)}</b><br>${st ? `${st.n} รพ. · BOR เฉลี่ย ${(st.sum / st.n).toFixed(0)}%<br>วิกฤต ${st.crit} แห่ง · เตียงว่าง ${fmt(st.free)}` : 'ไม่มีข้อมูล รพ. ในชุดนี้'}`;
}
function toggleRefProv(key) {
  S.ref.prov = S.ref.prov === key ? null : key;
  if (S.ref.prov) { const ls = refLayerByKey[key] || []; let b = null; ls.forEach(l => { const lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); }); if (b) refMap.flyToBounds(b, { padding: [40, 40], maxZoom: 9, duration: 0.9 }); }
  else refMap.flyToBounds(CONFIG.NATIONAL_BOUNDS, { padding: [10, 10], duration: 0.9 });
  S.ref.hcode = null; renderReferral();
}
const STATUS_ORDER = ['CRITICAL_OVERLOAD', 'NEAR_CAPACITY', 'OPTIMAL_LOAD', 'AVAILABLE_CAPACITY', 'UNKNOWN'];

function bindReferralUI() {
  $('#ref-q').addEventListener('input', debounce(e => { S.ref.q = e.target.value.trim(); renderReferral(); }, 120));
  $('#ref-status').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ref.status = b.dataset.s; setSeg('#ref-status', 's', S.ref.status); renderReferral(); });
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
          mouseover: () => layer.setStyle({ weight: 2, color: '#67e8f9' }),
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
    if (S.ref.status !== 'all' && hospStatus(h).key !== S.ref.status) return false;
    return !q || h.hname.toLowerCase().includes(q) || h.prov_th.includes(q) || h.hcode.includes(q);
  }).sort((a, b) => (calcBor(b) ?? -1) - (calcBor(a) ?? -1));
}
function sortedRoutes(h) { return (S.data.referral_routes[h.hcode] || []).slice().sort((a, b) => b.match_score - a.match_score); }
function bestRoute(h) { const r = sortedRoutes(h); return r.find(x => x.readiness === 'READY') || r[0] || null; }

function renderReferral() {
  if (!refMap) initRefMap();
  computeRefStats();
  Object.entries(refLayerByKey).forEach(([k, ls]) => ls.forEach(l => l.setStyle(refPolyStyle(k))));
  $('#ref-prov-chip').innerHTML = S.ref.prov ? `<span class="chip">จ.${esc(S.data.provinces[S.ref.prov].name_th)} <button data-x aria-label="ล้างจังหวัด">×</button></span>` : '<span style="color:var(--muted);font-size:12px">คลิกจังหวัดบนแผนที่เพื่อกรองรายการ รพ.</span>';
  const chipBtn = $('#ref-prov-chip button'); if (chipBtn) chipBtn.onclick = () => toggleRefProv(S.ref.prov);
  const list = refList();
  if (!S.ref.hcode || !S.hospitals.some(h => h.hcode === S.ref.hcode)) S.ref.hcode = (list.find(h => (S.data.referral_routes[h.hcode] || []).length) || list[0] || {}).hcode || null;
  $('#ref-items').innerHTML = list.slice(0, 200).map(h => {
    const st = hospStatus(h);
    return `<li data-h="${h.hcode}" class="${h.hcode === S.ref.hcode ? 'on' : ''}"><div class="t"><span><i class="sdot" style="background:${st.color};box-shadow:0 0 8px ${st.color}"></i>${esc(h.hname)}</span><span style="color:${st.color}">${calcBor(h) ?? '—'}%</span></div><div class="s">${esc(h.prov_th)} · ${esc(h.tier.split(' ')[0])} · ${st.th}</div></li>`;
  }).join('') || '<li style="color:var(--muted);cursor:default">ไม่พบโรงพยาบาลตามเงื่อนไข</li>';
  $$('#ref-items li[data-h]').forEach(li => li.addEventListener('click', () => { S.ref.hcode = li.dataset.h; renderReferral(); focusRefSource(); }));

  refMarkers.clearLayers();
  list.forEach(h => {
    const st = hospStatus(h);
    L.circleMarker([h.lat, h.lng], { radius: h.hcode === S.ref.hcode ? 9 : 3 + Math.sqrt(h.beds) / 13, color: h.hcode === S.ref.hcode ? '#fff' : st.color, weight: h.hcode === S.ref.hcode ? 2.5 : 1, fillColor: st.color, fillOpacity: 0.75 })
      .bindTooltip(`<b>${esc(h.hname)}</b><br>BOR ${calcBor(h) ?? '—'}% · เตียง ${fmt(h.beds)}`, { className: 'glass-tip' })
      .on('click', () => { S.ref.hcode = h.hcode; renderReferral(); focusRefSource(); }).addTo(refMarkers);
  });
  renderReferralRouting();
}

function renderReferralRouting() {
  const h = S.hospitals.find(x => x.hcode === S.ref.hcode);
  const side = $('#ref-side');
  refRouteLayer && refRouteLayer.clearLayers();
  if (!h) { side.innerHTML = '<p style="color:var(--muted)">เลือกโรงพยาบาลต้นทางจากรายการด้านซ้าย</p>'; return; }
  const st = hospStatus(h), routes = sortedRoutes(h), best = bestRoute(h);
  routes.forEach(r => {
    const isBest = best && r.target_hcode === best.target_hcode;
    L.polyline([[h.lat, h.lng], [r.target_lat, r.target_lng]], { color: isBest ? '#34d399' : '#38bdf8', weight: isBest ? 3.5 : 2, opacity: isBest ? 0.95 : 0.55, dashArray: isBest ? null : '6 6' }).addTo(refRouteLayer);
    L.circleMarker([r.target_lat, r.target_lng], { radius: 7, color: isBest ? '#34d399' : '#38bdf8', fillColor: '#050a14', fillOpacity: 1, weight: 2 }).bindTooltip(esc(r.target_name), { className: 'glass-tip' }).addTo(refRouteLayer);
  });
  side.innerHTML = `
    <div class="ref-src">
      <h3>${esc(h.hname)}</h3>
      <div style="color:var(--muted);font-size:12.5px">${esc(h.prov_th)} · ${esc(h.zone_name)} · ${esc(h.tier)}</div>
      <div style="display:flex;align-items:flex-end;gap:12px;margin-top:8px">
        <div class="bor" id="ref-bor" style="color:${st.color}"></div>
        <div style="font-size:12.5px;color:var(--muted);padding-bottom:5px">${esc(st.th)}<br>เตียง ${fmt(h.beds)} · ใช้อยู่ ${fmt(h.occupied_beds)} · ว่าง ${fmt(Math.max(h.beds - h.occupied_beds, 0))}</div>
      </div>
    </div>
    <h4 style="margin-top:14px;font-size:14px">ปลายทางแนะนำ (${routes.length})</h4>
    ${routes.length ? routes.map(r => `
      <div class="route ${best && r.target_hcode === best.target_hcode ? 'best' : ''}">
        <div class="r1"><span>${esc(r.target_name)}</span><span class="badge ${r.readiness === 'READY' ? 'ok' : 'lim'}">${esc(r.readiness_th)}</span></div>
        <div class="r2"><span>${esc(r.target_prov)}</span><span>ห่าง <b>${r.distance_km}</b> กม.</span><span>ETA <b>${r.transit_mins}</b> นาที</span><span>เตียงว่าง <b>${r.target_available_beds}</b>/${r.target_beds}</span><span>BOR ${r.target_bor}%</span><span>คะแนน <b>${r.match_score}</b></span></div>
      </div>`).join('') : '<p style="color:var(--muted)">ไม่มีข้อมูลเส้นทางส่งต่อของโรงพยาบาลนี้ (ดูรายการใน Data Audit)</p>'}
    <button class="dispatch" id="btn-dispatch" ${best ? '' : 'disabled'}>🚑 สั่งส่งต่อฉุกเฉิน ${CONFIG.DISPATCH_PATIENTS} ราย${best ? ' → ' + esc(best.target_name) : ''}</button>`;
  rollTo($('#ref-bor'), (calcBor(h) ?? '—') + '%', 800);
  const btn = $('#btn-dispatch'); if (btn) btn.onclick = dispatchEmergency;
}
function focusRefSource() {
  const h = S.hospitals.find(x => x.hcode === S.ref.hcode); if (!h || !refMap) return;
  const pts = [[h.lat, h.lng], ...sortedRoutes(h).map(r => [r.target_lat, r.target_lng])];
  refMap.flyToBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 10, duration: 0.9 });
}
function recalcHosp(h) { const b = calcBor(h); if (b != null) h.bor = b; h.bed_delta = h.beds - h.occupied_beds; }

function dispatchEmergency() {
  const src = S.hospitals.find(x => x.hcode === S.ref.hcode); if (!src) return;
  const bestTarget = bestRoute(src), N = CONFIG.DISPATCH_PATIENTS;
  if (!bestTarget) return;
  if (bestTarget.target_available_beds < N) { showToast(`ปลายทาง "${bestTarget.target_name}" มีเตียงว่างไม่พอสำหรับ ${N} ราย`, 'warn'); return; }
  bestTarget.target_available_beds -= N;
  bestTarget.target_bor = roundFloat((bestTarget.target_beds - bestTarget.target_available_beds) / bestTarget.target_beds * 100, 1);
  src.occupied_beds = Math.max(0, src.occupied_beds - N); recalcHosp(src);
  const tgt = S.hospitals.find(x => x.hcode === bestTarget.target_hcode);
  if (tgt) { tgt.occupied_beds += N; recalcHosp(tgt); }
  runAudit();
  renderReferral();
  renderHeaderKPIs();
  showToast(`🚑 สั่งการส่งต่อฉุกเฉินสำเร็จ: ส่งผู้ป่วย ${N} รายไปยัง "${bestTarget.target_name}" (ระยะทาง ${bestTarget.distance_km} กม., ETA ${bestTarget.transit_mins} นาที)`, 'success');
}

// -----------------------------------------------------------------------------
// 8. DATA AUDIT – ตารางคัดกรองข้อมูลดิบ + ไฮไลต์แถว Error สีส้มสะท้อนแสง
// -----------------------------------------------------------------------------
const RULES = {
  OCC_GT_BEDS: { sev: 'e', label: 'ผู้ป่วยเกินจำนวนเตียง' },
  BED_INVALID: { sev: 'e', label: 'จำนวนเตียงไม่ถูกต้อง' },
  BOR_MISMATCH: { sev: 'e', label: 'BOR ไม่ตรงกับตัวเลขจริง' },
  COORD_OUT: { sev: 'e', label: 'พิกัดอยู่นอกประเทศไทย' },
  DELTA_MISMATCH: { sev: 'w', label: 'เตียงว่างไม่ตรงผลต่าง' },
  COORD_FAR: { sev: 'w', label: 'พิกัดห่างจากจังหวัดมาก' },
  SPIKE: { sev: 'w', label: 'ยอดเดือนล่าสุดผิดปกติ' },
  MOPH_BED: { sev: 'w', label: 'เตียงไม่ตรงข้อมูล MOPH' },
  NO_ROUTE: { sev: 'w', label: 'ไม่มีเส้นทางส่งต่อ' }
};
function hav(a, b, c, d) { const R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

function auditHospital(h) {
  const out = [], add = (code, text) => out.push({ code, sev: RULES[code].sev, text });
  const calc = calcBor(h);
  if (!(h.beds > 0)) add('BED_INVALID', `จำนวนเตียง = ${h.beds}`);
  if (h.beds > 0 && h.occupied_beds > h.beds) add('OCC_GT_BEDS', `ใช้อยู่ ${fmt(h.occupied_beds)} > เตียง ${fmt(h.beds)} (BOR จริง ${calc}%${calc > 150 ? ' — สูงผิดปกติ น่าจะตัวเลขเตียงผิด' : ''})`);
  if (calc != null && Math.abs(calc - h.bor) > 1) add('BOR_MISMATCH', `บันทึก ${h.bor}% แต่คำนวณได้ ${calc}%`);
  if (h.bed_delta !== h.beds - h.occupied_beds) add('DELTA_MISMATCH', `bed_delta ${h.bed_delta} ≠ ${h.beds - h.occupied_beds}`);
  if (!(h.lat >= 5.5 && h.lat <= 20.6 && h.lng >= 97.3 && h.lng <= 105.7)) add('COORD_OUT', `พิกัด ${h.lat}, ${h.lng}`);
  else { const p = Object.values(S.data.provinces).find(x => x.code === h.prov_id); if (p) { const dk = hav(h.lat, h.lng, p.lat, p.lng); if (dk > 120) add('COORD_FAR', `ห่างจุดกลางจังหวัด ${Math.round(dk)} กม.`); } }
  if (h.monthly_avg > 0) { const r = h.current_monthly / h.monthly_avg; if (r > 1.4 || r < 0.6) add('SPIKE', `เดือนล่าสุด ${fmt(h.current_monthly)} เทียบเฉลี่ย ${fmt(h.monthly_avg)} (${r > 1 ? '+' : ''}${((r - 1) * 100).toFixed(0)}%)`); }
  const mo = S.moph && S.moph[h.hcode]; if (mo && mo.bed !== h.beds) add('MOPH_BED', `IPD ${fmt(h.beds)} vs MOPH ${fmt(mo.bed)}`);
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
    h[inp.dataset.f] = v; recalcHosp(h);
    runAudit(); renderAudit(); renderHeaderKPIs(); renderKPIs(); if (S.tab === 'referral') renderReferral();
    showToast(`แก้ไข ${esc(h.hname)} แล้ว — คำนวณ BOR ใหม่เป็น ${calcBor(h) ?? '—'}% และตรวจสอบซ้ำให้อัตโนมัติ`, rowSev(S.issues.get(h.hcode)) === 'err' ? 'warn' : 'success');
  });
  $('#aud-body').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const h = S.hospitals.find(x => x.hcode === b.dataset.h); if (!h) return;
    if (b.dataset.act === 'map') { S.ref.hcode = h.hcode; S.ref.prov = null; S.ref.status = 'all'; S.ref.q = ''; $('#ref-q').value = ''; setSeg('#ref-status', 's', 'all'); setTab('referral'); setTimeout(focusRefSource, 120); }
    if (b.dataset.act === 'sync') { recalcHosp(h); afterAuditEdit(`ซิงก์ BOR และเตียงว่างของ ${esc(h.hname)} แล้ว`); }
  });
  $('#aud-sync').addEventListener('click', () => {
    let n = 0; S.hospitals.forEach(h => { const l = S.issues.get(h.hcode); if (l.some(i => i.code === 'BOR_MISMATCH' || i.code === 'DELTA_MISMATCH')) { recalcHosp(h); n++; } });
    afterAuditEdit(n ? `ซิงก์ BOR / เตียงว่างให้ตรงกับจำนวนเตียงและผู้ป่วยแล้ว ${n} แห่ง` : 'ไม่มีแถวที่ต้องซิงก์', n ? 'success' : 'info');
  });
  $('#aud-csv').addEventListener('click', exportAuditCSV);
  $('#aud-json').addEventListener('click', () => download('hospitals_corrected.json', JSON.stringify({ exported_at: new Date().toISOString(), hospitals: S.hospitals }, null, 1), 'application/json'));
  $('#aud-reset').addEventListener('click', () => { S.hospitals = JSON.parse(JSON.stringify(S.hospOrig)); runAudit(); renderAudit(); renderHeaderKPIs(); renderKPIs(); showToast('คืนค่าข้อมูลโรงพยาบาลเป็นค่าตั้งต้นแล้ว', 'info'); });
}
function afterAuditEdit(msg, type = 'success') { runAudit(); renderAudit(); renderHeaderKPIs(); renderKPIs(); if (S.tab === 'referral') renderReferral(); showToast(msg, type); }
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportAuditCSV() {
  const rows = [['hcode', 'hname', 'province', 'beds', 'occupied', 'bor_recorded', 'bor_calc', 'severity', 'issues']];
  S.hospitals.forEach(h => { const l = S.issues.get(h.hcode); if (l.length) rows.push([h.hcode, h.hname, h.prov_th, h.beds, h.occupied_beds, h.bor, calcBor(h) ?? '', rowSev(l) === 'err' ? 'ERROR' : 'WARNING', l.map(i => RULES[i.code].label + ': ' + i.text).join(' | ')]); });
  download('ipd_audit_issues.csv', '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

const AUD_COLS = [
  { k: 'sev', label: 'สถานะ', get: h => ({ err: 0, warn: 1, ok: 2 })[rowSev(S.issues.get(h.hcode))] },
  { k: 'hcode', label: 'รหัส', get: h => h.hcode },
  { k: 'hname', label: 'โรงพยาบาล', get: h => h.hname },
  { k: 'prov', label: 'จังหวัด', get: h => h.prov_th },
  { k: 'beds', label: 'เตียง (แก้ไขได้)', num: 1, get: h => h.beds },
  { k: 'occ', label: 'ใช้อยู่ (แก้ไขได้)', num: 1, get: h => h.occupied_beds },
  { k: 'bor', label: 'BOR บันทึก', num: 1, get: h => h.bor },
  { k: 'calc', label: 'BOR คำนวณ', num: 1, get: h => calcBor(h) ?? -1 },
  { k: 'iss', label: 'ปัญหาที่พบ', get: h => S.issues.get(h.hcode).length },
  { k: 'act', label: 'ดำเนินการ', ns: 1, get: () => 0 }
];
const PAGE = 25;
function renderAudit() {
  const a = S.audit, all = S.hospitals;
  let eRows = 0, wRows = 0, cRows = 0; const ruleCount = {};
  all.forEach(h => { const l = S.issues.get(h.hcode), s = rowSev(l); if (s === 'err') eRows++; else if (s === 'warn') wRows++; else cRows++; new Set(l.map(i => i.code)).forEach(c => { ruleCount[c] = (ruleCount[c] || 0) + 1; }); });
  const sumHost = $('#audit-sum');
  if (!sumHost.children.length) sumHost.innerHTML = [['rows', 'ตรวจสอบทั้งหมด (แถว)', '#22d3ee'], ['err', 'Error ต้องแก้ไข', '#ff8a1f'], ['warn', 'มีคำเตือน', '#fbbf24'], ['ok', 'ข้อมูลปกติ', '#34d399']].map(([id, t, c]) => `<article class="glass kpi" data-a="${id}" style="--kc:${c}"><h3>${t}</h3><div class="kpi-val"></div></article>`).join('');
  [['rows', all.length], ['err', eRows], ['warn', wRows], ['ok', cRows]].forEach(([id, v]) => rollTo($(`[data-a="${id}"] .kpi-val`, sumHost), fmt(v), 900));

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
  rows.sort((x, y) => { const vx = col.get(x), vy = col.get(y); const r = typeof vx === 'string' ? vx.localeCompare(vy, 'th') : vx - vy; return (r || (calcBor(y) ?? 0) - (calcBor(x) ?? 0)) * (col.k === 'iss' ? -a.sortDir : a.sortDir); });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); a.page = Math.min(Math.max(a.page, 1), pages);
  const slice = rows.slice((a.page - 1) * PAGE, a.page * PAGE);

  $('#aud-head').innerHTML = AUD_COLS.map(c => `<th ${c.ns ? '' : `data-k="${c.k}"`} class="${c.num ? 'num' : ''}">${c.label}${a.sortKey === c.k ? (a.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  $('#aud-body').innerHTML = slice.map(h => {
    const l = S.issues.get(h.hcode), s = rowSev(l);
    return `<tr class="${s === 'ok' ? '' : s}">
      <td>${s === 'err' ? '<b style="color:var(--orange)">ERROR</b>' : s === 'warn' ? '<span style="color:#fbbf24">เตือน</span>' : '<span class="ok-mark">✓ ปกติ</span>'}</td>
      <td>${esc(h.hcode)}</td><td>${esc(h.hname)}<div style="font-size:11px;color:var(--muted)">${esc(h.tier)}</div></td><td>${esc(h.prov_th)}</td>
      <td class="num"><input class="cell" type="number" min="0" value="${h.beds}" data-h="${h.hcode}" data-f="beds" aria-label="จำนวนเตียง ${esc(h.hname)}"></td>
      <td class="num"><input class="cell" type="number" min="0" value="${h.occupied_beds}" data-h="${h.hcode}" data-f="occupied_beds" aria-label="ผู้ป่วยที่ใช้เตียง ${esc(h.hname)}"></td>
      <td class="num">${h.bor}%</td><td class="num">${calcBor(h) ?? '—'}%</td>
      <td>${l.map(i => `<span class="tag ${i.sev}" title="${esc(i.text)}">${esc(RULES[i.code].label)}</span>`).join('') || '—'}${l.length ? `<div style="font-size:11.5px;color:var(--muted)">${esc(l[0].text)}</div>` : ''}</td>
      <td style="white-space:nowrap"><button class="btn mini" data-act="map" data-h="${h.hcode}">แผนที่</button>${l.some(i => i.code === 'BOR_MISMATCH' || i.code === 'DELTA_MISMATCH') ? ` <button class="btn mini orange" data-act="sync" data-h="${h.hcode}" title="คำนวณ BOR และเตียงว่างใหม่จากเตียง/ผู้ป่วย">ซิงก์ BOR</button>` : ''}</td></tr>`;
  }).join('') || `<tr><td colspan="10" style="padding:26px;text-align:center;color:var(--muted)">ไม่พบแถวตามเงื่อนไขที่เลือก</td></tr>`;
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
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${labels.map((l, i) => P(i, mx * f).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="rgba(148,163,184,0.18)"/>`).join('');
  const axes = labels.map((l, i) => { const [x, y] = P(i, mx), c = Math.cos(ang(i)); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.16)"/><text x="${(cx + Math.cos(ang(i)) * (R + 16)).toFixed(1)}" y="${(cy + Math.sin(ang(i)) * (R + 16) + 4).toFixed(1)}" text-anchor="${Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'}" fill="#9fb0c8" font-size="10.5">${esc(l.short)}</text>`; }).join('');
  const dots = labels.map((l, i) => { const [x, y] = P(i, vals[l.id] || 0); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#050a14" stroke="#22d3ee" stroke-width="2"><title>${esc(l.label)}: ${(vals[l.id] || 0).toFixed(1)}%</title></circle>`; }).join('');
  const ori = `${cx}px ${cy}px`;
  return `<svg viewBox="0 0 380 262" width="100%" role="img" aria-label="เรดาร์สัดส่วนกลุ่มโรค">${rings}${axes}
    ${base ? `<polygon points="${poly(base)}" fill="rgba(167,139,250,0.08)" stroke="#a78bfa" stroke-width="1.6" stroke-dasharray="4 4"/>` : ''}
    <g style="transform-origin:${ori};transform:scale(0.15);opacity:0;transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .5s" data-scale="1"><polygon points="${poly(vals)}" fill="rgba(34,211,238,0.22)" stroke="#22d3ee" stroke-width="2.2" style="filter:drop-shadow(0 0 6px rgba(34,211,238,.7))"/>${dots}</g></svg>`;
}
function donutSVG(parts, size = 130, thick = 16, center = '') {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, tot = parts.reduce((a, p) => a + p.v, 0) || 1;
  let off = 0;
  const arcs = parts.map(p => { const len = p.v / tot * C, seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${thick}" stroke-dasharray="0 ${C.toFixed(1)}" data-dash="${Math.max(len - 2, 0).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dasharray 1s cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 0 5px ${p.c})"><title>${esc(p.t)}</title></circle>`; off += len; return seg; }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(148,163,184,0.14)" stroke-width="${thick}"/>${arcs}${center}</svg>`;
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
    <div class="legend-line"><span><i style="background:#22d3ee"></i>${esc(sc.label)}</span>${natMix ? '<span><i style="background:#a78bfa"></i>ทั้งประเทศ</span>' : ''}</div>
    <div class="ins-note">กลุ่มสูงสุด: <b>${esc(topDom.label)}</b> ${(mix[topDom.id] || 0).toFixed(1)}%</div></article>`;

  // ---- gender ----
  const g = sc.gender;
  const gender = `<article class="glass ins"><div class="ins-k">สัดส่วนเพศผู้ป่วย</div>
    <div class="donut-row">${donutSVG([{ v: g.male, c: '#3b82f6', t: 'ชาย ' + fmt(g.male) }, { v: g.female, c: '#e879f9', t: 'หญิง ' + fmt(g.female) }], 140, 18, `<text x="70" y="68" text-anchor="middle" fill="#fff" font-family="Chakra Petch" font-size="20" font-weight="600">${g.female_pct}%</text><text x="70" y="84" text-anchor="middle" fill="#8a9bb4" font-size="10">หญิง</text>`)}
    <div class="dl"><div><i style="background:#3b82f6"></i>ชาย<b>${g.male_pct}%</b><small>${fmt(g.male)}</small></div><div><i style="background:#e879f9"></i>หญิง<b>${g.female_pct}%</b><small>${fmt(g.female)}</small></div></div></div>
    <div class="ins-note">ผู้ป่วยรายบุคคล ${fmt(sc.ref.total_patients)} คน · เฉลี่ย ${(sc.total24 / sc.ref.total_patients).toFixed(2)} ครั้ง/คน</div></article>`;

  // ---- hospitals ----
  const hs = hospInScope().slice().sort((a, b) => (calcBor(b) ?? 0) - (calcBor(a) ?? 0));
  const crit = hs.filter(h => (calcBor(h) ?? 0) >= 95).length, near = hs.filter(h => { const b = calcBor(h) ?? 0; return b >= 85 && b < 95; }).length;
  const hosp = `<article class="glass ins"><div class="ins-k">โรงพยาบาลที่เตียงตึงที่สุด</div>
    <div class="hp-sum"><span><b style="color:#ef4444">${crit}</b> วิกฤต</span><span><b style="color:#f59e0b">${near}</b> ใกล้เต็ม</span><span><b>${hs.length}</b> แห่งทั้งหมด</span></div>
    ${hs.slice(0, 6).map(h => { const b = calcBor(h) ?? 0, st = hospStatus(h); return `<div class="hp"><span title="${esc(h.hname)}">${esc(h.hname)}</span><b style="color:${st.color}">${b}%</b><span class="hb-bar"><em class="anim-w" style="width:0;background:${st.color}" data-w="${Math.min(b, 150) / 150 * 100}%"></em></span></div>`; }).join('') || '<div class="ins-note">ไม่มีข้อมูล รพ. ในพื้นที่นี้</div>'}
    <button class="pp-btn" id="ins-go-ref" style="margin-top:10px">เปิดแผนที่ส่งต่อผู้ป่วย</button></article>`;

  // ---- auto summary ----
  const provs = Object.entries(d.provinces).map(([k, p]) => ({ k, v: sumIdx(p.monthly_series, periodIdx(S.fy, S.q)) })).sort((a, b) => b.v - a.v);
  const fcSum = sc.forecast.reduce((a, f) => a + f.forecast, 0), fcPrev = sumIdx(sc.series, range(12, 18)), fcY = pctChange(fcSum, fcPrev);
  const lines = [];
  lines.push(`${sc.label} มีผู้ป่วยใน <b>${fmt(c.cur)}</b> ราย (${periodLabel()})${c.yoy != null ? ` ${c.yoy >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} <b style="color:${c.yoy >= 0 ? 'var(--up)' : 'var(--down)'}">${Math.abs(c.yoy).toFixed(1)}%</b> จากปีก่อน` : ''}`);
  if (sc.level === 'province') lines.push(`อยู่อันดับ <b>${provs.findIndex(x => x.k === S.province) + 1}</b> จาก 77 จังหวัด คิดเป็น ${(c.cur / provs.reduce((a, b) => a + b.v, 0) * 100).toFixed(2)}% ของผู้ป่วยทั้งประเทศ`);
  else if (sc.level === 'region') lines.push(`คิดเป็น ${(c.cur / sumIdx(nat.monthly_series, periodIdx(S.fy, S.q)) * 100).toFixed(1)}% ของผู้ป่วยทั้งประเทศ`);
  else lines.push(`จังหวัดที่มีผู้ป่วยสูงสุดคือ <b>${esc(d.provinces[provs[0].k].name_th)}</b> (${fmtC(provs[0].v)} ราย) ตามด้วย ${esc(d.provinces[provs[1].k].name_th)} และ ${esc(d.provinces[provs[2].k].name_th)}`);
  lines.push(`โรคที่พบมากสุดคือ <b>${esc(shortName(top.name_th))}</b> (${share.toFixed(1)}%)${lqs[0] && lqs[0].lq > 1.1 ? ` และ ${esc(lqs[0].x.pdx)} พบสูงกว่าค่าประเทศ ${lqs[0].lq.toFixed(1)} เท่า` : ''}`);
  lines.push(`BOR ${sc.bor.toFixed(1)}% ${sc.bor >= 85 ? '<b style="color:var(--orange)">เข้าเกณฑ์เฝ้าระวัง (≥85%)</b>' : 'อยู่ในเกณฑ์ปกติ'} · พยากรณ์ 6 เดือนหน้า ${fmtC(fcSum)} ราย${fcY != null ? ` (${fcY >= 0 ? '+' : ''}${fcY.toFixed(1)}% เทียบปีก่อน)` : ''}`);
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
    ${[0, 25, 50, 75, 100].map(t => `<line x1="${ml}" x2="${W - mr}" y1="${(mt + (1 - t / 100) * (H - mt - mb)).toFixed(1)}" y2="${(mt + (1 - t / 100) * (H - mt - mb)).toFixed(1)}" stroke="rgba(148,163,184,0.13)" stroke-dasharray="3 5"/><text x="${W - mr + 6}" y="${(mt + (1 - t / 100) * (H - mt - mb) + 4).toFixed(1)}" fill="#8a9bb4" font-size="10">${t}%</text>`).join('')}
    ${top.map((p, i) => { const h = p.v / ymax * (H - mt - mb), x = ml + i * bw + bw * 0.14; return `<rect x="${x.toFixed(1)}" y="${(H - mb - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${p.k === S.province ? '#fff' : '#22d3ee'}" opacity="${p.k === S.province ? 1 : 0.75}" style="filter:drop-shadow(0 0 5px rgba(34,211,238,.5))"><title>${esc(p.name)} ${fmt(p.v)} ราย</title></rect><text transform="translate(${(x + bw * 0.36).toFixed(1)},${H - mb + 12}) rotate(40)" fill="#9fb0c8" font-size="10.5">${esc(p.name)}</text>`; }).join('')}
    <path d="${cumArr.map((v, i) => `${i ? 'L' : 'M'}${(ml + i * bw + bw / 2).toFixed(1)},${(mt + (1 - v / 100) * (H - mt - mb)).toFixed(1)}`).join(' ')}" fill="none" stroke="#e879f9" stroke-width="2.4" style="filter:drop-shadow(0 0 5px #e879f9)"/>
    ${cumArr.map((v, i) => `<circle cx="${(ml + i * bw + bw / 2).toFixed(1)}" cy="${(mt + (1 - v / 100) * (H - mt - mb)).toFixed(1)}" r="3.5" fill="#050a14" stroke="#e879f9" stroke-width="2"><title>สะสม ${v.toFixed(1)}%</title></circle>`).join('')}
  </svg>`;

  // Seasonality heatmap
  const sc = getScope(), dis = S.disease ? sc.diseases.find(x => x.pdx === S.disease) : null, f = dis ? dis.cases / sc.total24 : 1;
  const ser = sc.series.map(v => v * f), mn = Math.min(...ser), mxs = Math.max(...ser);
  const mlab = i => TH_MONTHS[(9 + i) % 12];
  const cell = (i) => { const v = ser[i], t = (v - mn) / ((mxs - mn) || 1), q = Math.floor((i % 12) / 3) + 1; return `<div class="hm ${S.q === q ? 'selq' : ''}" style="background:rgba(34,211,238,${(0.08 + t * 0.82).toFixed(2)});color:${t > 0.55 ? '#031018' : '#cfe9f3'}" title="${monthLabel(S.data.metadata.months[i])}: ${fmt(v)} ราย">${fmtC(v)}</div>`; };
  const yoyCell = i => { const y = pctChange(ser[12 + i], ser[i]); const a = Math.min(Math.abs(y) / 15, 1); return `<div class="hm yy" style="background:${y >= 0 ? `rgba(251,113,133,${(0.12 + a * 0.6).toFixed(2)})` : `rgba(52,211,153,${(0.12 + a * 0.6).toFixed(2)})`}" title="YoY ${y.toFixed(1)}%">${y > 0 ? '+' : ''}${y.toFixed(0)}%</div>`; };
  const heat = `<div class="heat"><span></span>${range(0, 12).map(i => `<div class="hmh ${S.q === Math.floor(i / 3) + 1 ? 'selq' : ''}">${mlab(i)}</div>`).join('')}
    <span class="hl">ปีงบ 66</span>${range(0, 12).map(cell).join('')}
    <span class="hl">ปีงบ 67</span>${range(12, 24).map(cell).join('')}
    <span class="hl">YoY</span>${range(0, 12).map(yoyCell).join('')}</div>`;
  const peakI = ser.indexOf(mxs), lowI = ser.indexOf(mn);

  // Gender stacked
  const gHTML = A.items.slice().sort((a, b) => b.o.gender.female_pct - a.o.gender.female_pct).map(it => `<div class="gb"><span class="dn" title="${esc(it.name)}">${esc(it.name)}</span><div class="gbar"><i class="anim-w" style="width:0" data-w="${it.o.gender.male_pct}%"></i><i class="anim-w" style="width:0" data-w="${it.o.gender.female_pct}%"></i></div><small>ช ${it.o.gender.male_pct}% · ญ ${it.o.gender.female_pct}%</small></div>`).join('');

  host.innerHTML = `
    <article class="glass card"><div class="card-head"><div><h2>การกระจายผู้ป่วยตามพื้นที่</h2><p>${esc(A.title)} · ${periodLabel()}${dname ? ` · เฉพาะโรค ${esc(dname)} (ประมาณ)` : ''}</p></div></div><div class="dbars">${barsHTML}</div></article>
    <article class="glass card"><div class="card-head"><div><h2>ความกระจุกตัวรายจังหวัด (Pareto)</h2><p>10 จังหวัดแรกรวมกัน <b style="color:#f5d0fe">${cumArr[9].toFixed(1)}%</b> ของผู้ป่วย${S.region !== 'all' ? 'ในภูมิภาค' : 'ทั้งประเทศ'} · แท่ง = จำนวนเคส เส้น = สัดส่วนสะสม</p></div></div>${pareto}</article>
    <article class="glass card wide"><div class="card-head"><div><h2>ฤดูกาลของผู้ป่วย (เดือน × ปีงบ)</h2><p>${esc(sc.label)}${dname ? ' · ' + esc(dname) + ' (ประมาณ)' : ''} · สูงสุด <b style="color:#a5f3fc">${monthLabel(S.data.metadata.months[peakI])}</b> · ต่ำสุด ${monthLabel(S.data.metadata.months[lowI])}</p></div></div><div class="heat-wrap">${heat}</div></article>
    <article class="glass card wide"><div class="card-head"><div><h2>สัดส่วนเพศแยกตามพื้นที่</h2><p><span style="color:#3b82f6">■</span> ชาย <span style="color:#e879f9">■</span> หญิง · ${esc(A.title)}</p></div></div><div class="gbs">${gHTML}</div></article>`;
  popIn(host);
}

// -----------------------------------------------------------------------------
// 12. ZONES (เขตสุขภาพ) – small multiples
// -----------------------------------------------------------------------------
function renderZones() {
  const host = $('#zone-grid'); if (!host || !S.data) return;
  const d = S.data, idx = periodIdx(S.fy, S.q);
  let zs = Object.values(d.zones).filter(z => S.region === 'all' || z.region === S.region).map(z => ({ z, c: cmp(z.monthly_series) }));
  const key = { cases: r => r.c.cur, yoy: r => r.c.yoy ?? -999, bor: r => r.z.bor }[S.zoneSort];
  zs.sort((a, b) => key(b) - key(a));
  const mxC = Math.max(...zs.map(r => r.c.cur), 1);
  host.innerHTML = zs.map((r, i) => {
    const z = r.z, hs = S.hospitals.filter(h => h.zone === z.id), free = hs.reduce((a, h) => a + Math.max(h.beds - h.occupied_beds, 0), 0), crit = hs.filter(h => (calcBor(h) ?? 0) >= 95).length;
    const t = z.top_diseases[0], col = d.regions[z.region].color, bc = z.bor > 100 ? '#ef4444' : z.bor >= 85 ? '#f59e0b' : z.bor >= 75 ? '#fbbf24' : '#34d399';
    return `<article class="glass zone" style="--zc:${col}" data-region="${z.region}">
      <div class="z-head"><div><h3>${esc(z.name)}</h3><small>${esc(d.regions[z.region].name_th)} · ${z.provinces.length} จังหวัด</small></div><span class="z-rank">#${i + 1}</span></div>
      <div class="z-val roll" data-zroll="${fmt(r.c.cur)}"></div>
      <div class="z-sub">${yoyBadge(r.c.yoy, 'YoY')} <span style="color:var(--muted);font-size:12px">${r.c.prev != null ? 'ปีก่อน ' + fmtC(r.c.prev) : ''}</span></div>
      ${sparkSVG(z.monthly_series, z.forecast, idx, col)}
      <div class="z-bar"><span>BOR</span><div class="hb-bar"><em class="anim-w" style="width:0;background:${bc};box-shadow:0 0 8px ${bc}" data-w="${Math.min(z.bor, 110) / 110 * 100}%"></em></div><b style="color:${bc}">${z.bor.toFixed(1)}%</b></div>
      <div class="z-bar"><span>สัดส่วน</span><div class="hb-bar"><em class="anim-w" style="width:0;background:${col}" data-w="${(r.c.cur / mxC * 100).toFixed(0)}%"></em></div><b>${(r.c.cur / mxC * 100).toFixed(0)}%</b></div>
      <div class="z-foot"><span class="chip" style="border-color:${disColor(t)}77;background:${disColor(t)}18;color:#fff">${esc(t.pdx)} ${esc(shortName(t.name_th).slice(0, 18))}</span><span>รพ. ${hs.length} · ว่าง ${fmt(free)}${crit ? ` · <b style="color:#ef4444">วิกฤต ${crit}</b>` : ''}</span></div>
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
  const sig = [...S.issues.values()].map(l => l.map(i => i.code).join()).join(';') + '|' + S.audit.rule + '|' + hs.reduce((a, h) => a + h.beds + h.occupied_beds, 0);
  if (host.dataset.sig === sig) return; host.dataset.sig = sig;
  let e = 0, w = 0, ok = 0, severe = 0; const rc = {};
  hs.forEach(h => { const l = S.issues.get(h.hcode), s = rowSev(l); if (s === 'err') e++; else if (s === 'warn') w++; else ok++; if (h.beds > 0 && h.occupied_beds / h.beds > 1.5) severe++; new Set(l.map(i => i.code)).forEach(c => { rc[c] = (rc[c] || 0) + 1; }); });
  const score = Math.round((ok + w * 0.5) / n * 100);
  const sCol = score >= 85 ? '#34d399' : score >= 65 ? '#fbbf24' : '#ff8a1f';
  const ring = donutSVG([{ v: ok, c: '#34d399', t: `ปกติ ${ok}` }, { v: w, c: '#fbbf24', t: `เตือน ${w}` }, { v: e, c: '#ff8a1f', t: `Error ${e}` }], 150, 18,
    `<text x="75" y="76" text-anchor="middle" fill="${sCol}" font-family="Chakra Petch" font-size="30" font-weight="700">${score}</text><text x="75" y="93" text-anchor="middle" fill="#8a9bb4" font-size="10">คะแนนคุณภาพ</text>`);
  const ruleMax = Math.max(...Object.values(rc), 1);
  const ruleBars = Object.keys(RULES).filter(c => rc[c]).sort((a, b) => rc[b] - rc[a]).map(c => `<button class="rb ${S.audit.rule === c ? 'on' : ''}" data-rule="${c}"><span>${RULES[c].sev === 'e' ? '●' : '○'} ${RULES[c].label}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:${RULES[c].sev === 'e' ? '#ff8a1f' : '#fbbf24'}" data-w="${rc[c] / ruleMax * 100}%"></em></span><b>${rc[c]}</b></button>`).join('');

  // scatter
  const SW = 640, SH = 300, ml = 44, mr = 12, mt = 10, mb = 34;
  const hiV = Math.max(...hs.map(h => Math.max(h.beds, h.occupied_beds))) * 1.15, lo = Math.log10(8), hi = Math.log10(hiV);
  const X = v => ml + (Math.log10(Math.max(v, 8)) - lo) / (hi - lo) * (SW - ml - mr), Y = v => SH - mb - (Math.log10(Math.max(v, 8)) - lo) / (hi - lo) * (SH - mt - mb);
  const ticks = [10, 30, 100, 300, 1000, 3000].filter(t => t < hiV);
  const pts = hs.map(h => { const s = rowSev(S.issues.get(h.hcode)); return `<circle cx="${X(h.beds).toFixed(1)}" cy="${Y(h.occupied_beds).toFixed(1)}" r="${s === 'err' ? 4.2 : 3}" fill="${s === 'err' ? '#ff8a1f' : s === 'warn' ? '#fbbf24' : '#22d3ee'}" fill-opacity="${s === 'ok' ? 0.5 : 0.9}" ${s === 'err' ? 'style="filter:drop-shadow(0 0 4px #ff8a1f)"' : ''}><title>${esc(h.hname)} · เตียง ${fmt(h.beds)} · ผู้ป่วย ${fmt(h.occupied_beds)} (${calcBor(h) ?? '—'}%)</title></circle>`; }).join('');
  const scatter = `<svg viewBox="0 0 ${SW} ${SH}" width="100%" role="img" aria-label="เตียงเทียบผู้ป่วย">
    <polygon points="${X(8)},${Y(8)} ${X(hiV)},${Y(hiV)} ${X(8)},${Y(hiV)}" fill="rgba(255,138,31,0.07)"/>
    ${ticks.map(t => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${mt}" y2="${SH - mb}" stroke="rgba(148,163,184,0.1)"/><text x="${X(t).toFixed(1)}" y="${SH - mb + 14}" text-anchor="middle" fill="#8a9bb4" font-size="10">${t}</text><line y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" x1="${ml}" x2="${SW - mr}" stroke="rgba(148,163,184,0.1)"/><text x="${ml - 6}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end" fill="#8a9bb4" font-size="10">${t}</text>`).join('')}
    <line x1="${X(8)}" y1="${Y(8)}" x2="${X(hiV)}" y2="${Y(hiV)}" stroke="#ff8a1f" stroke-dasharray="5 4" stroke-width="1.4"/>
    <text x="${ml + 8}" y="${mt + 12}" fill="#ffd7ae" font-size="10.5">เหนือเส้น = ผู้ป่วยเกินจำนวนเตียง</text>
    <text x="${SW / 2}" y="${SH - 4}" text-anchor="middle" fill="#8a9bb4" font-size="10.5">จำนวนเตียง (log)</text>
    <text transform="translate(11,${SH / 2}) rotate(-90)" text-anchor="middle" fill="#8a9bb4" font-size="10.5">ผู้ป่วยที่ใช้เตียง (log)</text>${pts}</svg>`;

  // region error rate
  const regs = Object.values(S.data.regions).map(r => { const rs = hs.filter(h => h.region === r.id), er = rs.filter(h => rowSev(S.issues.get(h.hcode)) === 'err').length; return { r, n: rs.length, er }; }).filter(x => x.n).sort((a, b) => b.er / b.n - a.er / a.n);
  const regHTML = regs.map(x => `<div class="dbar"><span class="dn">${esc(x.r.name_th)}</span><span class="hb-bar"><em class="anim-w" style="width:0;background:#ff8a1f;box-shadow:0 0 8px #ff8a1f88" data-w="${(x.er / x.n * 100).toFixed(0)}%"></em></span><b style="color:#ffd7ae">${(x.er / x.n * 100).toFixed(0)}%</b><small>${x.er}/${x.n} แห่ง</small></div>`).join('');

  host.innerHTML = `
    <article class="glass card"><div class="card-head"><div><h2>คะแนนคุณภาพข้อมูล</h2><p>แถวปกติเต็มคะแนน แถวคำเตือนครึ่งคะแนน แถว Error ไม่ได้คะแนน</p></div></div>
      <div class="donut-row">${ring}<div class="dl"><div><i style="background:#34d399"></i>ปกติ<b>${ok}</b></div><div><i style="background:#fbbf24"></i>คำเตือน<b>${w}</b></div><div><i style="background:#ff8a1f"></i>Error<b>${e}</b></div></div></div>
      <div class="ins-note">ผู้ป่วยเกิน 150% ของเตียง <b style="color:#ffd7ae">${severe}</b> แห่ง — น่าจะเป็นตัวเลขเตียงในระบบผิด</div></article>
    <article class="glass card"><div class="card-head"><div><h2>เตียง vs ผู้ป่วย</h2><p>จุดส้ม = Error · เหลือง = เตือน · ฟ้า = ปกติ</p></div></div>${scatter}</article>
    <article class="glass card"><div class="card-head"><div><h2>ปัญหาแยกตามกฎ</h2><p>คลิกเพื่อกรองตารางด้านล่าง</p></div></div><div class="rbs">${ruleBars || '<div class="ins-note">ไม่พบปัญหา</div>'}</div></article>
    <article class="glass card"><div class="card-head"><div><h2>สัดส่วน รพ. ที่มี Error ต่อภูมิภาค</h2><p>จัดอันดับภูมิภาคที่ควรเร่งตรวจสอบ</p></div></div><div class="dbars">${regHTML}</div></article>`;
  popIn(host);
  $$('.rb', host).forEach(b => b.addEventListener('click', () => { S.audit.rule = S.audit.rule === b.dataset.rule ? null : b.dataset.rule; S.audit.page = 1; renderAudit(); }));
}

boot();
