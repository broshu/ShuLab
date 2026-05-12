# Mr. Shu Physics Lab

这是一个最简单的 Cloudflare Pages 静态站点。

## 部署方式

Cloudflare Pages 直接连接 GitHub 仓库：

- 仓库：`broshu/ShuLab`
- 分支：`main`
- Build command：`node scripts/generate-files-json.js`
- Build output directory：`.`（仓库根目录，包含 `index.html`）

以后只需要把文件更新到 GitHub。Cloudflare Pages 会自动拉取最新代码、重新生成 `files.json`，然后把页面和文件发布到 Cloudflare。

中国大陆用户访问时只连接 Cloudflare，不需要连接 GitHub。

## 文件放置

- 课件放在 `ppt/`
- 资料放在 `resources/`
- 互动页面放在 `games/`

不要提交 `.DS_Store`、`~$` 开头的 Office 临时文件、`outputs/` 这类本地生成文件。
