# BTC 全景仪表盘 · Bitcoin Panorama

多维度比特币投资仪表盘：整合 [fuckbtc.com](https://fuckbtc.com) 与 [9992100.xyz/btc](https://9992100.xyz/btc/) 的核心指标体系，全部数据**直连一手公开 API**，不依赖对方网站；每个指标配小白解读，三层容灾保证不白屏。浅色现代 UI，部署于 Cloudflare Pages。

> ⚠️ 仅供学习参考，不构成任何投资建议。币圈风险极高。

## 功能总览

| 板块 | 内容 |
| --- | --- |
| 总览 | 多源聚合价格、涨跌幅（24h/7d/30d/90d/1y）、市值、ATH 回撤、综合估值仪表（7 维加权 0–100）、恐惧贪婪、减半倒计时环、8 项快捷指标 |
| 估值 | AHR999（经典+新拟合）、MVRV、价格/200周线、幂律走廊位置、均衡价格、Reserve Risk、Pi Cycle 距离、200日定投成本、自选价格试算 |
| 周期图表 | 价格×200WMA×MA250（12 年对数轴+减半周期底纹）、幂律走廊、MVRV、NUPL/LTH-NUPL、Puell、Reserve Risk、SOPR、盈利供应占比（全部带区间标注） |
| 成本锚 | 成本阶梯（现价相对各链上成本线的位置）+ 4 年成本线叠图（已实现价格/真实市场均值/STH 成本/UTXO 中位成本/均衡价格） |
| 链上 | URPD 筹码分布、长期持有者亏损供应、STH 成本、TMM、STH-MVRV 等 |
| 矿业 | 算力与难度（3 年）、难度调整倒计时、24h 奖励与手续费、内存池拥堵、推荐费率、关机币价 4×3 场景矩阵 |
| 情绪资金 | FGI 2 年历史、OKX 资金费率 30 天、USDT/USDC 市值 180 天、Coinbase 溢价、Polymarket 2026 价格目标概率 |
| 学堂 | 26 个指标的小白学堂（一句话人话 + 原理 + 阈值 + 数据源） |
| 数据源 | 14 个上游实时健康检查 + 容灾说明 |

## 数据源（全部一手公开 API，多级备源）

| 指标 | 主源 | 备源 |
| --- | --- | --- |
| 现货价格 | Binance 公共行情 (data-api.binance.vision) | Coinbase Exchange → OKX → 日线收盘 |
| 价格历史（2013–） | Bitview/BRK (bitview.space) | mempool.space 小时价 → blockchain.info 全历史 |
| MVRV / NUPL / Puell / Reserve Risk / 成本线 / URPD | Bitview/BRK | BGeometrics（4 域名轮换）→ Coin Metrics |
| SOPR / 均衡价格 / 转移价格 | BGeometrics (bitcoin-data.com) | BRK 块级 SOPR；realized−transfer 自算 |
| 网络与矿业 | mempool.space | bitview.space 兼容镜像 |
| 恐惧贪婪 | Alternative.me | — |
| 资金费率 | OKX | — |
| 稳定币市值 | DefiLlama | — |
| 预测市场 | Polymarket | — |
| 市值 | 现价 × 精确链上供应量 | CoinGecko |

自算指标（公式透明）：200WMA、MA111/250/350/850、Pi Cycle、200日定投成本（调和平均）、幂律 OLS 回归+残差分位走廊、AHR999 经典与自拟合、综合估值评分（7 维分段线性加权）、关机币价矩阵。

## 容灾设计（三层）

1. **上游自动故障转移** — 每个指标多供应商按序尝试（见上表）。
2. **Cloudflare 边缘缓存** — 所有 `/api/*` 经 Pages Functions 代理：行情 60s / 情绪 5min / 矿业 30min / 链上与历史 6h。上游限流（如 BGeometrics 匿名 10 次/时）由边缘缓存吸收。
3. **本地快照兜底** — 浏览器 localStorage 保存最近成功数据 → 全挂时回退仓库内置 `public/data/snapshot.json`，页面亮黄条提示数据延迟，绝不白屏。

## 本地开发

```bash
npx wrangler pages dev public   # 需 Node 18+；会自动加载 functions/ 目录
# 打开 http://127.0.0.1:8788
node scripts/snapshot.mjs       # 可选：抓取当前数据生成离线快照
```

## 部署

```bash
# Cloudflare Pages（已有项目）
npx wrangler pages deploy public --project-name btc-dashboard

# GitHub Actions 亦可（可选）：push 即部署，需在仓库 Secret 配置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

## 目录结构

```
public/            纯静态前端（无框架，原生 ES Module + 本地化 ECharts 5）
  assets/app.js    渲染、图表、综合估值、学堂、容灾快照逻辑
  data/snapshot.json  内置离线兜底快照（脚本生成）
functions/         Cloudflare Pages Functions（数据代理与计算）
  lib/util.js      超时请求 / firstOk 故障转移 / 内存+边缘双层缓存
  lib/sources.js   11 家上游封装（镜像轮换、格式归一化）
  lib/market.js    均线/幂律/AHR999/综合评分等计算核心
  api/*.js         overview / history / onchain / mining / sentiment / health
scripts/snapshot.mjs  快照生成脚本
```

## API

| 端点 | 缓存 | 说明 |
| --- | --- | --- |
| `GET /api/overview` | 60s | 价格、涨跌、ATH、综合估值部分维度、FGI、减半、资金费率、稳定币、Polymarket |
| `GET /api/history` | 1h | 2013 至今日线与全部计算序列（对数图/幂律/AHR999/Pi Cycle） |
| `GET /api/onchain` | 6h | MVRV/NUPL/Puell/Reserve Risk/SOPR/成本线/URPD（含 latest 与历史序列） |
| `GET /api/mining` | 30min | 难度调整、算力 3 年、奖励、费率、内存池、关机币价矩阵 |
| `GET /api/sentiment` | 5min | FGI 2 年、资金费率 30 天、稳定币 180 天、Coinbase 溢价、Polymarket |
| `GET /api/health` | 30s | 14 个上游并发探测 |

## License

MIT
