// GET /api/overview — 首页概览：价格、涨跌、综合估值、减半、资金费率、稳定币、预测市场
import { json, cachedJSON, withTimeout } from "../lib/util.js";
import { getMarket, compositeScore, scoreZone } from "../lib/market.js";
import * as S from "../lib/sources.js";

export async function onRequest(ctx) {
  const { data: m, cache } = await getMarket(ctx);
  const L = m.dates.length - 1;

  const r = await withTimeout([
    { k: "spot", p: S.priceSpot() },
    { k: "fgi", p: S.fgi(3) },
    { k: "funding", p: S.okxFunding() },
    { k: "tip", p: S.tipHeight() },
    { k: "stables", p: stablecoinsSummary(ctx) },
    { k: "pm", p: cachedJSON(ctx, "pm-v2", 600, S.polymarket2026).then((x) => x.data) },
    { k: "cbSpot", p: fetchRetry("https://api.exchange.coinbase.com/products/BTC-USD/ticker") },
  ]);

  const spot = r.spot.ok ? r.spot.value : null;
  const price = spot ? spot.usd : m.stats.last;
  const supply = r.tip.ok ? S.btcSupply(r.tip.value.height) : 19900000;
  const fgiNow = r.fgi.ok ? r.fgi.value[r.fgi.value.length - 1] : null;

  let halving = null;
  if (r.tip.ok) {
    const h = r.tip.value.height;
    const next = Math.ceil((h + 1) / 210000) * 210000;
    const epoch = Math.floor(h / 210000);
    const rewardNow = 50 / 2 ** epoch;
    const blocksLeft = next - h;
    const etaDays = Math.round((blocksLeft * 9.7) / 60 / 24); // 平均 ~9.7 分钟/块
    const etaDate = new Date(Date.now() + etaDays * 86400000).toISOString().slice(0, 10);
    halving = { tipHeight: h, nextHalvingHeight: next, blocksLeft, etaDays, etaDate, currentReward: rewardNow, nextReward: rewardNow / 2, epochProgressPct: +((((h % 210000) / 210000) * 100)).toFixed(2) };
  }

  const premiumPct = r.cbSpot.ok && spot ? +((((+r.cbSpot.value.price) - spot.usd) / spot.usd) * 100).toFixed(3) : null;

  const comp = compositeScore({
    mvrv: null, // MVRV 由 /api/onchain 提供，前端合并后重算分数条
    wmaRatio: m.stats.ratios.wma200,
    plRatio: m.stats.ratios.plFair,
    puell: null,
    lthNupl: null,
    sipPct: null,
    fgi: fgiNow ? fgiNow.v : null,
  });

  const payload = {
    ts: Date.now(),
    price: {
      usd: price,
      source: spot ? spot.source : `日线收盘(${m.stats.priceSource})`,
      changePct24h: spot ? +spot.changePct24h.toFixed(2) : m.stats.changes.d1,
      high24h: spot ? spot.high : null,
      low24h: spot ? spot.low : null,
    },
    changes: m.stats.changes,
    ath: m.stats.ath,
    marketCap: price * supply,
    supply,
    valuation: {
      ahr999: m.stats.latest.ahr999,
      ahrNew: m.stats.latest.ahrNew,
      fitRatio: m.stats.latest.fitRatio,
      wma200: m.stats.latest.wma200,
      wmaRatio: m.stats.ratios.wma200,
      dca200: m.stats.latest.dca200,
      dcaRatio: +(price / m.stats.latest.dca200).toFixed(4),
      plFair: m.stats.latest.plFair,
      plSupport: m.stats.latest.plSupport,
      plResist: m.stats.latest.plResist,
      plRatio: m.stats.ratios.plFair,
      pi111: m.stats.latest.pi111,
      pi350: m.stats.latest.pi350,
      piGapPct: m.stats.latest.piGapPct,
      ma250: m.stats.latest.ma250,
      ma850: m.stats.latest.ma850,
    },
    fgi: fgiNow ? { value: fgiNow.v, label: fgiNow.label } : null,
    funding: r.funding.ok ? { rate: r.funding.value.rate, aprPct: +(r.funding.value.rate * 3 * 365 * 100).toFixed(2), nextTs: r.funding.value.nextTs, source: "okx" } : null,
    coinbasePremiumPct: premiumPct,
    halving,
    stablecoins: r.stables.ok ? r.stables.value : null,
    polymarket: r.pm.ok ? r.pm.value : null,
    partialScore: comp, // 前端拿到 onchain 数据后用完整维度重算
    meta: {
      cache,
      lastCloseDate: m.stats.lastDate,
      priceHistorySource: m.stats.priceSource,
      sources: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ok: v.ok, ms: v.ms, error: v.error || null }])),
    },
  };
  return json(payload, { ttl: 60 });
}

async function fetchRetry(url, timeout = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort("timeout"), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "btc-dashboard/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function stablecoinsSummary(ctx) {
  return (await cachedJSON(ctx, "stables-sum-v2", 3600, async () => {
    const now = Date.now();
    const build = async (id) => {
      const rows = await S.stablecoinSeries(id);
      const last = rows[rows.length - 1];
      const at = (daysAgo) => {
        const target = now - daysAgo * 86400000;
        let best = rows[0];
        for (const x of rows) if (Math.abs(x.t - target) < Math.abs(best.t - target)) best = x;
        return best.v;
      };
      return { v: last.v, d30Pct: +(((last.v - at(30)) / at(30)) * 100).toFixed(2), d90Pct: +(((last.v - at(90)) / at(90)) * 100).toFixed(2) };
    };
    const [usdt, usdc] = await Promise.all([build(S.STABLE_IDS.usdt), build(S.STABLE_IDS.usdc)]);
    return { usdt, usdc };
  })).data;
}
