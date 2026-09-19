// ---------- 市场计算核心：均线 / 幂律 / AHR999 / 综合估值 ----------
import { priceHistoryFull } from "./sources.js";
import { cachedJSON } from "./util.js";

export const GENESIS_MS = Date.UTC(2009, 0, 3);

export async function getMarket(ctx) {
  return await cachedJSON(ctx, "market-v1", 1800, computeMarket);
}

function daysSinceGenesis(dateStr) {
  return (Date.parse(dateStr + "T00:00:00Z") - GENESIS_MS) / 86400000;
}

async function computeMarket() {
  const { dates, values, source } = await priceHistoryFull();
  const n = dates.length;
  const p = values.map((v) => +v);
  const d = dates.map(daysSinceGenesis);

  // ---- 简单移动平均 ----
  const sma = (w) => {
    const out = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += p[i];
      if (i >= w) sum -= p[i - w];
      if (i >= w - 1) out[i] = sum / w;
    }
    return out;
  };

  // ---- 200 日定投成本（调和平均）----
  const harmonic = (w) => {
    const out = new Array(n).fill(null);
    const q = [];
    let inv = 0;
    for (let i = 0; i < n; i++) {
      const x = 1 / p[i];
      q.push(x);
      inv += x;
      if (q.length > w) inv -= q.shift();
      if (i >= w - 1) out[i] = w / inv;
    }
    return out;
  };

  // ---- 200 周加权均线：按周重采样后线性加权，前向填充回日线 ----
  const wmaWeekly = (w = 200) => {
    const wi = [];
    for (let i = n - 1; i >= 0; i -= 7) wi.push(i);
    wi.reverse();
    const out = new Array(n).fill(null);
    const dq = [];
    let wsum = 0,
      dsum = 0;
    for (let k = 0; k < wi.length; k++) {
      const weight = k + 1;
      dq.push([weight, p[wi[k]]]);
      wsum += weight;
      dsum += weight * p[wi[k]];
      if (dq.length > w) {
        const [rw, rv] = dq.shift();
        wsum -= rw;
        dsum -= rw * rv;
      }
      if (k >= w - 1) {
        const val = dsum / wsum;
        const from = k === 0 ? 0 : wi[k - 1] + 1;
        for (let i = from; i <= wi[k]; i++) out[i] = val;
      }
    }
    return out;
  };

  // ---- 幂律拟合：log10(P) = a + b·log10(d)，d 为创世以来天数 ----
  let fitA = null,
    fitB = null,
    rSup = null,
    rRes = null;
  {
    const lx = [],
      ly = [];
    for (let i = 0; i < n; i++) {
      if (d[i] >= 200 && p[i] > 0.05) {
        lx.push(Math.log10(d[i]));
        ly.push(Math.log10(p[i]));
      }
    }
    const mx = lx.reduce((s, x) => s + x, 0) / lx.length;
    const my = ly.reduce((s, y) => s + y, 0) / ly.length;
    let sxy = 0,
      sxx = 0;
    for (let i = 0; i < lx.length; i++) {
      sxy += (lx[i] - mx) * (ly[i] - my);
      sxx += (lx[i] - mx) ** 2;
    }
    fitB = sxy / sxx;
    fitA = my - fitB * mx;
    const resid = lx.map((x, i) => ly[i] - (fitA + fitB * x)).sort((x, y) => x - y);
    rSup = resid[Math.floor(resid.length * 0.1)];
    rRes = resid[Math.floor(resid.length * 0.9)];
  }
  const pow10 = (x) => 10 ** x;
  const plFairAt = (dv) => (dv >= 200 ? pow10(fitA + fitB * Math.log10(dv)) : null);

  const plFair = d.map(plFairAt);
  const plSupport = d.map((dv) => (dv >= 200 ? plFairAt(dv) * pow10(rSup) : null));
  const plResist = d.map((dv) => (dv >= 200 ? plFairAt(dv) * pow10(rRes) : null));

  // ---- AHR999：经典系数 + 自拟合新系数 ----
  const c200 = harmonic(200);
  const fitClassicAt = (dv) => pow10(5.845 * Math.log10(dv) - 17.016);
  const ahr999 = new Array(n).fill(null);
  const ahrNew = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (c200[i] && d[i] >= 400) {
      const fc = fitClassicAt(d[i]);
      ahr999[i] = (p[i] / c200[i]) * (p[i] / fc);
      const fn = plFair[i];
      if (fn) ahrNew[i] = (p[i] / c200[i]) * (p[i] / fn);
    }
  }
  const L = n - 1;
  const fitRatio = plFair[L] && d[L] >= 400 ? plFair[L] / fitClassicAt(d[L]) : 1;

  // ---- 周期指标 ----
  const ma111 = sma(111).map((v) => (v == null ? null : v * 2));
  const ma350 = sma(350).map((v) => (v == null ? null : v * 2));
  const ma250 = sma(250);
  const ma850 = sma(850);
  const wma200 = wmaWeekly(200);
  const dca200 = c200;

  // ---- ATH 与涨跌幅 ----
  let athV = 0,
    athI = 0;
  for (let i = 0; i < n; i++)
    if (p[i] > athV) {
      athV = p[i];
      athI = i;
    }
  const chg = (back) => (L - back >= 0 ? +((p[L] / p[L - back] - 1) * 100).toFixed(2) : null);
  const stats = {
    last: +p[L].toFixed(2),
    lastDate: dates[L],
    ath: { value: +athV.toFixed(0), date: dates[athI], drawdownPct: +((p[L] / athV - 1) * 100).toFixed(2) },
    changes: { d1: chg(1), d7: chg(7), d30: chg(30), d90: chg(90), d365: chg(365) },
    ratios: {
      wma200: +(p[L] / wma200[L]).toFixed(4),
      plFair: +(p[L] / plFair[L]).toFixed(4),
      ma250: ma250[L] ? +(p[L] / ma250[L]).toFixed(4) : null,
    },
    latest: {
      wma200: +wma200[L].toFixed(0),
      dca200: +dca200[L].toFixed(0),
      ma250: ma250[L] ? +ma250[L].toFixed(0) : null,
      ma850: ma850[L] ? +ma850[L].toFixed(0) : null,
      plFair: +plFair[L].toFixed(0),
      plSupport: +plSupport[L].toFixed(0),
      plResist: +plResist[L].toFixed(0),
      ahr999: ahr999[L] ? +ahr999[L].toFixed(3) : null,
      ahrNew: ahrNew[L] ? +ahrNew[L].toFixed(3) : null,
      fitRatio: +fitRatio.toFixed(4),
      pi111: ma111[L] ? +ma111[L].toFixed(0) : null,
      pi350: ma350[L] ? +ma350[L].toFixed(0) : null,
      piGapPct: ma111[L] && ma350[L] ? +(((ma350[L] - ma111[L]) / ma350[L]) * 100).toFixed(2) : null,
    },
    fit: { a: +fitA.toFixed(4), b: +fitB.toFixed(4), rSup: +rSup.toFixed(4), rRes: +rRes.toFixed(4) },
    priceSource: source,
  };

  const R2 = (v) => (v == null ? null : +v.toFixed(2));
  const R4 = (v) => (v == null ? null : +v.toFixed(4));
  const roundAll = (arr, f) => arr.map((v) => (v == null ? null : +f(v)));

  return {
    dates,
    series: {
      price: roundAll(p, (v) => Math.round(v)),
      ma250: roundAll(ma250, Math.round),
      ma850: roundAll(ma850, Math.round),
      wma200: roundAll(wma200, Math.round),
      dca200: roundAll(dca200, Math.round),
      pi111: roundAll(ma111, Math.round),
      pi350: roundAll(ma350, Math.round),
      plFair: roundAll(plFair, Math.round),
      plSupport: roundAll(plSupport, Math.round),
      plResist: roundAll(plResist, Math.round),
      ahr999: roundAll(ahr999, R2),
      ahrNew: roundAll(ahrNew, R2),
    },
    stats,
  };
}

