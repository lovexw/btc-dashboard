// ---------- 通用工具：超时请求 / 故障转移 / 双层缓存 ----------
// 运行环境：Cloudflare Pages Functions (Workers Runtime)

const MEM = (globalThis.__BTC_MEM ||= new Map());

export function json(data, { ttl = 60, status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${Math.max(5, Math.floor(ttl / 3))}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`,
      "access-control-allow-origin": "*",
    },
  });
}

export async function fetchText(url, { timeout = 12000, headers = {} } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort("timeout"), timeout);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": "btc-dashboard/1.0 (+oss dashboard; no keys)", accept: "application/json", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJSON(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("bad json");
  }
}

/** 依次尝试候选源，全部失败才抛错。
 *  candidates: [{name, run: async () => any}]  */
export async function firstOk(candidates) {
  const attempts = [];
  for (const c of candidates) {
    const t0 = Date.now();
    try {
      const value = await c.run();
      const ms = Date.now() - t0;
      attempts.push({ name: c.name, ok: true, ms });
      return { value, source: c.name, ms, attempts };
    } catch (e) {
      attempts.push({ name: c.name, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 120) });
    }
  }
  const err = new Error("all sources failed: " + attempts.map((a) => `${a.name}(${a.error})`).join(" | "));
  err.attempts = attempts;
  throw err;
}

/** 内存 + Cloudflare 边缘 双层缓存 */
export async function cachedJSON(ctx, key, ttlSec, fn) {
  const now = Date.now();
  const m = MEM.get(key);
  if (m && now - m.t < ttlSec * 1000) return { data: m.d, cache: "memory" };

  try {
    const hit = await caches.default.match(new Request(`https://cache.internal/${key}`));
    if (hit) {
      const d = await hit.json();
      MEM.set(key, { t: now, d });
      return { data: d, cache: "edge" };
    }
  } catch {}

  const d = await fn();
  MEM.set(key, { t: now, d });
  if (ctx) {
    try {
      const res = new Response(JSON.stringify(d), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSec}` },
      });
      ctx.waitUntil(caches.default.put(new Request(`https://cache.internal/${key}`), res.clone()));
    } catch {}
  }
  return { data: d, cache: "miss" };
}

export function withTimeout(pairs) {
  // 并行执行 [{k, p}]，单个失败不影响其他；返回 {k: {ok, value|error, ms}}
  return Promise.all(
    pairs.map(async ({ k, p }) => {
      const t0 = Date.now();
      try {
        const value = await p;
        return [k, { ok: true, value, ms: Date.now() - t0 }];
      } catch (e) {
        return [k, { ok: false, error: String(e.message || e).slice(0, 160), ms: Date.now() - t0 }];
      }
    })
  ).then((entries) => Object.fromEntries(entries));
}
