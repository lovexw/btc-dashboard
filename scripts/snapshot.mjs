// 生成 public/data/snapshot.json —— 内置离线兜底快照
// 用法：node scripts/snapshot.mjs [baseURL]
//   baseURL 默认 http://127.0.0.1:8788（wrangler pages dev），
//   也可传线上地址，例如：node scripts/snapshot.mjs https://btc-dashboard.pages.dev
import { writeFile } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:8788";
const KEYS = ["overview", "onchain", "mining", "sentiment", "etf"]; // history 太大，不在 localStorage 兜底链里

function downsample(x) {
  if (Array.isArray(x)) {
    // 任意长数组统一抽稀（{dates,values} 同步抽样保持对齐）
    if (x.length > 600) {
      const step = Math.ceil(x.length / 600);
      return x.filter((_, i) => i % step === 0).map(downsample);
    }
    return x.map(downsample);
  }
  if (x && typeof x === "object") {
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = downsample(v);
    return out;
  }
  return x;
}

const snap = {};
for (const k of KEYS) {
  try {
    const r = await fetch(`${base}/api/${k}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    snap[k] = downsample(await r.json());
    console.log(`✓ ${k} (${JSON.stringify(snap[k]).length} bytes)`);
  } catch (e) {
    console.error(`✗ ${k}: ${e.message}`);
  }
}
if (!Object.keys(snap).length) {
  console.error("没有任何成功抓取的端点，未写入快照。");
  process.exit(1);
}
snap.history = null;
await writeFile(new URL("../public/data/snapshot.json", import.meta.url), JSON.stringify(snap));
console.log("已写入 public/data/snapshot.json");