// ---------- 综合估值评分（0-100，冷→热） ----------
export function piecewise(x, pts) {
  if (x == null || !isFinite(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export function compositeScore(v) {
  const dims = [
    { key: "mvrv", label: "MVRV", w: 0.2, pts: [[0.5, 2], [0.8, 5], [1.0, 15], [1.5, 35], [2.5, 62], [3.2, 82], [4.2, 96]] },
    { key: "wmaRatio", label: "价格/200周线", w: 0.18, pts: [[0.7, 2], [0.95, 10], [1.2, 25], [2, 50], [3, 75], [4, 92], [5.5, 98]] },
    { key: "plRatio", label: "价格/幂律公允", w: 0.18, pts: [[0.35, 2], [0.6, 12], [0.8, 28], [1, 45], [1.5, 70], [2, 88], [2.6, 97]] },
    { key: "puell", label: "Puell 乘数", w: 0.12, pts: [[0.25, 5], [0.5, 15], [0.8, 32], [1.2, 52], [2, 72], [3.2, 88], [4.5, 97]] },
    { key: "lthNupl", label: "LTH-NUPL", w: 0.12, pts: [[-0.15, 2], [0, 10], [0.2, 30], [0.4, 50], [0.6, 70], [0.78, 86], [0.9, 96]] },
    { key: "sipPct", label: "盈利供应占比", w: 0.1, pts: [[40, 3], [55, 15], [70, 30], [85, 55], [95, 78], [99, 93]] },
    { key: "fgi", label: "恐惧贪婪指数", w: 0.1, pts: [[8, 3], [20, 15], [35, 32], [50, 48], [70, 70], [85, 88], [95, 96]] },
  ];
  let num = 0,
    den = 0;
  const out = dims.map((dm) => {
    const s = piecewise(v[dm.key], dm.pts);
    if (s != null) {
      num += s * dm.w;
      den += dm.w;
    }
    return { key: dm.key, label: dm.label, score: s == null ? null : Math.round(s), value: v[dm.key] };
  });
  return { score: den > 0 ? Math.round(num / den) : null, dims: out };
}

export function scoreZone(s) {
  if (s == null) return { label: "数据不足", cls: "z0" };
  if (s < 20) return { label: "深度低估", cls: "z1" };
  if (s < 40) return { label: "偏低估", cls: "z2" };
  if (s < 60) return { label: "中性", cls: "z3" };
  if (s < 80) return { label: "偏热", cls: "z4" };
  return { label: "过热", cls: "z5" };
}
