// GET /api/mining — 网络 & 矿业：难度、算力、手续费、内存池、关机币价区间
import { json, cachedJSON, withTimeout } from "../lib/util.js";
import { mempool, tipHeight } from "../lib/sources.js";
import { getMarket } from "../lib/market.js";

export async function onRequest(ctx) {
  const { data, cache } = await cachedJSON(ctx, "mining-v2", 1800, buildMining);
  return json({ ts: Date.now(), cache, ...data }, { ttl: 900 });
}

async function buildMining() {
  const r = await withTimeout([
    { k: "tip", p: tipHeight() },
    { k: "diff", p: mempool("/api/v1/difficulty-adjustment") },
    { k: "hash3y", p: mempool("/api/v1/mining/hashrate/3y") },
    { k: "reward", p: mempool("/api/v1/mining/reward-stats/144") },
    { k: "fees", p: mempool("/api/v1/fees/recommended") },
    { k: "mempool", p: mempool("/api/mempool") },
    { k: "market", p: getMarket().then((x) => x.data) },
  ]);
  const t = (k) => (r[k].ok ? r[k].value : null);

  const tip = t("tip");
  const diff = t("diff");
  const h3 = t("hash3y");
  const reward = t("reward");
  const fees = t("fees");
  const mp = t("mempool");
  const market = t("market");
  const price = market ? market.stats.last : null;

  let hashrate = null;
  if (h3 && h3.currentHashrate) {
    const cur = +h3.currentHashrate;
    // 周度降采样
    const wk = [];
    const hs = h3.hashrates || [];
    for (let i = hs.length - 1; i >= 0; i -= 7) wk.unshift([hs[i].timestamp, +(hs[i].avgHashrate / 1e18).toFixed(1)]);
    hashrate = { currentEHs: +(cur / 1e18).toFixed(1), series: wk, currentDifficulty: h3.currentDifficulty };
  }

  let shutdown = null;
  if (h3 && h3.currentHashrate && reward && price != null) {
    const hs = +h3.currentHashrate;
    const rewardBtc = (+reward.totalReward - +reward.totalFee) / 1e8;
    const feesBtc = +reward.totalFee / 1e8;
    const blocks = Math.max(1, +reward.endBlock - +reward.startBlock);
    const dailyIssuance = (rewardBtc / blocks) * 144;
    const dailyFees = (feesBtc / blocks) * 144;
    const effs = [14, 18, 23, 30]; // J/TH（能效比场景）
    const elec = [0.04, 0.06, 0.09]; // $/kWh（电价场景）
    const rows = [];
    for (const e of effs)
      for (const w of elec) {
        const costUsd = ((hs / 1e12) * e * 86400) / 3.6e6 * w;
        rows.push({ effJth: e, elecUsd: w, price: +((costUsd / (dailyIssuance + dailyFees))).toFixed(0) });
      }
    const sorted = rows.map((x) => x.price).sort((a, b) => a - b);
    shutdown = {
      rows,
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      max: sorted[sorted.length - 1],
      assumptions: "能效比 14–30 J/TH × 电价 $0.04–0.09/kWh，产出=144块/日×区块奖励+手续费",
      dailyIssuanceBtc: +dailyIssuance.toFixed(1),
      dailyFeesBtc: +dailyFees.toFixed(2),
      price,
      marginPct: +(((price / sorted[Math.floor(sorted.length / 2)]) * 100) - 100).toFixed(1),
    };
  }

  let hashrateSeries = hashrate ? hashrate.series : null;
  let difficultySeries = null;
  if (h3 && Array.isArray(h3.difficulty) && h3.difficulty.length) {
    const ds = h3.difficulty;
    const wk = [];
    for (let i = ds.length - 1; i >= 0; i -= 7) wk.unshift([ds[i].time || ds[i].timestamp, +(ds[i].difficulty / 1e12).toFixed(2)]);
    difficultySeries = wk;
  }

  return {
    tip: tip ? tip.height : null,
    difficultyAdjustment: diff
      ? {
          progressPct: +diff.progressPercent.toFixed(2),
          changePct: +diff.difficultyChange.toFixed(2),
          remainingBlocks: diff.remainingBlocks,
          nextRetargetHeight: diff.nextRetargetHeight,
          estimatedRetargetDate: new Date(diff.estimatedRetargetDate).toISOString().slice(0, 10),
          previousRetargetPct: +((diff.previousRetarget - 1) * 100).toFixed(2),
        }
      : null,
    hashrate,
    difficultySeries,
    reward: reward
      ? {
          blocks24h: +reward.endBlock - +reward.startBlock,
          reward24hBtc: +((+reward.totalReward - +reward.totalFee) / 1e8).toFixed(1),
          fees24hBtc: +( +reward.totalFee / 1e8).toFixed(2),
          tx24h: +reward.totalTx,
        }
      : null,
    fees,
    mempool: mp ? { count: mp.count, vsizeMB: +(mp.vsize / 1e6).toFixed(1), totalFeeBtc: +(mp.total_fee / 1e8).toFixed(2) } : null,
    shutdown,
    sources: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ok: v.ok, ms: v.ms, error: v.error || null }])),
  };
}
