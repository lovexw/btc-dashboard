// GET /api/onchain — 链上指标：MVRV/NUPL/成本线/SOPR/Puell/Reserve Risk/均衡价格/筹码分布
// 主源 bitview.space(BRK)，备源 BGeometrics 四镜像、Coin Metrics
import { json, cachedJSON, withTimeout, fetchJSON } from "../lib/util.js";
import { brkSeries, bgeoSeries, tipHeight, cmMvrvLast } from "../lib/sources.js";

const FULL_START = "2013-01-01";
const Y4_START = new Date(Date.now() - 4 * 365 * 86400000).toISOString().slice(0, 10);

export async function onRequest(ctx) {
  const { data, cache } = await cachedJSON(ctx, "onchain-v2", 6 * 3600, buildOnchain);
  return json({ ts: Date.now(), cache, ...data }, { ttl: 3600 });
}

async function buildOnchain() {
  const r = await withTimeout([
    // 估值类（全历史）
    { k: "mvrv", p: brkSeries("mvrv", { start: FULL_START }) },
    { k: "nupl", p: brkSeries("nupl", { start: FULL_START }) },
    { k: "lthNupl", p: brkSeries("lth_nupl", { start: FULL_START }) },
    { k: "puell", p: brkSeries("puell_multiple", { start: FULL_START }) },
    { k: "reserveRisk", p: brkSeries("reserve_risk", { start: FULL_START }) },
    // 成本类（近4年）
    { k: "realizedPrice", p: brkSeries("realized_price", { start: Y4_START }) },
    { k: "tmm", p: brkSeries("true_market_mean", { start: Y4_START }) },
    { k: "sthRealizedPrice", p: brkSeries("sth_realized_price", { start: Y4_START }) },
    { k: "sthMvrv", p: brkSeries("sth_mvrv", { start: Y4_START }) },
    { k: "utxoC50", p: brkSeries("cost_basis_per_coin_pct50", { start: Y4_START }) },
    { k: "sipPct", p: brkSeries("supply_in_profit_share", { start: Y4_START }) },
    { k: "lthLossBtc", p: brkSeries("lth_supply_in_loss", { start: Y4_START }) },
    // BGeometrics 备源/交叉源
    { k: "sopr", p: bgeoSeries("sopr") },
    { k: "balanced", p: bgeoSeries("balanced-price") },
    { k: "transfer", p: bgeoSeries("transfer-price") },
    { k: "urpd", p: fetchJSON("https://bitview.space/api/urpd/all", { timeout: 25000 }) },
    { k: "tip", p: tipHeight() },
  ]);

  const t = (x) => (x.ok ? x.value : null);
  const mvrv = t(r.mvrv);
  const axisFull = mvrv ? mvrv.dates : null;
  const axis4 = r.realizedPrice.ok ? r.realizedPrice.value.dates : null;

  // SOPR：BGeometrics 全历史 → BRK 周均(sopr_1w) → BRK 块级(取第 1 列)
  let sopr = null;
  if (r.sopr.ok) {
    const s = r.sopr.value;
    const idx = s.dates.findIndex((d) => d >= FULL_START);
    sopr = { dates: s.dates.slice(idx), values: s.values.slice(idx), source: s.source };
  } else {
    try {
      const s = await brkSeries("sopr_1w", { start: FULL_START });
      sopr = { dates: s.dates, values: s.values, source: "bitview.space(BRK·sopr_1w)" };
    } catch {
      if (r.tip.ok) {
        try {
          const h = r.tip.value.height;
          const s = await brkSeries("sopr", { index: "height", start: h - 40 });
          sopr = { dates: s.dates, values: s.values.map((v) => (Array.isArray(v) ? +v[0] : +v)), source: "bitview.space(BRK·块级)" };
        } catch {}
      }
    }
  }

  // 均衡价格：优先 BGeometrics，失败用 realized - transfer 近似
  let balanced = null;
  if (r.balanced.ok) balanced = { dates: r.balanced.value.dates, values: r.balanced.value.values, source: r.balanced.value.source };
  else if (r.realizedPrice.ok && r.transfer.ok) {
    const m = new Map(r.transfer.value.values.map((v, i) => [r.transfer.value.dates[i], v]));
    balanced = {
      dates: axis4,
      values: r.realizedPrice.value.values.map((v, i) => (m.has(axis4[i]) ? +(v - m.get(axis4[i])).toFixed(1) : null)),
      source: "自算(realized-transfer)",
    };
  }

  // URPD 筹码分布聚合为价格带
  let urpd = null;
  if (r.urpd.ok && r.urpd.value && Array.isArray(r.urpd.value.buckets)) {
    urpd = aggregateUrpd(r.urpd.value);
  }

  // MVRV 备源：Coin Metrics
  let mvrvBackup = null;
  if (!mvrv) {
    try {
      mvrvBackup = await cmMvrvLast();
    } catch {}
  }

  const mk = (x, axis) => {
    if (!x) return null;
    if (!axis) return { dates: x.dates, values: x.values };
    // 对齐到主日期轴
    const m = new Map(x.dates.map((d, i) => [d, x.values[i]]));
    return { dates: axis, values: axis.map((d) => (m.has(d) ? +(+m.get(d)).toFixed(4) : null)) };
  };

  const srcOf = (x, fallback) => (x ? x.source || fallback || "bitview.space(BRK)" : null);

  const latest = {};
  const pick = (x) => (x && x.values.length ? +x.values[x.values.length - 1] : null);
  if (mvrv) { latest.mvrv = pick(mvrv); latest.mvrvDate = mvrv.dates[mvrv.dates.length - 1]; }
  if (mvrvBackup) { latest.mvrv = mvrvBackup.mvrv; latest.mvrvDate = mvrvBackup.date; }
  if (r.nupl.ok) latest.nupl = pick(r.nupl.value);
  if (r.lthNupl.ok) latest.lthNupl = pick(r.lthNupl.value);
  if (r.puell.ok) latest.puell = pick(r.puell.value);
  if (r.reserveRisk.ok) latest.reserveRisk = pick(r.reserveRisk.value);
  if (r.realizedPrice.ok) latest.realizedPrice = pick(r.realizedPrice.value);
  if (r.tmm.ok) latest.tmm = pick(r.tmm.value);
  if (r.sthRealizedPrice.ok) latest.sthRealizedPrice = pick(r.sthRealizedPrice.value);
  if (r.sthMvrv.ok) latest.sthMvrv = pick(r.sthMvrv.value);
  if (r.utxoC50.ok) latest.utxoC50 = pick(r.utxoC50.value);
  if (r.sipPct.ok) latest.sipPct = pick(r.sipPct.value);
  if (r.lthLossBtc.ok) latest.lthLossBtc = pick(r.lthLossBtc.value);
  if (sopr) latest.sopr = pick(sopr);
  if (balanced) latest.balancedPrice = pick(balanced);
  if (r.transfer.ok) latest.transferPrice = pick(r.transfer.value);

  return {
    latest,
    axes: { full: axisFull, y4: axis4 },
    series: {
      mvrv: mk(mvrv, axisFull) && { dates: axisFull, values: mvrv.values },
      nupl: r.nupl.ok ? { dates: axisFull, values: r.nupl.value.values } : null,
      lthNupl: r.lthNupl.ok ? { dates: axisFull, values: r.lthNupl.value.values } : null,
      puell: r.puell.ok ? { dates: axisFull, values: r.puell.value.values } : null,
      reserveRisk: r.reserveRisk.ok ? { dates: axisFull, values: r.reserveRisk.value.values } : null,
      sopr,
      realizedPrice: r.realizedPrice.ok ? { dates: axis4, values: r.realizedPrice.value.values } : null,
      tmm: r.tmm.ok ? { dates: axis4, values: r.tmm.value.values } : null,
      sthRealizedPrice: r.sthRealizedPrice.ok ? { dates: axis4, values: r.sthRealizedPrice.value.values } : null,
      sthMvrv: r.sthMvrv.ok ? { dates: axis4, values: r.sthMvrv.value.values } : null,
      utxoC50: r.utxoC50.ok ? { dates: axis4, values: r.utxoC50.value.values } : null,
      sipPct: r.sipPct.ok ? { dates: axis4, values: r.sipPct.value.values } : null,
      lthLossBtc: r.lthLossBtc.ok ? { dates: axis4, values: r.lthLossBtc.value.values } : null,
      balancedPrice: balanced,
      transferPrice: r.transfer.ok ? { dates: r.transfer.value.dates, values: r.transfer.value.values } : null,
    },
    urpd,
    sources: {
      mvrv: { ok: r.mvrv.ok || !!mvrvBackup, src: mvrv ? "BRK" : mvrvBackup ? "CoinMetrics" : null },
      sopr: { ok: !!sopr, src: sopr ? sopr.source : null },
      balanced: { ok: !!balanced, src: balanced ? balanced.source : null },
      urpd: { ok: !!urpd, src: urpd ? "bitview.space(BRK)" : null },
      attempts: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ok: v.ok, ms: v.ms, error: v.error || null }])),
    },
  };
}

