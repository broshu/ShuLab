const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CONTENT_DIRS = ["ppt", "resources", "games"];
const HIDDEN_NAMES = new Set([
  ".DS_Store",
  ".gitkeep",
  ".gitattributes",
  ".gitignore",
  "Thumbs.db",
  "README.md",
]);

function shouldSkip(name) {
  return HIDDEN_NAMES.has(name) || name.startsWith("~$");
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    const stat = fs.statSync(fullPath);
    const relativePath = path.relative(ROOT, fullPath).split(path.sep).join("/");
    files.push({ path: relativePath, size: stat.size });
  }
}

const files = [];
for (const dir of CONTENT_DIRS) {
  const fullPath = path.join(ROOT, dir);
  if (fs.existsSync(fullPath)) walk(fullPath, files);
}

files.sort((a, b) =>
  a.path.localeCompare(b.path, "zh-Hans-CN", { numeric: true })
);

fs.writeFileSync(
  path.join(ROOT, "files.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: files.length,
      files,
    },
    null,
    2
  ) + "\n"
);
