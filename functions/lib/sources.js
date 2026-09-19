// ---------- 上游数据源封装 ----------
// 主源：bitview.space (Bitcoin Research Kit, 开源 BRK)  — 链上指标 + 2013 至今日线价格
// 备源：mempool.space / blockchain.info / Binance / Coinbase / OKX / BGeometrics 四镜像
import { fetchJSON, fetchText } from "./util.js";

export const GENESIS_MS = Date.UTC(2009, 0, 3); // 创世日 2009-01-03，day1 索引 0

// 精确供应量（含首块 +50 的近似修正可忽略）
export function btcSupply(height) {
  const epoch = Math.floor(height / 210000);
  const inEpoch = height % 210000;
  let s = 0;
  for (let e = 0; e < epoch; e++) s += 210000 * (50 / 2 ** e);
  s += inEpoch * (50 / 2 ** epoch);
  return s;
}

// ---- Binance 行情（多域名镜像，data-api.binance.vision 为官方公共行情、无地域限制）----
export async function binance(path) {
  return firstOkMulti(["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"].map(
    (h) => async () => fetchJSON(h + path, { timeout: 9000 })
  ));
}
async function firstOkMulti(runners) {
  let last;
  for (const r of runners) {
    try {
      return await r();
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("no candidates");
}

export async function priceSpot() {
  const r = await firstOkMulti([
    async () => {
      const j = await fetchJSON("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT", { timeout: 8000 });
      return { value: { usd: +j.lastPrice, changePct24h: +j.priceChangePercent, high: +j.highPrice, low: +j.lowPrice, volBtc: +j.volume }, source: "binance" };
    },
    async () => {
      const j = await fetchJSON("https://api.exchange.coinbase.com/products/BTC-USD/stats", { timeout: 8000 });
      const p = +j.last;
      return { value: { usd: p, changePct24h: ((p - +j.open) / +j.open) * 100, high: +j.high, low: +j.low, volBtc: +j.volume }, source: "coinbase" };
    },
    async () => {
      const j = await fetchJSON("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", { timeout: 8000 });
      const t = j.data[0];
      const p = +t.last;
      return { value: { usd: p, changePct24h: ((p - +t.open24h) / +t.open24h) * 100, high: +t.high24h, low: +t.low24h, volBtc: +t.vol24h }, source: "okx" };
    },
  ]);
  return { ...r.value, source: r.source };
}

// ---- BRK bitview.space 系列 ----
// day1 索引：0 = 2009-01-01（BRK 约定），末尾可能含少量未来占位点，统一裁剪到今天
export async function brkSeries(name, { index = "day1", start = "2013-01-01" } = {}) {
  const j = await fetchJSON(`https://bitview.space/api/series/${name}/${index}?start=${start}`, { timeout: 15000 });
  if (!j || !Array.isArray(j.data)) throw new Error("brk bad payload");
  const BASE = Date.UTC(2009, 0, 1);
  const today = new Date().toISOString().slice(0, 10);
  const dates = j.data.map((_, i) => new Date(BASE + (j.start + i) * 86400000).toISOString().slice(0, 10));
  let n = dates.length;
  while (n > 0 && dates[n - 1] > today) n--;
  return { dates: dates.slice(0, n), values: j.data.slice(0, n), start: j.start, end: j.start + n - 1, type: j.type, stamp: j.stamp };
}

// BRK 的 mempool 兼容镜像（mempool.space 故障时备用）
export async function brkMempoolCompat(path) {
  return fetchJSON(`https://bitview.space${path}`, { timeout: 10000 });
}

// ---- BGeometrics / bitcoin-data.com（4 个镜像域名轮换，匿名限流 10 次/时/域名）----
export const BG_HOSTS = [
  "https://api.bgeometrics.com/v1",
  "https://api.bitcoin-data.com/v1",
  "https://bitcoin-data.com/api/v1",
  "https://bitcoin-data.com/v1",
];

function normalizeBG(j) {
  if (!j || j.error) throw new Error(j && j.error ? j.error.code || "bg error" : "bg bad payload");
  let rows = j;
  if (!Array.isArray(rows) && Array.isArray(rows.data)) rows = rows.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error("bg empty");
  const first = rows[0];
  let dKey, vKey;
  if (typeof first === "object" && !Array.isArray(first)) {
    dKey = ["d", "date", "day"].find((k) => k in first);
    vKey = ["v", "value", "price"].find((k) => k in first);
    if (!dKey || !vKey) throw new Error("bg unknown keys");
  } else if (Array.isArray(first)) {
    rows = rows.map((r) => ({ d: r[0], v: r[1] }));
  } else throw new Error("bg unknown shape");
  return { dates: rows.map((r) => String(r[dKey]).slice(0, 10)), values: rows.map((r) => +r[vKey]) };
}

export async function bgeoSeries(path) {
  let last;
  for (const h of BG_HOSTS) {
    try {
      const j = await fetchJSON(`${h}/${path}`, { timeout: 12000 });
      const n = normalizeBG(j);
      return { ...n, source: new URL(h).hostname };
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("bgeo all hosts failed");
}

// ---- 历史价格（全量日线，多级备源）----
export async function priceHistoryFull() {
  // 1) BRK 2013 至今（day1）
  // 2) mempool.space 小时级 → 折算日线
  // 3) blockchain.info 全历史
  return firstOkMulti([
    async () => {
      const s = await brkSeries("price", { start: "2013-01-01" });
      return { dates: s.dates, values: s.values, source: "bitview.space(BRK)" };
    },
    async () => {
      const j = await fetchJSON("https://mempool.space/api/v1/historical-price?currency=USD", { timeout: 20000 });
      const byDay = new Map();
      for (const p of j.prices || []) {
        const day = new Date(p.time * 1000).toISOString().slice(0, 10);
        byDay.set(day, +p.USD); // 同日多值取最后（收盘近似）
      }
      const dates = [...byDay.keys()].sort();
      return { dates, values: dates.map((d) => byDay.get(d)), source: "mempool.space" };
    },
    async () => {
      const j = await fetchJSON("https://api.blockchain.info/charts/market-price?timespan=all&format=json", { timeout: 20000 });
      const dates = (j.values || []).map((v) => new Date(v.x * 1000).toISOString().slice(0, 10));
      return { dates, values: j.values.map((v) => v.y), source: "blockchain.info" };
    },
  ]);
}

// ---- mempool.space 网络/矿业 ----
export async function mempool(path) {
  return firstOkMulti([
    async () => fetchJSON(`https://mempool.space${path}`, { timeout: 10000 }),
    async () => brkMempoolCompat(path),
  ]);
}

export async function tipHeight() {
  return firstOkMulti([
    async () => ({ height: +(await fetchText("https://mempool.space/api/blocks/tip/height", { timeout: 8000 })).trim(), source: "mempool.space" }),
    async () => ({ height: +(await fetchText("https://bitview.space/api/blocks/tip/height", { timeout: 8000 })).trim(), source: "bitview.space" }),
  ]);
}

// ---- 恐惧贪婪指数 (alternative.me) ----
export async function fgi(limit = 730) {
  const j = await fetchJSON(`https://api.alternative.me/fng/?limit=${limit}`, { timeout: 10000 });
  const rows = (j.data || []).map((d) => ({ t: +d.timestamp * 1000, v: +d.value, label: d.value_classification })).reverse();
  if (!rows.length) throw new Error("fgi empty");
  return rows;
}

// ---- OKX 资金费率 ----
export async function okxFunding() {
  const j = await fetchJSON("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP", { timeout: 9000 });
  const d = j.data[0];
  return { rate: +d.fundingRate, nextTs: +d.fundingTime, instId: d.instId };
}
export async function okxFundingHistory(limit = 90) {
  const j = await fetchJSON(`https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=${limit}`, { timeout: 10000 });
  return (j.data || []).map((d) => ({ t: +d.fundingTime, r: +d.realizedRate })).reverse();
}

// ---- DefiLlama 稳定币 ----
export const STABLE_IDS = { usdt: "1", usdc: "2" };
export async function stablecoinSeries(id) {
  const j = await fetchJSON(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`, { timeout: 20000 });
  const rows = (j || []).map((r) => ({
    t: +r.date * 1000,
    v: +(r.totalCirculatingUSD ? r.totalCirculatingUSD.peggedUSD : r.totalCirculating?.peggedUSD) || 0,
  }));
  return rows.filter((r) => r.v > 0);
}

// ---- Polymarket 预测市场 ----
export async function polymarket2026() {
  const j = await fetchJSON("https://gamma-api.polymarket.com/events?slug=what-price-will-bitcoin-hit-before-2027", { timeout: 12000 });
  const ev = Array.isArray(j) && j[0];
  if (!ev) throw new Error("pm event missing");
  const out = { title: ev.title, slug: ev.slug, up: [], down: [] };
  for (const m of ev.markets || []) {
    const label = (m.groupItemTitle || "").trim();
    const prices = (() => {
      try {
        return JSON.parse(m.outcomePrices || "[]").map(Number);
      } catch {
        return [];
      }
    })();
    if (!prices.length || prices[0] >= 0.999 || prices[0] <= 0.001) continue; // 已结算或无意义
    const dir = label.startsWith("↑") ? "up" : label.startsWith("↓") ? "down" : null;
    const target = +(label.replace(/[↑↓,]/g, "").trim()) || null;
    if (!dir || !target) continue;
    ;(dir === "up" ? out.up : out.down).push({ target, pct: +(prices[0] * 100).toFixed(1) });
  }
  out.up.sort((a, b) => a.target - b.target);
  out.down.sort((a, b) => b.target - a.target);
  return out;
}

// ---- Coin Metrics 社区版（MVRV 备源）----
export async function cmMvrvLast() {
  const j = await fetchJSON(
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=3&start_time=" +
      new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
    { timeout: 12000 }
  );
  const rows = j.data || [];
  if (!rows.length) throw new Error("cm empty");
  const last = rows[rows.length - 1];
  return { mvrv: +last.CapMVRVCur, date: last.time.slice(0, 10) };
}