function aggregateUrpd(u) {
  const edges = [0, 1000, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 120000, 150000, 200000, 300000, Infinity];
  const fmt = (a, b) => (b === Infinity ? `$${fmtN(a)}+` : a === 0 ? `<$${fmtN(b)}` : `$${fmtN(a)}–${fmtN(b)}`);
  const fmtN = (x) => (x >= 1000 ? (x / 1000).toFixed(x % 1000 ? 1 : 0) + "k" : x);
  const bands = edges.slice(0, -1).map((a, i) => ({ floor: a, ceil: edges[i + 1], label: fmt(a, edges[i + 1]), supply: 0, rc: 0 }));
  let total = 0;
  for (const b of u.buckets) {
    const pf = b.price_floor;
    let bi = bands.findIndex((x) => pf >= x.floor && pf < x.ceil);
    if (bi < 0) bi = bands.length - 1;
    bands[bi].supply += b.supply || 0;
    bands[bi].rc += b.realized_cap || 0;
    total += b.supply || 0;
  }
  let cum = 0;
  const out = bands
    .map((b) => {
      const pct = total ? (b.supply / total) * 100 : 0;
      cum += pct;
      return { label: b.label, floor: b.floor, ceil: b.ceil === Infinity ? null : b.ceil, supplyBtc: +b.supply.toFixed(0), supplyPct: +pct.toFixed(2), cumPct: +cum.toFixed(2), avgCost: b.supply ? +(b.rc / b.supply).toFixed(0) : null };
    })
    .filter((b) => b.supplyPct > 0.005);
  // 中位成本
  let acc = 0,
    median = null;
  for (const b of out) {
    acc += b.supplyPct;
    if (median == null && acc >= 50) median = b.avgCost ?? b.floor;
  }
  return { date: u.date, close: u.close, totalSupply: u.total_supply, bands: out, medianCost: median };
}
