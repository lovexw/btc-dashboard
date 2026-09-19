/* ═══════════ BTC 全景仪表盘 · 前端逻辑 ═══════════ */
const $ = (s) => document.querySelector(s);
const UP = "#dc2626", DOWN = "#16a34a", BRAND = "#f7931a", BLUE = "#2f6fed", PURPLE = "#8b5cf6", TEAL = "#0d9488", GRAY = "#98a1b2";
const ZONE_COLORS = { z1: "#16a34a", z2: "#65a30d", z3: "#d97706", z4: "#ea580c", z5: "#dc2626", z0: GRAY };
const HALVINGS = ["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"];

const state = { overview: null, history: null, onchain: null, mining: null, sentiment: null, etf: null, health: null, staleKeys: new Set(), builtin: null, price: null };
const charts = new Map(); // name -> echarts instance
const chartVisible = new Set(), chartBuilt = new Set();

/* ───────── 工具 ───────── */
const fmtUSD = (v, dp = 0) => v == null || !isFinite(v) ? "—" : "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });
const fmtBig = (v) => v == null ? "—" : v >= 1e12 ? (v / 1e12).toFixed(2) + " 万亿" : v >= 1e8 ? (v / 1e8).toFixed(1) + " 亿" : v >= 1e4 ? (v / 1e4).toFixed(1) + " 万" : Math.round(v).toLocaleString();
const fmtPct = (v, dp = 1, signed = true) => v == null || !isFinite(v) ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(dp) + "%";
const fmtX = (v) => v == null ? "—" : v.toFixed(2) + "×";
const fmtDate = (ts) => new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtYi = (m) => m == null || !isFinite(m) ? "—" : (m >= 0 ? "+" : "") + "$" + (Math.abs(m) / 100).toFixed(m >= 10000 || Math.abs(m) < 10 ? 1 : 2) + " 亿";
const zoneCls = (v, th) => { // th: [[threshold, cls], ...] 升序
  for (const [t, c] of th) if (v < t) return c;
  return th[th.length - 1][1];
};
const zoneLabel = (v, th, labels) => labels[th.findIndex(([t]) => v < t)] ?? labels[labels.length - 1];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function getJSON(key, url, { store = true } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (store) { try { localStorage.setItem("btc:" + key, JSON.stringify({ t: Date.now(), d })); } catch {} }
      state.staleKeys.delete(key);
      return { data: d, stale: false, from: "live" };
    } catch (e) {
      lastErr = e;
      if (attempt === 0) { await new Promise((res) => setTimeout(res, 900)); continue; }
    }
  }
  {
    const raw = store ? localStorage.getItem("btc:" + key) : null;
    if (raw) {
      try { const { t, d } = JSON.parse(raw); state.staleKeys.add(key); return { data: d, stale: true, from: "snapshot", age: Date.now() - t }; } catch {}
    }
    if (!state.builtin) { state.builtin = await fetch("data/snapshot.json").then((r) => (r.ok ? r.json() : null)).catch(() => null); }
    if (state.builtin && state.builtin[key]) { state.staleKeys.add(key); return { data: state.builtin[key], stale: true, from: "builtin", age: 0 }; }
    throw e;
  }
}

function updateStaleBanner() {
  $("#staleBanner").hidden = state.staleKeys.size === 0;
}

