# AI伙伴 Skill 与智能体核实管理系统

纯静态、本地可运行的内部管理台。用于登记四品牌的 Skill、智能体与工作流，记录共享盘证据路径，完成核验分级、风险整改和领导汇报。

## 本地启动

```bash
python3 -m http.server 4173
```

浏览器打开 `http://localhost:4173`。数据保存在浏览器的 `localStorage`，键名为 `dfws-v1`，不会上传图片或访问共享盘内容。

## 共享盘证据

- HTTPS 链接会提供“打开证据”。
- SMB 路径（例如 `\\server\share\proof.png`）可复制，但浏览器通常无法直接预览。

## 部署

本地验收后可作为 Vercel 静态项目部署，并在项目域名配置中添加 `dfws.wendywang.club`。域名解析是否需要新增 CNAME 取决于 `wendywang.club` 当前是否已配置通配符子域名。
