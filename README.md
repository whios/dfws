# AI伙伴 Skill 与智能体核实管理系统

用于登记四品牌的 Skill、智能体与工作流，记录共享盘证据路径，完成核验分级、风险整改和领导汇报。前端使用 Supabase 邮箱一次性链接登录，业务数据写入 Supabase Postgres。

## 本地启动

```bash
python3 -m http.server 4173
```

浏览器打开 `http://localhost:4173`。首次打开会要求使用工作邮箱登录；系统仅保存共享盘链接或 SMB 路径，不会上传图片或访问共享盘内容。

## 云端权限与导入

- 首个登录账号自动获得 `AI 应用官` 权限，用于首次导入、资产核验和风险维护。
- 后续账号默认为 `伙伴`；可由 AI 应用官在 Supabase 的 `profiles` 表中调整为负责人、品牌管理员或领导只读。
- 点击页面顶部的“首次导入云端”后，当前浏览器内的伙伴名单、资产、点评和风险数据会写入云端；导入完成后的保存会自动同步。
- `supabase-config.js` 仅包含可公开的 publishable key。任何 `sb_secret_` / service role 密钥都不得写入前端或 Git。

## 共享盘证据

- HTTPS 链接会提供“打开证据”。
- SMB 路径（例如 `\\server\share\proof.png`）可复制，但浏览器通常无法直接预览。

## 部署

本地验收后可作为 Vercel 静态项目部署，并在项目域名配置中添加 `dfws.wendywang.club`。域名解析是否需要新增 CNAME 取决于 `wendywang.club` 当前是否已配置通配符子域名。