/* ───────── 综合估值（客户端全量计算） ───────── */
const DIMS = [
  { key: "mvrv", label: "MVRV", w: .2, pts: [[0.5, 2], [0.8, 5], [1.0, 15], [1.5, 35], [2.5, 62], [3.2, 82], [4.2, 96]] },
  { key: "wmaRatio", label: "价格/200周线", w: .18, pts: [[0.7, 2], [0.95, 10], [1.2, 25], [2, 50], [3, 75], [4, 92], [5.5, 98]] },
  { key: "plRatio", label: "价格/幂律公允", w: .18, pts: [[0.35, 2], [0.6, 12], [0.8, 28], [1, 45], [1.5, 70], [2, 88], [2.6, 97]] },
  { key: "puell", label: "Puell 乘数", w: .12, pts: [[0.25, 5], [0.5, 15], [0.8, 32], [1.2, 52], [2, 72], [3.2, 88], [4.5, 97]] },
  { key: "lthNupl", label: "LTH-NUPL", w: .12, pts: [[-0.15, 2], [0, 10], [0.2, 30], [0.4, 50], [0.6, 70], [0.78, 86], [0.9, 96]] },
  { key: "sipPct", label: "盈利供应占比", w: .1, pts: [[40, 3], [55, 15], [70, 30], [85, 55], [95, 78], [99, 93]] },
  { key: "fgi", label: "恐惧贪婪指数", w: .1, pts: [[8, 3], [20, 15], [35, 32], [50, 48], [70, 70], [85, 88], [95, 96]] },
];
function piecewise(x, pts) {
  if (x == null || !isFinite(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
function fullComposite() {
  const o = state.overview, c = state.onchain;
  if (!o) return null;
  const L = c && c.latest ? c.latest : {};
  const v = {
    mvrv: L.mvrv ?? null,
    wmaRatio: o.valuation.wmaRatio,
    plRatio: o.valuation.plRatio,
    puell: L.puell ?? null,
    lthNupl: L.lthNupl ?? null,
    sipPct: L.sipPct ?? null,
    fgi: o.fgi ? o.fgi.value : null,
  };
  let num = 0, den = 0;
  const dims = DIMS.map((d) => { const s = piecewise(v[d.key], d.pts); if (s != null) { num += s * d.w; den += d.w; } return { label: d.label, score: s == null ? null : Math.round(s) }; });
  return { score: den ? Math.round(num / den) : null, dims };
}
const scoreZone = (s) => s == null ? { label: "数据不足", cls: "z0" } : s < 20 ? { label: "深度低估", cls: "z1" } : s < 40 ? { label: "偏低估", cls: "z2" } : s < 60 ? { label: "中性", cls: "z3" } : s < 80 ? { label: "偏热", cls: "z4" } : { label: "过热", cls: "z5" };

/* ───────── ECharts 基础 ───────── */
function mkChart(name, build) {
  const el = document.querySelector(`[data-chart="${name}"]`);
  if (!el || typeof echarts === "undefined") return;
  let inst = charts.get(name);
  if (!inst) { inst = echarts.init(el); charts.set(name, inst); }
  inst.clear();
  inst.setOption(build());
  requestAnimationFrame(() => inst.resize()); // 滚动进视口时容器尺寸可能未稳，强制重绘一次
}
function axisExtra() {
  return {
    axisLine: { lineStyle: { color: "#e7e9ee" } },
    axisTick: { show: false },
    axisLabel: { color: "#8a92a3", fontSize: 10.5 },
    splitLine: { lineStyle: { color: "#f0f2f6" } },
  };
}
function baseOpt({ legend = [], log = false, grid = {} } = {}) {
  return {
    animationDuration: 500,
    grid: { left: 58, right: 18, top: legend.length ? 30 : 20, bottom: 40, ...grid },
    legend: { top: 2, right: 4, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: "#697180", fontSize: 11 }, data: legend },
    tooltip: {
      trigger: "axis", backgroundColor: "#fff", borderColor: "#e7e9ee", borderWidth: 1,
      textStyle: { color: "#171a20", fontSize: 12 }, padding: [8, 12],
      valueFormatter: (v) => v == null ? "—" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v,
    },
    xAxis: { type: "time", ...axisExtra(), splitLine: { show: false } },
    yAxis: { type: log ? "log" : "value", logBase: 10, ...axisExtra() },
    series: [],
  };
}
const toPairs = (dates, values, from = 0) => {
  const out = [];
  for (let i = from; i < dates.length; i++) if (values[i] != null) out.push([dates[i], values[i]]);
  return out;
};
// BRK 的早期口径（2015 年前）与主流图差异较大，估值类图表统一从 2016 年起展示
const from2016 = (dates) => Math.max(0, dates.findIndex((d) => d >= "2016-01-01"));
function halvingAreas(dates) {
  const areas = [];
  const last = dates[dates.length - 1];
  const marks = [...HALVINGS, last];
  for (let i = 0; i < marks.length - 1; i++) areas.push([
    { xAxis: marks[i], itemStyle: { color: i % 2 ? "rgba(47,111,237,.05)" : "rgba(247,147,26,.06)" } },
    { xAxis: marks[i + 1] },
  ]);
  return areas;
}
function line(name, data, color, width = 1.6, extra = {}) {
  return { name, type: "line", data, showSymbol: false, lineStyle: { width, color }, itemStyle: { color }, emphasis: { focus: "series" }, ...extra };
}

/* ───────── 各图表构建器 ───────── */
const BUILDERS = {
  main: () => {
    const h = state.history; if (!h) return nullOpt();
    const o = baseOpt({ legend: ["BTC 价格", "200周均线", "MA250"], log: true, grid: { right: 20 } });
    o.series = [
      line("BTC 价格", toPairs(h.dates, h.series.price), BLUE, 1.5, { areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(47,111,237,.14)" }, { offset: 1, color: "rgba(47,111,237,0)" }] } } }),
      line("200周均线", toPairs(h.dates, h.series.wma200), BRAND, 1.8),
      line("MA250", toPairs(h.dates, h.series.ma250), PURPLE, 1.2, { lineStyle: { width: 1.2, type: [4, 3], color: PURPLE } }),
    ];
    o.series[0].markArea = { silent: true, data: halvingAreas(h.dates) };
    o.tooltip.formatter = (ps) => tipHtml(ps, (v) => fmtUSD(v));
    return o;
  },
  pl: () => {
    const h = state.history; if (!h) return nullOpt();
    const o = baseOpt({ legend: ["价格", "幂律公允", "支撑带", "压力带"], log: true });
    o.series = [
      line("价格", toPairs(h.dates, h.series.price), "#5b6472", 1.4),
      line("幂律公允", toPairs(h.dates, h.series.plFair), BLUE, 1.8),
      line("支撑带", toPairs(h.dates, h.series.plSupport), DOWN, 1.2, { lineStyle: { type: [4, 3], color: DOWN, width: 1.2 } }),
      line("压力带", toPairs(h.dates, h.series.plResist), UP, 1.2, { lineStyle: { type: [4, 3], color: UP, width: 1.2 } }),
    ];
    o.tooltip.formatter = (ps) => tipHtml(ps, (v) => fmtUSD(v));
    return o;
  },
  mvrv: () => {
    const c = state.onchain; if (!c || !c.series.mvrv) return nullOpt();
    const o = baseOpt({ legend: ["MVRV"] });
    const f = from2016(c.series.mvrv.dates);
    o.series = [line("MVRV", toPairs(c.series.mvrv.dates, c.series.mvrv.values, f), BLUE, 1.6)];
    o.series[0].markArea = { silent: true, data: [
      [{ yAxis: 0, itemStyle: { color: "rgba(22,163,74,.07)" } }, { yAxis: 1 }],
      [{ yAxis: 3.2, itemStyle: { color: "rgba(220,38,38,.07)" } }, { yAxis: 5 }],
    ] };
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, type: "dashed", width: 1 }, label: { color: "#8a92a3", fontSize: 10 }, data: [{ yAxis: 1, label: { formatter: "1.0 全市场保本" } }, { yAxis: 3.2, label: { formatter: "3.2 顶部区" } }] };
    return o;
  },
  nupl: () => {
    const c = state.onchain; if (!c || !c.series.nupl) return nullOpt();
    const o = baseOpt({ legend: ["全网 NUPL", "LTH-NUPL"] });
    o.series = [
      line("全网 NUPL", toPairs(c.series.nupl.dates, c.series.nupl.values, from2016(c.series.nupl.dates)), BLUE, 1.5),
      line("LTH-NUPL", toPairs(c.series.lthNupl.dates, c.series.lthNupl.values, from2016(c.series.lthNupl.dates)), BRAND, 1.5),
    ];
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, type: "dashed", width: 1 }, label: { color: "#8a92a3", fontSize: 10 }, data: [{ yAxis: 0, label: { formatter: "0" } }, { yAxis: 0.75, label: { formatter: "0.75 顶部区" } }] };
    return o;
  },
  puell: () => {
    const c = state.onchain; if (!c || !c.series.puell) return nullOpt();
    const o = baseOpt({ legend: ["Puell 乘数"] });
    o.series = [line("Puell 乘数", toPairs(c.series.puell.dates, c.series.puell.values), TEAL, 1.5, { areaStyle: { color: "rgba(13,148,136,.08)" } })];
    o.series[0].markArea = { silent: true, data: [
      [{ yAxis: 0, itemStyle: { color: "rgba(22,163,74,.07)" } }, { yAxis: 0.5 }],
      [{ yAxis: 4, itemStyle: { color: "rgba(220,38,38,.07)" } }, { yAxis: 6 }],
    ] };
    return o;
  },
  rr: () => {
    const c = state.onchain; if (!c || !c.series.reserveRisk) return nullOpt();
    const o = baseOpt({ legend: ["Reserve Risk"] });
    o.series = [line("Reserve Risk", toPairs(c.series.reserveRisk.dates, c.series.reserveRisk.values), PURPLE, 1.5)];
    return o;
  },
  sopr: () => {
    const c = state.onchain; if (!c || !c.series.sopr) return nullOpt();
    const o = baseOpt({ legend: ["SOPR"] });
    const f = from2016(c.series.sopr.dates);
    const srcTag = (c.series.sopr.source || "").includes("BRK") ? "（BRK 口径·波动小）" : "";
    o.series = [line("SOPR" + srcTag, toPairs(c.series.sopr.dates, c.series.sopr.values, f), BLUE, 1.4)];
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, type: "dashed", width: 1 }, label: { color: "#8a92a3", fontSize: 10 }, data: [{ yAxis: 1, label: { formatter: "1.0 保本线" } }] };
    o.yAxis.scale = true;
    return o;
  },
  sip: () => {
    const c = state.onchain; if (!c || !c.series.sipPct) return nullOpt();
    const o = baseOpt({ legend: ["盈利供应 %"], grid: { right: 58 } });
    o.series = [line("盈利供应 %", toPairs(c.series.sipPct.dates, c.series.sipPct.values), TEAL, 1.5, { areaStyle: { color: "rgba(13,148,136,.08)" } })];
    o.series[0].markArea = { silent: true, data: [
      [{ yAxis: 0, itemStyle: { color: "rgba(22,163,74,.07)" } }, { yAxis: 50 }],
      [{ yAxis: 95, itemStyle: { color: "rgba(220,38,38,.07)" } }, { yAxis: 100 }],
    ] };
    return o;
  },
  cost: () => {
    const c = state.onchain, h = state.history; if (!c || !c.series.realizedPrice) return nullOpt();
    const s = c.series;
    const o = baseOpt({ legend: ["BTC 价格", "已实现价格", "真实市场均值", "STH 成本", "UTXO 中位成本", "均衡价格"], log: true, grid: { right: 20 } });
    const L = [];
    if (h) L.push(line("BTC 价格", toPairs(h.dates, h.series.price, Math.max(0, h.dates.findIndex((d) => d >= s.realizedPrice.dates[0]))), "#aab2c0", 1.2));
    L.push(
      line("已实现价格", toPairs(s.realizedPrice.dates, s.realizedPrice.values), BLUE, 1.5),
      line("真实市场均值", toPairs(s.tmm.dates, s.tmm.values), PURPLE, 1.3),
      line("STH 成本", toPairs(s.sthRealizedPrice.dates, s.sthRealizedPrice.values), UP, 1.3),
      line("UTXO 中位成本", toPairs(s.utxoC50.dates, s.utxoC50.values), TEAL, 1.3),
    );
    if (s.balancedPrice) L.push(line("均衡价格", toPairs(s.balancedPrice.dates, s.balancedPrice.values), BRAND, 1.4));
    o.series = L;
    o.tooltip.formatter = (ps) => tipHtml(ps, (v) => fmtUSD(v));
    return o;
  },
  urpd: () => {
    const c = state.onchain; if (!c || !c.urpd) return nullOpt();
    const u = c.urpd;
    const o = baseOpt({ legend: [], grid: { left: 80, right: 30, top: 14, bottom: 44 } });
    o.xAxis = { type: "value", ...axisExtra(), axisLabel: { ...axisExtra().axisLabel, formatter: (v) => v + "%" } };
    o.yAxis = { type: "category", data: u.bands.map((b) => b.label).reverse(), ...axisExtra(), splitLine: { show: false }, axisLabel: { color: "#697180", fontSize: 10.5 } };
    o.tooltip = { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#fff", borderColor: "#e7e9ee", textStyle: { color: "#171a20", fontSize: 12 },
      formatter: (ps) => { const b = u.bands[u.bands.length - 1 - ps[0].dataIndex]; return `<b>${esc(b.label)}</b><br/>持币 ${fmtBig(b.supplyBtc)} BTC（${b.supplyPct}%）<br/>累计 ${b.cumPct}%<br/>平均成本 ${b.avgCost ? fmtUSD(b.avgCost) : "—"}`; } };
    o.series = [{
      type: "bar", data: u.bands.map((b) => b.supplyPct).reverse(), barWidth: "62%",
      itemStyle: { color: (p) => (u.close != null && u.bands[u.bands.length - 1 - p.dataIndex].floor != null && u.bands[u.bands.length - 1 - p.dataIndex].floor <= u.close ? "rgba(47,111,237,.75)" : "rgba(220,38,38,.55)"), borderRadius: [0, 4, 4, 0] },
      markLine: u.close ? { silent: true, symbol: "none", xAxis: null, data: [], label: { show: false } } : undefined,
    }];
    // 当前价格线：用 extra markPoint 简化为标注
    if (u.close != null) {
      const nearest = u.bands.reduce((best, b) => (Math.abs((b.avgCost ?? b.floor) - u.close) < Math.abs((best.avgCost ?? best.floor) - u.close) ? b : best), u.bands[0]);
      o.graphic = { elements: [{ type: "text", style: { text: `现价 ≈ ${fmtUSD(u.close)}`, fill: BRAND, font: "bold 11px sans-serif" }, right: 16, top: 4 }] };
      void nearest;
    }
    return o;
  },
  lthloss: () => {
    const c = state.onchain; if (!c || !c.series.lthLossBtc) return nullOpt();
    const o = baseOpt({ legend: ["LTH 亏损供应 (BTC)"] });
    o.series = [line("LTH 亏损供应 (BTC)", toPairs(c.series.lthLossBtc.dates, c.series.lthLossBtc.values), UP, 1.5, { areaStyle: { color: "rgba(220,38,38,.07)" } })];
    o.tooltip.valueFormatter = (v) => fmtBig(v);
    return o;
  },
  etf: () => {
    const e = state.etf; if (!e || !e.series) return nullOpt();
    const o = baseOpt({ legend: ["每日净流入", "累计净流入"], grid: { right: 62 } });
    o.series = [
      { name: "每日净流入", type: "bar", data: e.series, barWidth: "55%", itemStyle: { color: (p2) => (p2.value[1] >= 0 ? "rgba(220,38,38,.55)" : "rgba(22,163,74,.6)"), borderRadius: 2 } },
      { name: "累计净流入", type: "line", yAxisIndex: 1, data: e.cumSeries, showSymbol: false, lineStyle: { color: BRAND, width: 1.8 }, itemStyle: { color: BRAND } },
    ];
    o.yAxis = [
      { type: "value", ...axisExtra(), name: "日净流($M)", nameTextStyle: { color: "#8a92a3", fontSize: 10 } },
      { type: "value", ...axisExtra(), scale: true, splitLine: { show: false }, axisLabel: { color: "#8a92a3", fontSize: 10.5, formatter: (v) => "$" + (v / 1000).toFixed(0) + "B" } },
    ];
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] };
    o.tooltip.formatter = (ps) => {
      const t = ps[0] && ps[0].value[0] ? new Date(ps[0].value[0]).toLocaleDateString("zh-CN") : "";
      const rows = ps.map((p2) => `<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#697180">${esc(p2.seriesName)}</span><b>${p2.seriesName === "每日净流入" ? fmtYi(p2.value[1]) : "$" + (p2.value[1] / 1000).toFixed(1) + "B"}</b></div>`).join("");
      return `<div style="min-width:170px"><div style="font-weight:700;margin-bottom:4px">${t}</div>${rows}</div>`;
    };
    return o;
  },
  zscore: () => {
    const c = state.onchain; if (!c || !c.series.mvrvZ) return nullOpt();
    const o = baseOpt({ legend: ["MVRV Z"] });
    const f = from2016(c.series.mvrvZ.dates);
    o.series = [line("MVRV Z", toPairs(c.series.mvrvZ.dates, c.series.mvrvZ.values, f), BLUE, 1.6, { areaStyle: { color: "rgba(47,111,237,.07)" } })];
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, type: "dashed", width: 1 }, label: { color: "#8a92a3", fontSize: 10 }, data: [{ yAxis: 0, label: { formatter: "0 成本线" } }, { yAxis: 6, label: { formatter: "6 顶部区" } }] };
    return o;
  },
  zfull: () => {
    const c = state.onchain, h = state.history; if (!c || !c.series.mvrvZ || !h) return nullOpt();
    const o = baseOpt({ legend: ["MVRV Z", "BTC 价格"], grid: { right: 62 } });
    const f = from2016(c.series.mvrvZ.dates);
    o.series = [
      { name: "BTC 价格", type: "line", yAxisIndex: 1, data: toPairs(h.dates, h.series.price, Math.max(0, h.dates.findIndex((d) => d >= c.series.mvrvZ.dates[f]))), showSymbol: false, lineStyle: { color: "#aab2c0", width: 1.1 }, itemStyle: { color: "#aab2c0" } },
      line("MVRV Z", toPairs(c.series.mvrvZ.dates, c.series.mvrvZ.values, f), BLUE, 1.7),
    ];
    o.yAxis = [{ type: "value", ...axisExtra() }, { type: "log", logBase: 10, ...axisExtra(), splitLine: { show: false } }];
    o.tooltip.formatter = (ps) => tipHtml(ps.filter((p2) => p2.seriesName === "MVRV Z"), (v) => v.toFixed(2)) + (ps.some((p2) => p2.seriesName === "BTC 价格") ? tipHtml(ps.filter((p2) => p2.seriesName === "BTC 价格"), (v) => fmtUSD(v)).replace("<div", "<div") : "");
    return o;
  },
  hodl: () => {
    const c = state.onchain; if (!c || !c.series.lthShare) return nullOpt();
    const o = baseOpt({ legend: ["LTH 供应占比 %"] });
    o.series = [line("LTH 供应占比 %", toPairs(c.series.lthShare.dates, c.series.lthShare.values), TEAL, 1.6, { areaStyle: { color: "rgba(13,148,136,.08)" } })];
    o.yAxis.max = 100;
    return o;
  },
  dormancy: () => {
    const c = state.onchain; if (!c || !c.series.dormancy) return nullOpt();
    const o = baseOpt({ legend: ["休眠指数"] });
    const f = from2016(c.series.dormancy.dates);
    o.series = [line("休眠指数", toPairs(c.series.dormancy.dates, c.series.dormancy.values, f), PURPLE, 1.5, { areaStyle: { color: "rgba(139,92,246,.07)" } })];
    return o;
  },
  adr: () => {
    const m = state.mining; if (!m || !m.netActivity) return nullOpt();
    const o = baseOpt({ legend: ["活跃地址", "交易数"], grid: { right: 62 } });
    o.series = [
      { name: "活跃地址", type: "line", data: m.netActivity.dates.map((d, i) => [d, m.netActivity.adr[i]]), showSymbol: false, lineStyle: { color: BLUE, width: 1.5 }, itemStyle: { color: BLUE } },
      { name: "交易数", type: "line", yAxisIndex: 1, data: m.netActivity.dates.map((d, i) => [d, m.netActivity.tx[i]]), showSymbol: false, lineStyle: { color: BRAND, width: 1.4 }, itemStyle: { color: BRAND } },
    ];
    o.yAxis = [{ type: "value", ...axisExtra(), scale: true }, { type: "value", ...axisExtra(), scale: true, splitLine: { show: false } }];
    return o;
  },
  hash: () => {
    const m = state.mining; if (!m || !m.hashrate) return nullOpt();
    const o = baseOpt({ legend: ["算力 EH/s", "难度 T"], grid: { right: 54 } });
    o.series = [
      { name: "算力 EH/s", type: "line", data: m.hashrate.series.map(([t, v]) => [t * 1000, v]), showSymbol: false, lineStyle: { color: BLUE, width: 1.6 }, itemStyle: { color: BLUE } },
      { name: "难度 T", type: "line", yAxisIndex: 1, data: (m.difficultySeries || []).map(([t, v]) => [t * 1000, v]), showSymbol: false, lineStyle: { color: BRAND, width: 1.4, type: [3, 2] }, itemStyle: { color: BRAND } },
    ];
    o.yAxis = [ { type: "value", ...axisExtra(), scale: true }, { type: "value", ...axisExtra(), scale: true, splitLine: { show: false } } ];
    return o;
  },
  fgi: () => {
    const s = state.sentiment; if (!s || !s.fgi) return nullOpt();
    const o = baseOpt({ legend: ["FGI"] });
    o.series = [line("FGI", s.fgi.series, BLUE, 1.5, { areaStyle: { color: "rgba(47,111,237,.08)" } })];
    o.series[0].markArea = { silent: true, data: [
      [{ yAxis: 0, itemStyle: { color: "rgba(22,163,74,.07)" } }, { yAxis: 25 }],
      [{ yAxis: 75, itemStyle: { color: "rgba(220,38,38,.07)" } }, { yAxis: 100 }],
    ] };
    o.yAxis.max = 100;
    return o;
  },
  funding: () => {
    const s = state.sentiment; if (!s || !s.funding || !s.funding.series) return nullOpt();
    const data = s.funding.series.map(([t, r]) => [t, +(r * 100).toFixed(4)]);
    const o = baseOpt({ legend: ["8h 费率 %"] });
    o.series = [{ name: "8h 费率 %", type: "bar", data, itemStyle: { color: (p) => (p.value[1] >= 0 ? "rgba(220,38,38,.55)" : "rgba(22,163,74,.6)"), borderRadius: 2 }, barWidth: "60%" }];
    o.series[0].markLine = { silent: true, symbol: "none", lineStyle: { color: GRAY, width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] };
    return o;
  },
  stables: () => {
    const s = state.sentiment; if (!s || !s.stablecoins) return nullOpt();
    const o = baseOpt({ legend: ["USDT", "USDC"], grid: { right: 24 } });
    o.series = [
      { name: "USDT", type: "line", data: s.stablecoins.usdt.series.map(([t, v]) => [t, v]), showSymbol: false, lineStyle: { color: TEAL, width: 1.6 }, itemStyle: { color: TEAL }, areaStyle: { color: "rgba(13,148,136,.06)" } },
      { name: "USDC", type: "line", data: s.stablecoins.usdc.series.map(([t, v]) => [t, v]), showSymbol: false, lineStyle: { color: BLUE, width: 1.6 }, itemStyle: { color: BLUE }, areaStyle: { color: "rgba(47,111,237,.06)" } },
    ];
    o.tooltip.valueFormatter = (v) => "$" + (v == null ? "—" : v.toLocaleString()) + " 亿";
    return o;
  },
};
function nullOpt() {
  return { graphic: { elements: [{ type: "text", style: { text: "数据加载中…", fill: "#98a1b2", font: "13px sans-serif" }, left: "center", top: "middle" }] } };
}
function tipHtml(ps, fmt) {
  const title = ps[0] && ps[0].value[0] ? new Date(ps[0].value[0]).toLocaleDateString("zh-CN") : "";
  const rows = ps.map((p) => `<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#697180">${esc(p.seriesName)}</span><b>${fmt(p.value[1])}</b></div>`).join("");
  return `<div style="min-width:150px"><div style="font-weight:700;margin-bottom:4px">${title}</div>${rows}</div>`;
}

