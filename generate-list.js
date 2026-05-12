#!/usr/bin/env node
/*
 * generate-list.js
 * ================
 *
 * 扫描项目根目录下的 ppt/ resources/ games/ 三个文件夹，
 * 生成同目录下的 files.json。前端 index.html 通过
 *     fetch("./files.json")
 * 读取这个清单，并渲染下载列表 / 游戏入口。
 *
 * 该脚本：
 *   - 仅使用 Node.js 内置模块（fs / path），无任何 npm 依赖
 *   - 在 Cloudflare Pages 的 build 容器中直接运行
 *   - 输出路径全部是相对路径，使用 POSIX 风格的 "/"
 *
 * 在本地手动运行：
 *     node generate-list.js
 *
 * 在 Cloudflare Pages 中配置 Build command：
 *     node generate-list.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------- 配置 ----------

// 需要扫描的目录（相对脚本所在目录）
const CONTENT_DIRS = ["ppt", "resources", "games"];

// 永远不写进 files.json 的文件/目录名
const HIDDEN_NAMES = new Set([
    ".DS_Store",
    ".gitkeep",
    ".gitattributes",
    ".git",
    "node_modules",
    "Thumbs.db",
    "README.md",
]);

const OUTPUT = "files.json";

// ---------- 工具 ----------

/** 把任意路径片段拼成 POSIX 相对路径（永远用 "/" 作为分隔符）。 */
function toPosix(p) {
    return p.split(path.sep).join("/");
}

/**
 * 递归收集 rootDir 下所有非隐藏文件。
 * 返回 [{ path, size }, ...]，path 是相对于 baseDir 的 POSIX 字符串。
 */
function collectFiles(rootDir, baseDir) {
    const out = [];
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return out;
    }

    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            console.error("[warn] 无法读取目录: " + dir + " — " + e.message);
            continue;
        }
        for (const ent of entries) {
            if (HIDDEN_NAMES.has(ent.name)) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile()) {
                let size = 0;
                try { size = fs.statSync(full).size; } catch (_) { /* ignore */ }
                const rel = toPosix(path.relative(baseDir, full));
                out.push({ path: rel, size: size });
            }
            // 软链接 / 设备文件等忽略
        }
    }

    // 稳定排序，方便 git diff
    out.sort((a, b) =>
        a.path.localeCompare(b.path, "zh-Hans-CN", { numeric: true }));
    return out;
}

// ---------- 主流程 ----------

function main() {
    const baseDir = __dirname; // 脚本所在目录 = 项目根
    const manifest = { generatedAt: new Date().toISOString(), files: [] };

    for (const sub of CONTENT_DIRS) {
        const dir = path.join(baseDir, sub);
        if (!fs.existsSync(dir)) {
            console.error("[skip] " + sub + "/ 不存在");
            continue;
        }
        const files = collectFiles(dir, baseDir);
        manifest.files.push(...files);
        console.error("[ok]   " + sub + "/ → " + files.length + " 个文件");
    }

    const outPath = path.join(baseDir, OUTPUT);
    fs.writeFileSync(
        outPath,
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8"
    );

    console.error("\n写入 " + outPath +
                  "（共 " + manifest.files.length + " 个文件）");
}

main();
