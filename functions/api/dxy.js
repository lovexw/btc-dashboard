// GET /api/dxy — 美元指数（DXY）
// 主源：Yahoo Finance ICE 美元指数（DX-Y.NYB，日线）
// 备源：欧央行参考汇率按官方权重自算（DXY = 50.14348112 × EUR^-0.576 × JPY^0.136 × GBP^-0.119 × CAD^0.091 × SEK^0.042 × CHF^0.036，其中 EUR/GBP 为 USD 计价取倒数）
import { json, cachedJSON, firstOk, fetchJSON } from "../lib/util.js";

const PAIR = "EUR,JPY,GBP,CAD,SEK,CHF";

export async function onRequest(ctx) {
  try {
    const { data, cache } = await cachedJSON(ctx, "dxy-v1", 1800, buildDxy);
    return json({ ts: Date.now(), cache, ...data }, { ttl: 900 });
  } catch (e) {
    return json({ ts: Date.now(), latest: null, error: String(e.message || e).slice(0, 300) }, { ttl: 300 });
  }
}

function pct(a, b) {
  return a != null && b ? +(((a - b) / b) * 100).toFixed(2) : null;
}

function summarize(series, source) {
  const n = series.length;
  const last = series[n - 1], prev = series[n - 2], ago30 = series[Math.max(0, n - 31)];
  const closes = series.map((p) => p[1]);
  const maN = (w) => (closes.length >= w ? +(closes.slice(-w).reduce((a, v) => a + v, 0) / w).toFixed(3) : null);
  const ma200 = maN(200), ma50 = maN(50);
  return {
    source,
    latest: {
      value: last[1],
      date: new Date(last[0]).toISOString().slice(0, 10),
      changePct1d: pct(last[1], prev ? prev[1] : null),
      changePct30d: pct(last[1], ago30 ? ago30[1] : null),
    },
    ma50,
    ma200,
    strong: ma200 != null ? last[1] > ma200 : null, // 高于 200 日均值 = 美元趋势偏强
    series,
  };
}

async function buildDxy() {
  const r = await firstOk([
    { name: "yahoo(DX-Y.NYB)", run: async () => {
      const j = await fetchJSON("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=2y&interval=1d", { timeout: 15000 });
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (!res) throw new Error("yahoo empty");
      const ts = res.timestamp || [], cl = (res.indicators.quote[0].close || []);
      const series = [];
      for (let i = 0; i < ts.length; i++) if (cl[i] != null) series.push([ts[i] * 1000, +cl[i].toFixed(3)]);
      if (series.length < 60) throw new Error("yahoo too few");
      return summarize(series, "Yahoo Finance (ICE 美元指数)");
    } },
    { name: "frankfurter(ECB自算)", run: async () => {
      const start = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
      const j = await fetchJSON(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${PAIR}`, { timeout: 15000 });
      const rates = j.rates || {};
      const series = Object.keys(rates).sort().map((d) => {
        const r2 = rates[d];
        if (!r2.EUR || !r2.JPY || !r2.GBP || !r2.CAD || !r2.SEK || !r2.CHF) return null;
        const dxy = 50.14348112 * Math.pow(1 / r2.EUR, -0.576) * Math.pow(r2.JPY, 0.136) * Math.pow(1 / r2.GBP, -0.119) * Math.pow(r2.CAD, 0.091) * Math.pow(r2.SEK, 0.042) * Math.pow(r2.CHF, 0.036);
        return [new Date(d + "T00:00:00Z").getTime(), +dxy.toFixed(3)];
      }).filter(Boolean);
      if (series.length < 60) throw new Error("ecb too few");
      return summarize(series, "欧央行汇率自算（ECB）");
    } },
  ]);
  return r.value;
}