/* 数据到位后重绘 */
function refreshVisibleCharts() {
  for (const name of chartVisible) tryBuild(name);
}
function tryBuild(name) {
  if (!BUILDERS[name]) return;
  const opt = BUILDERS[name]();
  if (!opt) return;
  mkChart(name, () => opt);
  chartBuilt.add(name);
}
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
const io = new IntersectionObserver((es) => {
  es.forEach((e) => {
    const name = e.target.getAttribute("data-chart");
    if (e.isIntersecting) { chartVisible.add(name); tryBuild(name); }
  });
}, { rootMargin: "120px" });
document.querySelectorAll("[data-chart]").forEach((el) => io.observe(el));

/* ───────── Hero 渲染 ───────── */
function chgChip(label, v) {
  const cls = v == null ? "" : v >= 0 ? "up" : "down";
  return `<span class="chip">${label} <b class="${cls}">${fmtPct(v)}</b></span>`;
}
function renderHero(ov) {
  state.price = ov.price.usd;
  const chg24 = ov.price.changePct24h;
  $("#price").outerHTML = `<span id="price" class="price-big fade-in">${fmtUSD(ov.price.usd)}</span>`;
  $("#chg24").outerHTML = `<span id="chg24" class="chg ${chg24 >= 0 ? "up" : "down"} fade-in">${fmtPct(chg24)}<small style="font-size:11px;color:var(--muted)"> 24h</small></span>`;
  $("#chgRow").innerHTML = [chgChip("7日", ov.changes.d7), chgChip("30日", ov.changes.d30), chgChip("90日", ov.changes.d90), chgChip("1年", ov.changes.d365)].join("");
  $("#athRow").innerHTML = `<span class="pill">ATH ${fmtUSD(ov.ath.value)} <span class="muted">(${ov.ath.date.slice(0, 7)})</span></span> <span class="pill">距 ATH <b class="${ov.ath.drawdownPct >= 0 ? "chg up" : "chg down"}" style="font-weight:700">${fmtPct(ov.ath.drawdownPct)}</b></span>`;
  $("#mcapRow").innerHTML = `市值 ${fmtBig(ov.marketCap)} 美元 · 流通量 ${fmtBig(ov.supply)} BTC`;
  $("#priceSrcRow").innerHTML = `价格源：${esc(ov.price.source)} · 收盘基准日 ${ov.meta.lastCloseDate}`;

  // 减半环
  const hv = ov.halving;
  if (hv) {
    const C = 2 * Math.PI * 52;
    $("#ringFg").style.strokeDashoffset = C * (1 - hv.epochProgressPct / 100);
    $("#halvingPct").textContent = hv.epochProgressPct.toFixed(1) + "%";
    $("#halvingSub").innerHTML = `距第 5 次减半还有 <b>${hv.blocksLeft.toLocaleString()}</b> 块 ≈ <b>${hv.etaDays}</b> 天<div class="muted" style="font-size:11px">预计 ${hv.etaDate} · 奖励 ${hv.currentReward} → ${hv.nextReward} BTC</div>`;
  }
  // FGI gauge
  if (ov.fgi) {
    $("#gaugeFgi").className = "chart gauge";
    mkGauge("gaugeFgi", ov.fgi.value, "FGI");
    $("#gaugeFgiSub").innerHTML = `${fgiLabel(ov.fgi.value)} · 一周前 ${ov.fgi.value - (ov.fgi.value - (state.sentiment?.fgi?.weekAgo ?? ov.fgi.value))}`;
    $("#gaugeFgiSub").innerHTML = `${fgiLabel(ov.fgi.value)}（${ov.fgi.value}/100）`;
  }
  renderComposite();
  renderQuickStrip();
  $("#updatedAt").textContent = "更新 " + fmtDate(ov.ts);
}
function fgiLabel(v) { return v < 25 ? "极度恐惧" : v < 45 ? "恐惧" : v < 55 ? "中性" : v < 75 ? "贪婪" : "极度贪婪"; }

