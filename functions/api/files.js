/*
 * functions/api/files.js
 * ======================
 *
 * Cloudflare Pages Function — 服务端代理 GitHub 文件树。
 *
 * - 路径：GET https://phylab.uk/api/files
 * - 在 Cloudflare 边缘节点上调用 GitHub API（中国大陆浏览器不直连 GitHub）
 * - 过滤后返回 { files: [{ path, size }, ...] }
 * - 边缘缓存 300 秒、浏览器最长 60 秒，避免 GitHub 60/h 匿名速率限制
 *
 * 可选环境变量（在 Cloudflare Pages → Settings → Environment variables 配置）：
 *   GITHUB_TOKEN   GitHub personal access token，提升速率限制到 5000/h
 *   REPO_OWNER     默认 "broshu"
 *   REPO_NAME      默认 "ShuLab"
 *   BRANCH         默认 "main"
 */

const DEFAULTS = {
  REPO_OWNER: "broshu",
  REPO_NAME:  "ShuLab",
  BRANCH:     "main",
};

// 只暴露这些前缀下的文件
const CONTENT_PREFIXES = ["ppt/", "resources/", "games/"];

// 永远过滤掉的文件名
const HIDDEN_NAMES = new Set([
  ".DS_Store",
  ".gitkeep",
  ".gitattributes",
  ".gitignore",
  "Thumbs.db",
  "README.md",
]);

// 缓存策略（秒）
const EDGE_TTL    = 300; // Cloudflare 边缘缓存
const BROWSER_TTL = 60;  // 浏览器缓存

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  const owner  = env.REPO_OWNER || DEFAULTS.REPO_OWNER;
  const repo   = env.REPO_NAME  || DEFAULTS.REPO_NAME;
  const branch = env.BRANCH     || DEFAULTS.BRANCH;

  // ---- 1. 先查 Cloudflare 边缘缓存 ----
  // 用一个稳定的、不带查询串的 URL 作为缓存键，避免 cache-buster 影响命中
  const cacheKey = new Request(
    new URL("/api/files", request.url).toString(),
    { method: "GET" }
  );
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    // 透传缓存命中（再补一个 header 便于排查）
    const out = new Response(hit.body, hit);
    out.headers.set("X-Cache", "HIT");
    return out;
  }

  // ---- 2. 缓存未命中：调用 GitHub Trees API ----
  const ghUrl =
    `https://api.github.com/repos/${owner}/${repo}` +
    `/git/trees/${encodeURIComponent(branch)}?recursive=1`;

  const ghHeaders = {
    // GitHub 要求所有请求带 User-Agent
    "User-Agent": "phylab-uk-pages-function",
    "Accept":     "application/vnd.github+json",
  };
  if (env.GITHUB_TOKEN) {
    ghHeaders["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  let ghResp;
  try {
    ghResp = await fetch(ghUrl, { headers: ghHeaders });
  } catch (e) {
    return jsonResponse(502, {
      error: "无法连接到 GitHub API",
      detail: String(e && e.message || e),
      files: [],
    });
  }

  if (!ghResp.ok) {
    const txt = await ghResp.text().catch(() => "");
    return jsonResponse(ghResp.status, {
      error: `GitHub API 返回 ${ghResp.status}`,
      detail: txt.slice(0, 400),
      hint: ghResp.status === 403
        ? "可能触发了匿名速率限制，建议在 Pages 环境变量里配置 GITHUB_TOKEN。"
        : ghResp.status === 404
        ? "仓库不存在，或者是私有仓库且未提供 token。"
        : undefined,
      files: [],
    });
  }

  const data = await ghResp.json();
  const tree = Array.isArray(data.tree) ? data.tree : [];

  // ---- 3. 过滤 ----
  const files = [];
  for (const it of tree) {
    if (it.type !== "blob") continue;
    if (!CONTENT_PREFIXES.some(p => it.path.startsWith(p))) continue;
    const name = it.path.split("/").pop();
    if (HIDDEN_NAMES.has(name)) continue;
    files.push({ path: it.path, size: typeof it.size === "number" ? it.size : 0 });
  }

  // 稳定排序，便于前端 / 调试
  files.sort((a, b) =>
    a.path.localeCompare(b.path, "zh-Hans-CN", { numeric: true }));

  const body = JSON.stringify({
    generatedAt: new Date().toISOString(),
    repo: `${owner}/${repo}`,
    branch,
    truncated: !!data.truncated,
    count: files.length,
    files,
  });

  // ---- 4. 写边缘缓存 + 回前端 ----
  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type":  "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${BROWSER_TTL}, s-maxage=${EDGE_TTL}`,
      "X-Cache":       "MISS",
      // 不需要 CORS（同站调用），但留着以防万一
      "Access-Control-Allow-Origin": "*",
    },
  });

  // 把一份副本塞进边缘缓存。waitUntil 让 put 不阻塞响应
  try {
    if (waitUntil) {
      waitUntil(cache.put(cacheKey, response.clone()));
    } else {
      // 本地 wrangler 调试时可能没有 waitUntil
      await cache.put(cacheKey, response.clone());
    }
  } catch (_) { /* 缓存失败不致命 */ }

  return response;
}

// 备用：当 truncated=true 时，说明仓库太大需要分页递归。
// broshu/ShuLab 现在体量很小，远低于 GitHub 的 100k 文件上限，
// 所以这里没有实现分页递归。如果以后仓库变大、出现 truncated=true，
// 再补一层 BFS：对每个 type === "tree" 的节点单独请求 trees/{sha}。

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type":  "application/json; charset=utf-8",
      // 错误响应只让浏览器短缓存，避免一次 GitHub 抽风全网卡 5 分钟
      "Cache-Control": "public, max-age=10",
    },
  });
}
