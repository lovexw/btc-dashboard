// GET /api/health — 数据源健康检查（轻量并行探测）
import { json, withTimeout, fetchText } from "../lib/util.js";

const CHECKS = [
  { name: "binance-vision", label: "Binance 公共行情（浏览器直连源）", url: "https://data-api.binance.vision/api/v3/ping", tier: 2 },
  { name: "coinbase", label: "Coinbase 行情（服务端价格主源）", url: "https://api.exchange.coinbase.com/products/BTC-USD/stats", tier: 1 },
  { name: "bitview-price", label: "Bitview/BRK 价格历史", url: "https://bitview.space/api/series/price/day1?start=2026-09-18", tier: 1 },
  { name: "bitview-onchain", label: "Bitview/BRK 链上指标", url: "https://bitview.space/api/series/mvrv/day1?start=2026-09-18", tier: 1 },
  { name: "mempool", label: "mempool.space 网络矿业", url: "https://mempool.space/api/blocks/tip/height", tier: 1 },
  { name: "fng", label: "Alternative.me 恐惧贪婪", url: "https://api.alternative.me/fng/?limit=1", tier: 1 },
  { name: "binance", label: "Binance 主站（浏览器直连备源）", url: "https://api.binance.com/api/v3/ping", tier: 2 },
  { name: "okx", label: "OKX 行情/资金费率", url: "https://www.okx.com/api/v5/public/time", tier: 2 },
  { name: "defillama", label: "DefiLlama 稳定币", url: "https://stablecoins.llama.fi/stablecoins?includePrices=false", tier: 2 },
  { name: "bgeometrics", label: "BGeometrics/SOPR·均衡价", url: "https://api.bgeometrics.com/v1/transfer-price", tier: 2 },
  { name: "bitcoin-data", label: "bitcoin-data.com（BGeo 镜像）", url: "https://bitcoin-data.com/v1/transfer-price", tier: 2 },
  { name: "polymarket", label: "Polymarket 预测市场", url: "https://gamma-api.polymarket.com/events?slug=what-price-will-bitcoin-hit-before-2027", tier: 2 },
  { name: "coingecko", label: "CoinGecko 市值备源", url: "https://api.coingecko.com/api/v3/ping", tier: 2 },
  { name: "yahoo", label: "Yahoo Finance 美元指数", url: "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=5d&interval=1d", tier: 2 },
  { name: "frankfurter", label: "欧央行汇率（DXY 备源）", url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR", tier: 2 },
  { name: "blockchain-info", label: "blockchain.info 深度备源", url: "https://api.blockchain.info/charts/market-price?timespan=2days&format=json", tier: 3 },
];

export async function onRequest() {
  const r = await withTimeout(
    CHECKS.map((c) => ({
      k: c.name,
      p: (async () => {
        const txt = await fetchText(c.url, { timeout: 8000 });
        if (!txt || txt.length < 2) throw new Error("empty");
        return txt.length;
      })(),
    }))
  );
  const rows = CHECKS.map((c) => ({ ...c, ...(r[c.name] || { ok: false, error: "skipped" }) }));
  const okCount = rows.filter((x) => x.ok).length;
  return json(
    { checkedAt: Date.now(), okCount, total: rows.length, allCriticalOk: rows.filter((x) => x.tier === 1).every((x) => x.ok), rows },
    { ttl: 30 }
  );
}