function mkGauge(id, value, name) {
  const el = document.getElementById(id);
  if (!el || typeof echarts === "undefined") return;
  let inst = charts.get(id);
  if (!inst) { inst = echarts.init(el); charts.set(id, inst); }
  inst.setOption({
    series: [{
      type: "gauge", min: 0, max: 100, startAngle: 210, endAngle: -30, radius: "95%",
      progress: { show: false },
      axisLine: { lineStyle: { width: 12, color: [[0.2, "#22c55e"], [0.4, "#a3e635"], [0.6, "#fbbf24"], [0.8, "#fb923c"], [1, "#ef4444"]] } },
      pointer: { length: "58%", width: 4, itemStyle: { color: "#3a4150" } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      anchor: { show: true, size: 6, itemStyle: { color: "#3a4150" } },
      title: { show: false },
      detail: { valueAnimation: true, fontSize: 24, fontWeight: 800, offsetCenter: [0, "32%"], color: "#171a20", formatter: () => String(value) },
      data: [{ value }],
    }],
  });
}
function renderComposite() {
  const c = fullComposite();
  if (!c) return;
  mkGauge("gaugeComp", c.score, "score");
  const z = scoreZone(c.score);
  $("#gaugeCompSub").innerHTML = `<span class="badge ${z.cls}">${z.label}</span> <span class="muted">${c.dims.filter((d) => d.score != null).map((d) => `${d.label} ${d.score}`).join(" · ")}</span>`;
}

/* ───────── 快捷条 ───────── */
function renderQuickStrip() {
  const o = state.overview, c = state.onchain && state.onchain.latest ? state.onchain.latest : {}, s = state.sentiment;
  const items = [
    { k: "MVRV", v: c.mvrv != null ? fmtX(c.mvrv) : "…", tip: "市值/已实现市值" },
    { k: "SOPR", v: c.sopr != null ? c.sopr.toFixed(3) : "…", tip: "花费产出利润率" },
    { k: "Puell 乘数", v: c.puell != null ? c.puell.toFixed(2) : "…", tip: "矿工收入偏离度" },
    { k: "盈利供应", v: c.sipPct != null ? c.sipPct.toFixed(1) + "%" : "…", tip: "处于盈利的筹码占比" },
    { k: "LTH-NUPL", v: c.lthNupl != null ? c.lthNupl.toFixed(2) : "…", tip: "长期持有者浮盈" },
    { k: "资金费率(年化)", v: s && s.funding ? fmtPct(s.funding.aprPct, 1) : o && o.funding ? fmtPct(o.funding.aprPct, 1) : "…", tip: "OKX 永续合约年化" },
    { k: "稳定币 30d Δ", v: s && s.stablecoins ? `<span class="${s.stablecoins.usdt.d30Pct >= 0 ? "up" : "down"}">${fmtPct(s.stablecoins.usdt.d30Pct)}</span>` : o && o.stablecoins ? `<span class="${o.stablecoins.usdt.d30Pct >= 0 ? "up" : "down"}">${fmtPct(o.stablecoins.usdt.d30Pct)}</span>` : "…", tip: "USDT 市值 30 天变化（增量资金）" },
    { k: "Coinbase 溢价", v: s && s.coinbasePremiumPct != null ? fmtPct(s.coinbasePremiumPct, 2) : o && o.coinbasePremiumPct != null ? fmtPct(o.coinbasePremiumPct, 2) : "…", tip: "Coinbase 相对 Binance 溢价（美股资金情绪）" },
    { k: "ETF 30日净流", v: state.etf ? fmtYi(state.etf.sum30M) : "…", tip: "美国现货比特币 ETF 最近 30 个交易日净流入（Farside）" },
  ];
  $("#quickStrip").innerHTML = items.map((i) => `<div class="qs" title="${esc(i.tip)}"><div class="k">${esc(i.k)}</div><div class="v">${i.v}</div></div>`).join("");
}

/* ───────── 估值卡 ───────── */
function valCard({ title, tip, value, sub, zone, extra }) {
  return `<div class="card val-card fade-in"><div class="label">${esc(title)} <i class="tip" data-tip="${esc(tip)}"></i></div>
    <div class="v">${value}</div><div class="s">${sub || ""}</div>
    <div class="zone-row">${zone || ""}${extra || ""}</div></div>`;
}
function renderValuation() {
  const o = state.overview, c = state.onchain && state.onchain.latest ? state.onchain.latest : {};
  const V = o.valuation, price = o.price.usd;
  const fit = V.fitRatio || 1;
  const cards = [];

  // AHR999 经典
  const ahr = V.ahr999;
  const ahrTh = [[0.45, "z1"], [1.2, "z2"], [5, "z3"], [Infinity, "z5"]];
  const ahrLb = ["抄底区", "定投区", "观望区", "泡沫区"];
  cards.push(valCard({
    title: "AHR999 指数（经典）", tip: "比特币定投界的网红指标 =（价格÷200日定投成本）×（价格÷指数增长拟合价）。<0.45 历史级抄底；0.45–1.2 适合定投；>1.2 观望；>5 泡沫。",
    value: ahr != null ? ahr.toFixed(3) : "…",
    sub: `定投成本 ${fmtUSD(V.dca200)} · 现价为其 ${(V.dcaRatio * 100).toFixed(0)}%`,
    zone: ahr != null ? `<span class="badge ${zoneCls(ahr, ahrTh)}">${zoneLabel(ahr, ahrTh, ahrLb)}</span>` : "",
  }));
  // AHR999 新拟合
  const ahrN = V.ahrNew;
  const nTh = [[0.45 * fit, "z1"], [1.2 * fit, "z2"], [5 * fit, "z3"], [Infinity, "z5"]];
  cards.push(valCard({
    title: "AHR999 · 新拟合", tip: `用 2013 年至今全历史重新拟合的增长曲线替换 2018 年的旧曲线（阈值同步 ×${fit.toFixed(3)}），对新周期更敏感。区间含义同经典版。`,
    value: ahrN != null ? ahrN.toFixed(3) : "…",
    sub: `自拟合幂律阈值 ×${fit.toFixed(3)}`,
    zone: ahrN != null ? `<span class="badge ${zoneCls(ahrN, nTh)}">${zoneLabel(ahrN, nTh, ahrLb)}</span>` : "",
  }));
  // MVRV
  const mvrvTh = [[1, "z1"], [1.5, "z2"], [2.5, "z3"], [3.5, "z4"], [Infinity, "z5"]];
  const mvrvLb = ["严重低估", "偏低估", "中性", "偏热", "过热"];
  cards.push(valCard({
    title: "MVRV", tip: "市值 ÷ 已实现市值 = 全体持币者的平均盈利倍数。<1 全网平均被套（历史大底附近）；>3.5 全网浮盈过厚（历史大顶附近）。",
    value: c.mvrv != null ? fmtX(c.mvrv) : "…",
    sub: c.mvrv != null ? `平均每枚 BTC 浮盈 ${(c.mvrv - 1) >= 0 ? "+" : ""}${((c.mvrv - 1) * 100).toFixed(0)}%` : "",
    zone: c.mvrv != null ? `<span class="badge ${zoneCls(c.mvrv, mvrvTh)}">${zoneLabel(c.mvrv, mvrvTh, mvrvLb)}</span>` : "",
  }));
  // 价格/200WMA
  const wTh = [[1, "z1"], [2, "z2"], [3, "z3"], [4, "z4"], [Infinity, "z5"]];
  const wLb = ["史诗级低估", "积累区", "中性", "偏热", "顶部风险"];
  cards.push(valCard({
    title: "价格 / 200周均线", tip: "200 周加权均线是比特币历史上从未被有效跌破的生命线。现价相对它的倍数是周期位置的经典标尺：历史顶部约为 3–4 倍。",
    value: fmtX(V.wmaRatio),
    sub: `200WMA = ${fmtUSD(V.wma200)}`,
    zone: `<span class="badge ${zoneCls(V.wmaRatio, wTh)}">${zoneLabel(V.wmaRatio, wTh, wLb)}</span>`,
  }));
  // 幂律位置
  const plP = V.plSupport != null && V.plResist != null && V.plResist > V.plSupport ? ((price - V.plSupport) / (V.plResist - V.plSupport)) * 100 : null;
  cards.push(valCard({
    title: "幂律走廊位置", tip: "价格在『支撑带 ↔ 压力带』走廊中的百分比位置。贴近 0% = 踩在历史强支撑；贴近 100% = 触及过热压力。",
    value: fmtX(V.plRatio) + " 公允价",
    sub: plP != null ? `走廊位置 ${Math.max(0, Math.min(100, plP)).toFixed(0)}% · 支撑 ${fmtUSD(V.plSupport)} / 压力 ${fmtUSD(V.plResist)}` : "",
    zone: plP != null ? `<span class="badge ${plP < 25 ? "z1" : plP < 55 ? "z2" : plP < 80 ? "z3" : "z5"}">${plP < 25 ? "支撑区" : plP < 55 ? "中低位" : plP < 80 ? "中高位" : "压力区"}</span>` : "",
  }));
  // 均衡价格
  cards.push(valCard({
    title: "均衡价格 Balanced Price", tip: "已实现价格 − 转移价格（1 年内活跃资本的链上成本）。类似『全网平均成本 − 热钱成本』，是极罕见的深度底部线，历史上仅短暂触及。",
    value: c.balancedPrice != null ? fmtUSD(c.balancedPrice) : "…",
    sub: c.balancedPrice != null ? `现价 / 均衡价 = ${fmtX(price / c.balancedPrice)}` : "",
    zone: c.balancedPrice != null ? `<span class="badge ${price > c.balancedPrice ? "z2" : "z1"}">${price > c.balancedPrice ? "价格上方" : "深度罕见区"}</span>` : "",
  }));
  // Reserve Risk
  const rrTh = [[0.002, "z1"], [0.006, "z3"], [Infinity, "z5"]];
  const rrLb = ["低风险高回报", "中性", "高风险低回报"];
  cards.push(valCard({
    title: "Reserve Risk", tip: "衡量『持币机会成本』的指标：长期持有者越惜售数值越低，意味着继续持有的风险回报比越 attractive；飙升说明筹码在被派发。",
    value: c.reserveRisk != null ? (c.reserveRisk < 0.001 ? c.reserveRisk.toPrecision(2) : c.reserveRisk.toFixed(4)) : "…",
    sub: "越低越值得持有",
    zone: c.reserveRisk != null ? `<span class="badge ${zoneCls(c.reserveRisk, rrTh)}">${zoneLabel(c.reserveRisk, rrTh, rrLb)}</span>` : "",
  }));
  // Pi Cycle
  cards.push(valCard({
    title: "Pi Cycle 顶部距离", tip: "111 日均线×2 追上 350 日均线×2 时，历史上三次都在周期顶点附近触发。当前两线距离越远说明周期越未到顶。",
    value: V.piGapPct != null ? V.piGapPct.toFixed(1) + "%" : "…",
    sub: `111DMA×2 ${fmtUSD(V.pi111)} vs 350DMA×2 ${fmtUSD(V.pi350)}`,
    zone: V.piGapPct != null ? `<span class="badge ${V.piGapPct > 40 ? "z1" : V.piGapPct > 15 ? "z3" : "z5"}">${V.piGapPct > 40 ? "远离顶部" : V.piGapPct > 15 ? "观察" : "接近警戒"}</span>` : "",
  }));
  // MVRV Z-Score
  if (c.mvrvZ != null) {
    const pct = c.mvrvZPct;
    cards.push(valCard({
      title: "MVRV Z-Score", tip: "(市值−已实现市值)÷市值标准差：浮盈相对历史常态的偏离度。≤0.1 历史大底区（2015/2018/2022 都出现过）；≥6 历史顶部区。括号内为当前值在 2013 年以来自身的百分位。",
      value: c.mvrvZ.toFixed(2),
      sub: pct != null ? `高于 2013 年以来 ${pct}% 的时间` : "",
      zone: `<span class="badge ${c.mvrvZ <= 0.1 ? "z1" : c.mvrvZ < 2 ? "z2" : c.mvrvZ < 4 ? "z3" : c.mvrvZ < 6 ? "z4" : "z5"}">${c.mvrvZ <= 0.1 ? "历史大底区" : c.mvrvZ < 2 ? "偏低估" : c.mvrvZ < 4 ? "中性" : c.mvrvZ < 6 ? "偏热" : "顶部区"}</span>`,
    }));
  }
  // 定投成本
  cards.push(valCard({
    title: "200日定投成本", tip: "每天买 1 元连买 200 天的平均成本（调和平均，接近真实定投成本）。现价低于它 = 定投党整体被套，历史上多为定投黄金窗口。",
    value: fmtUSD(V.dca200),
    sub: `现价为其 ${(V.dcaRatio * 100).toFixed(0)}%`,
    zone: `<span class="badge ${V.dcaRatio < 1 ? "z1" : V.dcaRatio < 1.3 ? "z2" : "z3"}">${V.dcaRatio < 1 ? "定投黄金期" : V.dcaRatio < 1.3 ? "合理区间" : "定投成本上方"}</span>`,
  }));
  $("#valGrid").innerHTML = cards.join("");
  renderTry();
}
function renderTry() {
  const input = $("#tryPrice");
  if (!input.dataset.bound) {
    input.dataset.bound = "1";
    input.addEventListener("input", renderTry);
  }
  const P = parseFloat(input.value);
  const o = state.overview;
  if (!o || !P || P < 100) { $("#tryOut").textContent = "输入后自动试算"; return; }
  const V = o.valuation, fit = V.fitRatio || 1;
  const fitClassic = V.plFair / fit;
  const ahr = (P / V.dca200) * (P / fitClassic);
  const ahrN = (P / V.dca200) * (P / V.plFair);
  const ahrLb = ahr < 0.45 ? "抄底区" : ahr < 1.2 ? "定投区" : ahr < 5 ? "观望区" : "泡沫区";
  const wLb = P < V.wma200 ? "生命线下方（史诗低估）" : P < V.wma200 * 2 ? "积累区" : P < V.wma200 * 3 ? "中性" : P < V.wma200 * 4 ? "偏热" : "顶部风险";
  $("#tryOut").innerHTML = `AHR999 <b>${ahr.toFixed(3)}</b>（${ahrLb}）· 新拟合 <b>${ahrN.toFixed(3)}</b> · /200周线 <b>${(P / V.wma200).toFixed(2)}×</b>（${wLb}）· /幂律公允 <b>${(P / V.plFair).toFixed(2)}×</b> · /定投成本 <b>${(P / V.dca200).toFixed(2)}×</b>`;
}

/* ───────── 成本阶梯 ───────── */
function renderLadder() {
  const o = state.overview, h = state.history, c = state.onchain && state.onchain.latest ? state.onchain.latest : {};
  if (!o) return;
  const price = o.price.usd;
  const anchors = [
    { name: "UTXO 中位成本", small: "一半筹码低于此成本", v: c.utxoC50 },
    { name: "真实市场均值 TMM", small: "剔除早期币的真实成本", v: c.tmm },
    { name: "全网已实现价格", small: "全体持币平均成本", v: c.realizedPrice },
    { name: "短期持有者成本", small: "155 天内新资金成本", v: c.sthRealizedPrice },
    { name: "200日定投成本", small: "定投党的平均成本", v: h ? h.stats.latest.dca200 : null },
    { name: "转移价格", small: "1 年内活跃资本成本", v: c.transferPrice },
    { name: "200周均线", small: "历史生命线", v: h ? h.stats.latest.wma200 : null },
    { name: "均衡价格", small: "深度底部线", v: c.balancedPrice },
    { name: "MA250 年线", small: "一年的平均成本", v: h ? h.stats.latest.ma250 : null },
    { name: "MA850 四年线", small: "跨周期均线", v: h ? h.stats.latest.ma850 : null },
  ].filter((a) => a.v != null && isFinite(a.v)).sort((a, b) => b.v - a.v);
  const LO = Math.log(0.3), HI = Math.log(3.5);
  const pos = (v) => Math.max(0, Math.min(1, (Math.log(v / price) - LO) / (HI - LO)));
  const marker = pos(price) * 100;
  const rows = anchors.map((a) => {
    const dist = (price / a.v - 1) * 100;
    const p = pos(a.v) * 100;
    const left = Math.min(p, marker), width = Math.abs(p - marker);
    const above = dist >= 0; // 价格在成本线上方 → 该群体盈利（红=浮盈结构），下方=被套（绿）
    return `<div class="ladder-row">
      <div class="name">${esc(a.name)}<small>${esc(a.small)} · ${fmtUSD(a.v)}</small></div>
      <div class="ladder-bar"><i style="left:${left}%;width:${Math.max(0.5, width)}%;background:${above ? "rgba(220,38,38,.24)" : "rgba(22,163,74,.28)"}"></i><b class="price-marker" style="left:${marker}%"></b></div>
      <div class="dist ${above ? "up" : "down"}">${fmtPct(dist, 0)}</div>
    </div>`;
  }).join("");
  $("#costLadder").innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:6px">横向位置 = 成本价的相对高低；右侧高于橙线（现价）= 上方压力成本，左侧低于现价 = 下方支撑成本。百分比 = 现价相对该成本线的高低（正=价格在线上方，该群体平均盈利 ${price ? "" : ""}）。当前价格 <b>${fmtUSD(price)}</b>。</div>` + rows;
}

/* ───────── 链上卡 ───────── */
function renderOnchainCards() {
  const c = state.onchain; if (!c || !c.latest) return;
  const L = c.latest;
  const o = state.overview;
  const price = o ? o.price.usd : null;
  const items = [
    { t: "STH 短期持有者成本", v: L.sthRealizedPrice != null ? fmtUSD(L.sthRealizedPrice) : "—", s: price && L.sthRealizedPrice ? `现价 ${price > L.sthRealizedPrice ? "上方（新资金盈利）" : "下方（新资金被套）"} ${fmtPct((price / L.sthRealizedPrice - 1) * 100)}` : "", tip: "155 天内买入的币的平均成本，即最新一轮资金的入场价。牛市回调常在此获支撑；跌破则是趋势转弱信号。" },
    { t: "真实市场均值 TMM", v: L.tmm != null ? fmtUSD(L.tmm) : "—", s: price && L.tmm ? `现价/线 = ${fmtX(price / L.tmm)}` : "", tip: "剔除早年几乎零成本的币后，市场『真实』的平均成本。熊市底部常围绕它反复争夺。" },
    { t: "UTXO 中位成本 C50", v: L.utxoC50 != null ? fmtUSD(L.utxoC50) : "—", s: "一半筹码的成本低于此价", tip: "把所有未花费输出按成本排序取中位数。价格贴近它说明接近一半市场参与者被套，往往对应底部区。" },
    { t: "转移价格 Transfer Price", v: L.transferPrice != null ? fmtUSD(L.transferPrice) : "—", s: "1 年内活跃资本的成本", tip: "近一年活跃筹码的链上成本，代表『热钱』的成本线。" },
    { t: "STH-MVRV", v: L.sthMvrv != null ? fmtX(L.sthMvrv) : "—", s: "短期持有者盈亏倍数", tip: "新资金平均盈利(<1 被套)程度。历史上 STH-MVRV 深度 <0.9 常见于熊底，>1.3 常见于牛市过热。" },
    { t: "全网 NUPL", v: L.nupl != null ? L.nupl.toFixed(3) : "—", s: "全网浮盈率（市值-已实现市值/市值）", tip: "全网未实现净盈亏占比。<0 全网亏损（投降区）；>0.75 泡沫区。" },
    { t: "LTH 供应占比", v: L.lthSupplySharePct != null ? L.lthSupplySharePct.toFixed(1) + "%" : "—", s: "持有 155 天+ 的筹码比例", tip: "HODL Waves 的简化版：占比升高=囤币沉淀（熊底/牛市前夜），骤降=老筹码派发（牛市顶部）。" },
    { t: "休眠指数（1 周均）", v: L.dormancy != null ? L.dormancy.toFixed(2) : "—", s: "老币移动程度，越低越惜售", tip: "币天销毁的归一化版本。飙升=沉睡老币苏醒换手（顶部派发常见）；低迷=囤币装死（底部常见）。" },
  ];
  $("#onchainCards").innerHTML = items.map((i) => valCard({ title: i.t, tip: i.tip, value: i.v, sub: i.s })).join("");
}

/* ───────── 矿业 ───────── */
function renderMining() {
  const m = state.mining; if (!m) return;
  const cards = [];
  if (m.difficultyAdjustment) {
    const d = m.difficultyAdjustment;
    cards.push(valCard({
      title: "难度调整", tip: "每 2016 块（约两周）自动调整一次挖矿难度。预计上调=算力在增长（矿工看好/新机器入场）；大幅下调=矿机关机潮。",
      value: fmtPct(d.changePct, 1),
      sub: `还剩 ${d.remainingBlocks} 块 · 预计 ${d.estimatedRetargetDate} · 上次 ${fmtPct(d.previousRetargetPct)}`,
      zone: `<span class="badge ${d.changePct > 0 ? "up" : "down"}">${d.changePct > 0 ? "算力增长" : "算力回落"}</span>`,
      extra: `<div class="progress" style="width:100%"><i style="width:${d.progressPct}%"></i></div>`,
    }));
  }
  if (m.hashrate) cards.push(valCard({ title: "全网算力", tip: "7 日平均算力，代表矿工投入的总算力规模，是对比特币安全性与长期信心的度量。", value: m.hashrate.currentEHs + " EH/s", s: "7 日平均（百亿亿次哈希/秒）" }));
  if (m.reward) cards.push(valCard({ title: "24h 区块奖励", tip: "矿工一天的区块补贴+手续费收入。减半后补贴每 4 年腰斩，手续费占比会逐渐上升。", value: m.reward.reward24hBtc + " BTC", s: `补贴 + 手续费 ${m.reward.fees24hBtc} BTC · ${m.reward.tx24h.toLocaleString()} 笔交易` }));
  if (m.fees) cards.push(valCard({ title: "链上手续费", tip: "内存池推荐费率（sat/vByte）。转账越拥挤费率越高；长期低于 5 sat/vB 说明链上很空闲。", value: m.fees.fastestFee + " sat/vB", s: `最快 ${m.fees.fastestFee} · 30分钟 ${m.fees.halfHourFee} · 1小时 ${m.fees.hourFee}` }));
  if (m.mempool) cards.push(valCard({ title: "内存池占用", tip: "等待打包的交易总量。越大越拥堵，费率越高。", value: m.mempool.vsizeMB + " MB", s: `${m.mempool.count.toLocaleString()} 笔待确认 · 待付 ${m.mempool.totalFeeBtc} BTC` }));
  if (m.tip) cards.push(valCard({ title: "区块高度", tip: "当前主链块高。每 210,000 块奖励减半一次。", value: m.tip.toLocaleString(), s: `下次减半于 ${Math.ceil((m.tip + 1) / 210000) * 210000 - m.tip} 块后` }));
  if (m.hashRibbons) {
    const rb = m.hashRibbons;
    cards.push(valCard({
      title: "Hash Ribbons 算力均线", tip: "算力 30 日均线 vs 60 日均线。30 日重新上穿 60 日（金叉）=矿工投降结束、算力恢复，历史上常对应牛市的最佳买入窗口之一；死叉=矿机关机潮。",
      value: rb.sma30 + " / " + rb.sma60 + " EH/s",
      s: rb.lastCross ? `最近交叉：${rb.lastCross.date}（${rb.lastCross.dir === "up" ? "金叉" : "死叉"}）` : "",
      zone: `<span class="badge ${rb.status === "up" ? "down" : "up"}">${rb.status === "up" ? "算力上行" : "算力下行"}</span>`,
    }));
  }
  $("#miningCards").innerHTML = cards.join("");

  if (m.shutdown) {
    const s = m.shutdown;
    const cell = (r, w) => `<td class="${s.price >= r.price ? "on" : "off"}">${fmtUSD(r.price)}</td>`;
    const effs = [...new Set(s.rows.map((r) => r.effJth))];
    const elecs = [...new Set(s.rows.map((r) => r.elecUsd))];
    $("#shutdownBox").innerHTML = `<table><thead><tr><th>能效 \ 电价</th>${elecs.map((w) => `<th>$${w}/kWh</th>`).join("")}</tr></thead>
      <tbody>${effs.map((e) => `<tr><td><b>${e} J/TH</b></td>${s.rows.filter((r) => r.effJth === e).map((r) => cell(r)).join("")}</tr>`).join("")}</tbody></table>
      <div class="cap">现价 <b>${fmtUSD(s.price)}</b> · 中位关机价 <b>${fmtUSD(s.median)}</b>（现价${s.marginPct >= 0 ? "高出中位 " + s.marginPct + "%" : "低于中位 " + (-s.marginPct) + "%"}）<br/>日产出 ≈ ${s.dailyIssuanceBtc} BTC + 手续费 ${s.dailyFeesBtc} BTC · 假设：${esc(s.assumptions)}</div>`;
  }
}

/* ───────── ETF 资金流 ───────── */
function renderEtf() {
  const e = state.etf; if (!e || !e.latest) return;
  const dir = e.latest.totalM >= 0;
  const cards = [
    { t: "ETF 最新单日净流入", v: fmtYi(e.latest.totalM), s: e.latest.date + "（美东交易日）", z: dir ? "up" : "down", zl: dir ? "净流入" : "净流出", tip: "当日所有美国现货比特币 ETF 的申购减赎回净额。持续为正=机构在增持敞口。" },
    { t: "最近 7 日累计", v: fmtYi(e.sum7M), s: "一周机构资金方向", z: e.sum7M >= 0 ? "up" : "down", zl: e.sum7M >= 0 ? "流入" : "流出", tip: "近 7 个交易日净流入之和，过滤单日噪音看周度趋势。" },
    { t: "最近 30 日累计", v: fmtYi(e.sum30M), s: "月度资金面", z: e.sum30M >= 0 ? "up" : "down", zl: e.sum30M >= 0 ? "流入" : "流出", tip: "近 30 个交易日净流入之和。月度级别持续流入是牛市最重要的燃料之一。" },
    { t: "上市以来累计", v: fmtYi(e.cumulativeM), s: "2024-01-11 上市至今 · " + e.updatedDate + " 更新", z: "", zl: "", tip: "现货 ETF 上市以来净申购总规模，代表通过受监管渠道进入比特币的传统资本总量。" },
  ];
  $("#etfCards").innerHTML = cards.map((i) => valCard({ title: i.t, tip: i.tip, value: i.v, sub: i.s, zone: i.z ? `<span class="badge ${i.z}">${i.zl}</span>` : "" })).join("") +
    (e.issuers && e.issuers.length ? `<div class="card val-card fade-in"><div class="label">各 ETF 累计净流入 <i class="tip" data-tip="上市以来每只基金的累计净申购（百万美元）。IBIT（贝莱德）与 FBTC（富达）占大头；GBTC 为负=灰度老信托在持续赎回。"></i></div><div class="s" style="line-height:2">${e.issuers.slice(0, 6).map((x) => `<b>${esc(x.name)}</b> ${fmtYi(x.cumM)}`).join(" · ")}</div></div>` : "");
}

/* ───────── 情绪 ───────── */
function renderSentiment() {
  const s = state.sentiment; if (!s) return;
  const cards = [];
  if (s.fgi) cards.push(valCard({
    title: "恐惧贪婪指数", tip: "Alternative.me 综合 60% 波动率与动量、25% 社交热度等。0–100，越恐惧越是别人害怕时。",
    value: s.fgi.now + " " + fgiLabel(s.fgi.now),
    s: `一周前 ${s.fgi.weekAgo ?? "—"} · 一月前 ${s.fgi.monthAgo ?? "—"}`,
    zone: `<span class="badge ${s.fgi.now < 25 ? "z1" : s.fgi.now < 45 ? "z2" : s.fgi.now < 55 ? "z3" : s.fgi.now < 75 ? "z4" : "z5"}">${fgiLabel(s.fgi.now)}</span>`,
  }));
  if (s.funding) cards.push(valCard({
    title: "永续资金费率（年化）", tip: "OKX BTC 永续合约。正=多头付给空头（多头拥挤）；负=空头付费。长期极端正年化常伴随杠杆过热。",
    value: fmtPct(s.funding.aprPct, 1),
    s: `8h 费率 ${(s.funding.rate * 100).toFixed(4)}% · 下次结算 ${new Date(s.funding.nextTs).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
    zone: `<span class="badge ${s.funding.aprPct > 30 ? "z5" : s.funding.aprPct > 12 ? "z4" : s.funding.aprPct > 0 ? "z3" : "z1"}">${s.funding.aprPct > 30 ? "多头拥挤" : s.funding.aprPct > 12 ? "偏热" : s.funding.aprPct > 0 ? "正常" : "空头拥挤"}</span>`,
  }));
  if (s.stablecoins) {
    const st = s.stablecoins;
    cards.push(valCard({
      title: "稳定币弹药库", tip: "USDT+USDC 总市值 = 场外待入场资金总量。30 天增量持续为正是牛市燃料，持续为负要小心。",
      value: fmtBig(st.total.now) + " 美元",
      s: `USDT ${fmtPct(st.usdt.d30Pct)} · USDC ${fmtPct(st.usdc.d30Pct)}（30天）`,
      zone: `<span class="badge ${st.usdt.d30Pct + st.usdc.d30Pct >= 0 ? "down" : "up"}">${st.usdt.d30Pct + st.usdc.d30Pct >= 0 ? "增量流入" : "存量收缩"}</span>`,
    }));
  }
  if (s.coinbasePremiumPct != null) cards.push(valCard({
    title: "Coinbase 溢价", tip: "Coinbase（美国合规所）相对 Binance 的价差。持续正溢价代表美国机构/散户在主动买入。近似口径，供参考。",
    value: fmtPct(s.coinbasePremiumPct, 3),
    s: "Coinbase vs Binance 现货",
    zone: `<span class="badge ${s.coinbasePremiumPct >= 0 ? "up" : "down"}">${s.coinbasePremiumPct >= 0 ? "美盘买盘" : "美盘卖压"}</span>`,
  }));
  $("#sentCards").innerHTML = cards.join("");

  // Polymarket
  if (s.polymarket && s.polymarket.up) {
    const pm = s.polymarket;
    const row = (m, color) => `<div class="pm-row"><span class="t">$${m.target.toLocaleString()}</span><div class="bar"><i style="width:${m.pct}%;background:${color}"></i></div><span class="p">${m.pct}%</span></div>`;
    $("#pmBox").innerHTML = `
      <div class="pm-group"><h4>触达 ↑ 概率（年内先涨到）</h4>${pm.up.map((m) => row(m, BRAND)).join("") || "<span class='muted'>暂无活跃市场</span>"}</div>
      <div class="pm-group"><h4>跌破 ↓ 概率（年内先跌到）</h4>${pm.down.map((m) => row(m, BLUE)).join("") || "<span class='muted'>暂无活跃市场</span>"}</div>
      <div class="muted" style="grid-column:span 2;font-size:11px">数据：Polymarket「${esc(pm.title)}」，概率为实时成交价（已剔除 >99% 与 <1% 的已定价市场）。</div>`;
  }
}

/* ───────── 学堂 ───────── */
const GLOSSARY = [
  { t: "AHR999 指数", en: "AHR999", one: "一个把『定投成本』和『指数增长曲线』揉在一起的抄底/定投信号灯。", detail: "公式 =（现价 ÷ 200日定投成本）×（现价 ÷ 幂律拟合价）。第一项衡量你现在的定投成本相对过去 200 天高不高，第二项衡量价格相对长期增长趋势贵不贵。两者相乘越小，说明越便宜。", how: "<0.45 抄底区（历史级便宜）；0.45–1.2 定投区；1.2–5 观望区；>5 泡沫区。本站同时给出经典系数与用 2013 年后全历史重新拟合的『新拟合』版本。", src: "自算（Binance/BRK 日线）" },
  { t: "MVRV", en: "Market Value / Realized Value", one: "全体持币人的平均利润倍数，一眼看出全市场是赚是亏。", detail: "市值按现价算，已实现市值按每枚币『最后一次链上转手时的价格』算。两者之比就是全市场的平均浮盈倍数。", how: "<1 全网平均被套，历史大底区；1–1.5 偏低估；1.5–2.5 常态；>3.5 历史大顶区。STH-MVRV（短期持有者版本）更能反映新资金情绪。", src: "Bitview/BRK · 备源 Coin Metrics / BGeometrics" },
  { t: "200周均线", en: "200-Week WMA", one: "比特币的『生命线』，历史上从未被长期跌破。", detail: "对最近 200 周的收盘价做线性加权平均（越近的周权重越大）。因为比特币长期指数增长，这条线像一个缓慢上移的地板。", how: "价格贴线或跌破=历史级恐慌区（2015/2018/2022 底部都发生）；顶部阶段通常是这条线的 3–4 倍。", src: "自算（日线合成周线）" },
  { t: "幂律估值 / 幂律走廊", en: "Power Law", one: "比特币价格在双对数坐标里近似一条直线，这条直线就是『公允价』。", detail: "对全历史做 log10(P)=a+b·log10(天数) 回归。残差的分位数构成走廊：下轨是历史上 90% 时间跌不破的支撑带，上轨是过热压力带。", how: "价格贴下轨=长期视角的便宜区；贴上轨=过热区。本站展示公允/支撑/压力三条线与当前位置百分比。", src: "自算（BRK 日线全历史 OLS）" },
  { t: "均衡价格", en: "Balanced Price", one: "全网平均成本减去热钱成本，一条极深的底部线。", detail: "均衡价格 = 已实现价格（全网平均成本）− 转移价格（近一年活跃筹码的成本）。它近似代表『老筹码平均盈利被热钱成本抵消后』的剩余价值。", how: "历史上价格极少跌破它；触及往往是数年一遇的深度低估窗口。", src: "BGeometrics（四域名容灾）" },
  { t: "已实现价格", en: "Realized Price", one: "全体持币人的平均链上成本。", detail: "把每枚比特币按它最后一次转手的价格加总（已实现市值），除以流通量。相当于全市场的『持仓成本线』。", how: "熊市后期价格常在其下方徘徊（平均人都被套）；牛市它变成动态支撑。", src: "Bitview/BRK" },
  { t: "真实市场均值", en: "True Market Mean", one: "剔除了『几乎零成本老币』干扰后的更真实的市场成本。", detail: "早年挖出的币成本趋近于零，会显著拉低已实现价格。真实市场均值用统计方法剔除这些失真。", how: "熊底附近价格通常围绕它上下；跌破过深=投降式抛售尾声。", src: "Bitview/BRK" },
  { t: "STH / LTH（短/长期持有者）", en: "Short/Long-Term Holder", one: "以 155 天为界的两类人：新资金 vs 老资金。", detail: "STH=持有不足 155 天的币，代表最新入场的资金；LTH=超过 155 天，代表信念较强、不易卖出的筹码。", how: "STH 成本线是牛市回调的经典支撑；LTH 亏损供应飙升=LTH 也在被套，历史上都对应底部区域。", src: "Bitview/BRK" },
  { t: "UTXO 中位成本（C50）", en: "Median Cost Basis", one: "把每一笔未花费的币按成本排序，正中间那个价格。", detail: "比平均数更抗极值。它回答『一半的筹码成本在哪个价位之下』。", how: "价格接近 C50 时，全市场中位数参与者处于盈亏平衡，历史上常是心理与实际的强支撑/阻力。", src: "Bitview/BRK" },
  { t: "200日定投成本", en: "200-Day DCA Cost", one: "每天固定买一点、连买 200 天的平均成本。", detail: "用调和平均计算，更贴近真实定投摊薄成本。", how: "现价 < 该线 = 定投党整体被套，历史上是很好的分批建仓窗口。", src: "自算（Binance/BRK 日线）" },
  { t: "SOPR", en: "Spent Output Profit Ratio", one: "今天花出去的币，平均是赚着卖还是亏着卖。", detail: "花费的币的现价 ÷ 它们上次转手的价格。>1 获利了结，<1 割肉离场。", how: "牛市中回踩 1.0 常是买点；熊市中 SOPR 长期 <1 后的回升，常标志抛压衰竭。", src: "BGeometrics · 备源 BRK 块级" },
  { t: "Puell 乘数", en: "Puell Multiple", one: "矿工今天赚的是不是平时的好几倍（或饿肚子）。", detail: "矿工日收入 ÷ 365 日均收入。矿工收入是市场的刚性供给来源，极端偏离往往预示拐点。", how: "<0.5 矿工极度困难（常与底部重合）；>4 矿工日进斗金（顶部区特征）。", src: "Bitview/BRK" },
  { t: "Reserve Risk", en: "Reserve Risk", one: "继续持币的机会成本划不划算。", detail: "累积币日毁灭与已实现市值的比值，衡量长期持有者『惜售』程度。", how: "数值越低=大家越不肯卖=持有回报前景越好（绿色积累区）；快速抬升=筹码在派发。", src: "Bitview/BRK" },
  { t: "NUPL / LTH-NUPL", en: "Net Unrealized Profit/Loss", one: "全市场（或长期持有者）账面浮盈占比。", detail: "（市值 − 已实现市值）÷ 市值。NUPL 站在 0 之上全网整体盈利，之下整体亏损。", how: "<0 投降区（底部）；0–0.25 乐观；>0.75 泡沫区。LTH 版本对顶部更敏感。", src: "Bitview/BRK" },
  { t: "盈利供应占比", en: "Supply in Profit", one: "当前价格下，有多少比例的筹码是赚钱的。", detail: "按每枚币的成本对比现价统计。", how: "<50% 满街套牢盘（底部特征）；>95% 几乎人人赚钱（顶部特征）。", src: "Bitview/BRK" },
  { t: "URPD 筹码分布", en: "URPD", one: "把全网筹码按买入成本画成一张『兵力部署图』。", detail: "按成本把所有 UTXO 分桶统计。柱子高的价格区间=大量筹码的成本区。", how: "现价下方的高柱是支撑（持有者不愿亏本卖），上方高柱是解套抛压区。", src: "Bitview/BRK" },
  { t: "恐惧贪婪指数", en: "Fear & Greed Index", one: "市场情绪温度计：0 极度恐惧，100 极度贪婪。", detail: "由波动率(25%)、社交媒体(15%)、 survey(15%)、市占率(10%)、趋势(10%) 等合成。", how: "『别人恐惧我贪婪』：<25 极度恐惧历史上常是长期买点，>75 极度贪婪要管住手。", src: "Alternative.me" },
  { t: "资金费率", en: "Funding Rate", one: "永续合约里多空双方每 8 小时的『过路费』。", detail: "费率为正：多头付给空头（多头更拥挤）；为负：空头付费。它反映杠杆资金的倾向。", how: "年化 = 8h 费率 × 1095。持续 >30% 年化=杠杆过热易插针；深负=空头拥挤，易轧空。", src: "OKX" },
  { t: "稳定币市值", en: "Stablecoin Supply", one: "场外『子弹』总量：USDT+USDC 的发行量。", detail: "稳定币增发意味着新法币流入加密市场；赎回/市值下降代表资金离场。", how: "30 天变化是最直观的增量指标。持续正增长是大级别行情的燃料。", src: "DefiLlama" },
  { t: "Coinbase 溢价", en: "Coinbase Premium", one: "美国合规大所相对币安的价差，衡量美盘买气。", detail: "机构与美股散户主要在 Coinbase 成交，其溢价代表美元主动买盘强度（近似口径：Coinbase vs Binance 现货）。", how: "持续正溢价=美盘吸筹；持续负溢价=美盘抛压。", src: "Coinbase · Binance" },
  { t: "减半", en: "Halving", one: "每 21 万块（约 4 年），矿工的新币奖励腰斩，供给通胀减半。", detail: "区块奖励 3.125 → 1.5625 BTC（下一次）。历史上减半常被视作周期起点，顶点多出现在减半后 12–18 个月。", how: "关注周期进度条与倒计时；减半前后的供给冲击叠加情绪，是周期叙事核心。", src: "mempool.space" },
  { t: "关机币价", en: "Shutdown Price", one: "币价跌到多少，矿工挖一枚亏一枚，只能关机。", detail: "关机价 = 日电费 ÷ 日产币量，取决于矿机能效比（J/TH）与电价（$/kWh）。", how: "本站给出 4×3 种场景矩阵。大规模『关机潮』会压低难度，随后利于存活矿工——历史上关机潮多出现在周期底部。", src: "自算（mempool 算力+奖励数据）" },
  { t: "难度与算力", en: "Difficulty & Hashrate", one: "全网挖矿竞争强度与机器总规模。", detail: "难度每 2016 块自动调整以维持 10 分钟出块；算力是矿工投入的机器规模。", how: "两者长期新高=矿工用真金白银投票看好；骤降=矿工投降。", src: "mempool.space" },
  { t: "Polymarket 概率", en: "Prediction Market", one: "真金白银押出来的概率，比嘴上的预测更诚实。", detail: "Polymarket 用 USDC 结算的预测市场，价格即市场对事件概率的共识。", how: "对比各价位触达概率与你自己判断的偏差，可以校准预期。注意预测市场也有流动性与偏差。", src: "Polymarket" },
  { t: "Pi Cycle 顶部", en: "Pi Cycle Top", one: "111日均线×2 追上 350日均线×2 时，历史上都撞上周期大顶。", detail: "短期均线×2 的快速上穿长期均线×2，代表短期价格过热到极端。", how: "两线相距 %（本站给出）>40% 安全；接近 0–15% 进入历史顶部警戒区。", src: "自算" },
  { t: "红涨绿跌", en: "Color Convention", one: "本站遵循国内行情习惯：红色=上涨/风险偏高，绿色=下跌/机会偏高。", detail: "与国际市场（绿涨红跌）相反，初次使用请注意区分。", how: "在估值区间里，绿色=便宜/积累区，红色=贵/派发区，与涨跌色一致。", src: "—" },
  { t: "现货 ETF 净流入", en: "US Spot Bitcoin ETF Net Flow", one: "传统资金进入比特币的主干道，每天看一眼就知道机构在买还是在卖。", detail: "2024 年 1 月 11 日美国批准现货比特币 ETF 后，贝莱德 IBIT、富达 FBTC 等基金每天公布申购/赎回。净流入=申购多于赎回，意味着这些基金要真的去市场上买币；净流出则相反。GBTC（灰度）因高费率长期净赎回，需与新产品分开看。", how: "单日噪音大，重点看 7 日/30 日累计：月度级别持续净流入是牛市最硬的资金面证据；连续大幅净流出常伴随回调。上市以来累计额代表传统资本的总敞口。", src: "Farside Investors（经渲染通道，服务端 6 小时缓存）" },
  { t: "MVRV Z-Score", en: "MVRV Z-Score", one: "给 MVRV 加上『统计显著性』的顶部/底部仪表盘。", detail: "=（市值 − 已实现市值）÷ 市值标准差。普通 MVRV 只看浮盈倍数，Z-Score 进一步衡量这个浮盈相对整个历史有多『反常』，能把 2017 和 2021 这样体量完全不同的周期放在同一把尺子上比较。", how: "≤0.1 历史大底区（2015/2018/2022 底部都到过）；≥6 历史顶部区（2017/2021 顶）。本站同时给出当前值在 2013 年以来数据中的百分位，更直观。注：不同数据源起始年份不同会导致数值略有差异，看趋势与分位比看绝对值更有意义。", src: "自算（Bitview/BRK 市值与已实现市值）" },
  { t: "HODL Waves / LTH 供应占比", en: "HODL Waves", one: "把全网筹码按『最后一次移动的时间』分层，看大家拿得有多稳。", detail: "持有超过 155 天未移动的币归为长期持有者（LTH）。他们的占比升高，说明筹码在沉淀（囤币）；骤降说明老币在向新资金换手（派发）。", how: "熊底和牛市前夜 LTH 占比持续升高（老币不卖）；牛市后期占比快速下降（老币高位出货给新资金）。配合价格判断派发阶段非常直观。", src: "Bitview/BRK" },
  { t: "休眠指数", en: "Dormancy", one: "衡量『沉睡的老币』有没有苏醒换手。", detail: "基于币天销毁（CDD）的归一化指标：一枚持有了 100 天的币被转走，销毁 100 币天。休眠指数把销毁量除以供应量，让不同时期可比。", how: "飙升=高币龄筹码大规模移动，历史上多与顶部派发、恐慌抛售同时出现；长期低迷=市场惜售囤币。配合 HODL Waves 一起看。", src: "Bitview/BRK（1 周平滑）" },
  { t: "Hash Ribbons 算力均线", en: "Hash Ribbons", one: "用矿工的『生死』反着买：矿工投降结束后，往往是最好的买点之一。", detail: "算力 30 日均线与 60 日均线的交叉。矿机大规模关机（如减半后效率淘汰、币价暴跌）会使 30 日线下穿 60 日线（死叉）；矿工重新开机则金叉。", how: "死叉=矿工投降期（常与价格底部重叠）；金叉=投降结束、算力恢复，历史上金叉后的定投窗口回报突出。注意：减半后的机械性关机也会触发死叉，需与币价环境结合判断。", src: "自算（mempool.space 日均算力）" },
  { t: "网络活跃度", en: "Active Addresses & Transactions", one: "比特币的『日活用户』和『订单量』，链上的基本面。", detail: "每日活跃地址数与链上交易笔数（Coin Metrics 社区版）。剔除中心化交易所的内部买卖，直接反映链上真实使用强度。", how: "长期增长=采用扩大（基本面支撑价格）；价格新高而活跃度平平=上涨靠情绪与杠杆，需警惕背离。短期受 Ordinals/铭文等活动影响会脉冲式波动，看趋势即可。", src: "Coin Metrics 社区版" },
];
function renderGlossary() {
  $("#glossary").innerHTML = GLOSSARY.map((g, i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(g.t)} <span class="muted" style="font-weight:400;font-size:11.5px">${esc(g.en)}</span><span class="chev">▼</span></summary>
    <div class="body"><p class="one">💡 ${esc(g.one)}</p><p>${esc(g.detail)}</p><p><b>怎么用：</b>${esc(g.how)}</p><p class="meta">数据源：${esc(g.src)}</p></div></details>`).join("");
}

/* ───────── 数据源健康 ───────── */
function renderHealth(h) {
  state.health = h;
  const dot = $("#healthDot");
  dot.className = "health-dot " + (h.allCriticalOk && h.okCount >= h.total - 2 ? "ok" : h.allCriticalOk ? "warn" : "bad");
  dot.title = `数据源 ${h.okCount}/${h.total} 在线`;
  $("#healthTable").innerHTML = `<table><thead><tr><th>状态</th><th>数据源</th><th>角色</th><th>延迟</th></tr></thead><tbody>
    ${h.rows.map((r) => `<tr><td><span class="status ${r.ok ? "ok" : "bad"}"><i></i>${r.ok ? "在线" : "故障"}</span></td><td>${esc(r.label)}</td><td>${r.tier === 1 ? "核心" : r.tier === 2 ? "辅助" : "深度备源"}</td><td>${r.ok ? r.ms + " ms" : esc(r.error || "—")}</td></tr>`).join("")}
  </tbody></table>`;
}

/* ───────── 主流程 ───────── */
async function loadOverview() {
  const { data: ov, stale, from } = await getJSON("overview", "/api/overview");
  state.overview = ov;
  if (stale) updateStaleBanner();
  renderHero(ov);
}
async function loadRest() {
  const jobs = [
    getJSON("history", "/api/history", { store: false }).then(({ data }) => { state.history = data; refreshVisibleCharts(); renderLadder(); renderValuation(); }),
    getJSON("onchain", "/api/onchain").then(({ data }) => { state.onchain = data; refreshVisibleCharts(); renderValuation(); renderLadder(); renderOnchainCards(); renderQuickStrip(); renderComposite(); }),
    getJSON("mining", "/api/mining").then(({ data }) => { state.mining = data; refreshVisibleCharts(); renderMining(); }),
    getJSON("etf", "/api/etf", { store: false }).then(({ data }) => { state.etf = data; refreshVisibleCharts(); renderEtf(); renderQuickStrip(); }),
    getJSON("sentiment", "/api/sentiment").then(({ data }) => { state.sentiment = data; refreshVisibleCharts(); renderSentiment(); renderQuickStrip(); }),
  ];
  await Promise.allSettled(jobs);
  updateStaleBanner();
}
async function loadHealth() {
  try { const { data } = await getJSON("health", "/api/health", { store: false }); renderHealth(data); }
  catch { const dot = $("#healthDot"); dot.className = "health-dot bad"; dot.title = "健康检查失败"; }
}
function bindRefresh() {
  const btn = $("#refreshBtn");
  btn.addEventListener("click", async () => {
    btn.classList.add("spin");
    await Promise.allSettled([loadOverview(), loadRest(), loadHealth()]);
    btn.classList.remove("spin");
  });
  setInterval(() => {
    const left = Math.max(0, 60 - ((Date.now() / 1000) % 60) | 0);
    $("#refreshIn").textContent = left + "s";
  }, 1000);
  setInterval(loadOverview, 60000);
}

(async function init() {
  window.__btc = state; // 调试
  renderGlossary();
  bindRefresh();
  $("#price").classList.add("skl-block");
  try { await loadOverview(); } catch (e) { $("#price").outerHTML = '<span id="price" class="price-big">数据加载失败</span>'; console.error(e); }
  loadHealth();
  loadRest();
})();
