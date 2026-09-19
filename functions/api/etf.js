// GET /api/etf — 美国现货比特币 ETF 资金流（数据：Farside Investors，经 Jina Reader 渲染绕过其 Cloudflare 盾）
// 失败自动降级：直接抓取 → 前端隐藏模块，绝不报错白屏
import { json, cachedJSON, firstOk, fetchText } from "../lib/util.js";

export async function onRequest(ctx) {
  const { data, cache } = await cachedJSON(ctx, "etf-v1", 6 * 3600, buildEtf);
  return json({ ts: Date.now(), cache, ...data }, { ttl: 1800 });
}

// Jina Reader 会按 Accept 头返回 JSON 包装（{data:{content}}），统一解包成纯文本
function unwrap(t) {
  try {
    const j = JSON.parse(t);
    if (j && j.data && typeof j.data.content === "string") return j.data.content;
  } catch {}
  return t;
}

async function buildEtf() {
  const r = await firstOk([
    { name: "farside-all(jina)", run: async () => parseRows(unwrap(await fetchText("https://r.jina.ai/https://farside.co.uk/bitcoin-etf-flow-all-data/", { timeout: 50000 }))) },
    { name: "farside-recent(jina)", run: async () => parseRows(unwrap(await fetchText("https://r.jina.ai/https://farside.co.uk/btc/", { timeout: 50000 }))) },
    { name: "farside-all(direct)", run: async () => parseRows(await fetchText("https://farside.co.uk/bitcoin-etf-flow-all-data/", { timeout: 25000 })) },
  ]);
  return r.value;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const num = (s) => {
  const t = s.trim().replace(/,/g, "");
  if (!t || t === "—" || t === "-") return null;
  const neg = /^\(.*\)$/.test(t);
  const v = parseFloat(t.replace(/[()]/g, ""));
  return isFinite(v) ? (neg ? -v : v) : null; // 单位：百万美元
};

const CANON_ISSUERS = ["IBIT", "FBTC", "BITB", "ARKB", "BTCO", "EZBC", "BRRR", "HODL", "BTCW", "MSBT", "GBTC", "BTC"];

function parseRows(text) {
  const t = text.replace(/\r/g, "");
  // 表头里的发行人列名（首个日期之前）；不干净时退回已知 12 只列表
  const firstDate = t.search(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
  const head = firstDate > 0 ? t.slice(0, firstDate) : "";
  let issuerNames = [...new Set(head.match(/\b[A-Z]{2,6}\b/g) || [])].filter((n) => n !== "Total");
  const clean = issuerNames.includes("IBIT") && issuerNames.includes("GBTC") && issuerNames.length === CANON_ISSUERS.length;
  if (!clean) issuerNames = CANON_ISSUERS;

  // 以日期为锚点切分记录：每条记录内的全部数字 = 各发行人 + 末列 Total
  const re = /(\d{1,2} [A-Z][a-z]{2} \d{4})([\s\S]*?)(?=\d{1,2} [A-Z][a-z]{2} \d{4}|$)/g;
  const rows = [];
  let m;
  while ((m = re.exec(t))) {
    let seg = m[2];
    const cut = seg.search(/\bTotal\b/);
    if (cut >= 0) seg = seg.slice(0, cut); // 表尾汇总行与页脚不含日期，但保险起见截断
    // 按单元格切分（兼容 TSV 变体与 markdown 管道），"-" 记 0 以保持列对位
    const s2 = seg.replace(/\t\n/g, "|").replace(/\n\t/g, "|").replace(/\n\|/g, "|").replace(/\|\n/g, "|");
    const cells = s2.split("|").map((c) => c.trim()).filter((c) => c !== "");
    const vals = [];
    for (const c of cells) {
      const v = num(c);
      vals.push(v == null && /^[-—–]$/.test(c) ? 0 : v);
    }
    if (vals.filter((v) => v != null).length < 3) continue;
    const dm = m[1].match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
    const date = `${dm[3]}-${String(MONTHS[dm[2]] + 1).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;
    const total = vals[vals.length - 1];
    const issuerVals = issuerNames.length && vals.length >= issuerNames.length + 1 ? vals.slice(0, issuerNames.length) : vals.slice(0, -1);
    const sum = issuerVals.reduce((a, v) => a + (v || 0), 0);
    rows.push({
      date,
      total: total != null && Math.abs(total - sum) <= 1.5 ? total : +sum.toFixed(1),
      issuers: issuerVals,
    });
  }
  if (rows.length < 30) throw new Error("etf rows too few: " + rows.length);

  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = rows[rows.length - 1];
  const sumN = (n) => rows.slice(-n).reduce((s, r) => s + r.total, 0);
  let cum = 0;
  const series = [], cumSeries = [];
  for (const r of rows) {
    cum += r.total;
    series.push([new Date(r.date + "T00:00:00Z").getTime(), +r.total.toFixed(1)]);
    cumSeries.push([new Date(r.date + "T00:00:00Z").getTime(), +cum.toFixed(0)]);
  }
  const issuers = issuerNames.length
    ? issuerNames.map((name, i) => ({ name, cumM: +rows.reduce((s2, r) => s2 + (r.issuers[i] || 0), 0).toFixed(0) })).sort((a, b) => b.cumM - a.cumM)
    : [];
  return {
    source: "Farside Investors",
    updatedDate: last.date,
    latest: { date: last.date, totalM: last.total },
    sum7M: +sumN(7).toFixed(1),
    sum30M: +sumN(30).toFixed(1),
    cumulativeM: +cum.toFixed(0),
    issuers,
    series,
    cumSeries,
  };
}
