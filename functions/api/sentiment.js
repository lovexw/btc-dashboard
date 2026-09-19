// GET /api/sentiment — 情绪与资金：恐惧贪婪、资金费率、稳定币、Coinbase 溢价、预测市场
import { json, cachedJSON, withTimeout, fetchJSON } from "../lib/util.js";
import { fgi, okxFunding, okxFundingHistory, stablecoinSeries, STABLE_IDS, polymarket2026, priceSpot } from "../lib/sources.js";

export async function onRequest(ctx) {
  const { data, cache } = await cachedJSON(ctx, "sentiment-v2", 300, buildSentiment);
  return json({ ts: Date.now(), cache, ...data }, { ttl: 240 });
}

async function buildSentiment() {
  const r = await withTimeout([
    { k: "fgi", p: fgi(730) },
    { k: "fundingNow", p: okxFunding() },
    { k: "fundingHist", p: okxFundingHistory(90) },
    { k: "stables", p: stablecoinsCached() },
    { k: "pm", p: cachedJSON(undefined, "pm-v2", 600, polymarket2026).then((x) => x.data) },
    { k: "spot", p: priceSpot() },
    { k: "cbSpot", p: fetchJSON("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { timeout: 8000 }) },
  ]);
  const t = (k) => (r[k].ok ? r[k].value : null);

  const f = t("fgi");
  const spot = t("spot");
  const cb = t("cbSpot");

  return {
    fgi: f
      ? {
          now: f[f.length - 1].v,
          label: f[f.length - 1].label,
          prev: f[f.length - 2] ? f[f.length - 2].v : null,
          weekAgo: f[f.length - 8] ? f[f.length - 8].v : null,
          monthAgo: f[f.length - 30] ? f[f.length - 30].v : null,
          series: f.map((x) => [x.t, x.v]),
        }
      : null,
    funding: t("fundingNow")
      ? {
          rate: t("fundingNow").rate,
          aprPct: +(t("fundingNow").rate * 3 * 365 * 100).toFixed(2),
          nextTs: t("fundingNow").nextTs,
          series: (t("fundingHist") || []).map((x) => [x.t, x.r]),
          source: "okx",
        }
      : null,
    stablecoins: t("stables"),
    coinbasePremiumPct: spot && cb ? +((((+cb.price) - spot.usd) / spot.usd) * 100).toFixed(3) : null,
    polymarket: t("pm"),
    sources: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ok: v.ok, ms: v.ms, error: v.error || null }])),
  };
}

async function stablecoinsCached() {
  return (await cachedJSON(undefined, "stables-full-v2", 3600, async () => {
    const now = Date.now();
    const build = async (id) => {
      const rows = await stablecoinSeries(id);
      const last = rows[rows.length - 1];
      const at = (daysAgo) => {
        const target = now - daysAgo * 86400000;
        let best = rows[0];
        for (const x of rows) if (Math.abs(x.t - target) < Math.abs(best.t - target)) best = x;
        return best.v;
      };
      // 近 180 天按日取点
      const cut = now - 180 * 86400000;
      const recent = rows.filter((x) => x.t >= cut);
      const step = Math.max(1, Math.floor(recent.length / 180));
      const series = [];
      for (let i = 0; i < recent.length; i += step) series.push([recent[i].t, Math.round(recent[i].v / 1e8)]); // 单位：亿美元
      if (series[series.length - 1][0] !== last.t) series.push([last.t, Math.round(last.v / 1e8)]);
      return { now: last.v, d30Pct: +(((last.v - at(30)) / at(30)) * 100).toFixed(2), d90Pct: +(((last.v - at(90)) / at(90)) * 100).toFixed(2), series };
    };
    const [usdt, usdc] = await Promise.all([build(STABLE_IDS.usdt), build(STABLE_IDS.usdc)]);
    return { usdt, usdc, total: { now: usdt.now + usdc.now } };
  })).data;
}
