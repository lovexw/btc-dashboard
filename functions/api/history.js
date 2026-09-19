// GET /api/history — 长周期计算序列（价格、均线、幂律走廊、AHR999、Pi Cycle）
import { json } from "../lib/util.js";
import { getMarket } from "../lib/market.js";

export async function onRequest(ctx) {
  const { data: m, cache } = await getMarket(ctx);
  return json(
    {
      ts: Date.now(),
      cache,
      dates: m.dates,
      series: m.series,
      stats: m.stats,
    },
    { ttl: 3600 }
  );
}
