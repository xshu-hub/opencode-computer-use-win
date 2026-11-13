# 构建与交付

本仓库面向 OpenCode V1。原 DSH 市场发布说明已归档到 docs/reference/PUBLISH.dsh.md，不适用于当前包。

## 本地验证

~~~powershell
npm ci --ignore-scripts
npm run build
npm test
npm run test:ui
node test/run-opencode-host.mjs C:/path/to/opencode.exe
node test/screenshot-output.mjs
node test/batch-actions.mjs
npm pack
~~~

完整原项目测试需要其 Windows/Electron 测试环境，具体结果和已知边界应如实记录，不能把未运行或失败的测试写成通过。

## GitHub Actions

推送或 PR 会触发 Windows 构建，也可以手动触发 workflow_dispatch。CI 会：

1. 安装开发依赖并构建设置页面。
2. 运行适配器、UI 与选定的共享后端回归。
3. 用 npm pack 构建 tgz。
4. 在省略开发依赖的独立目录安装该 tgz，并验证入口、静态资源、许可证和 MCP 工具目录。
5. 上传 opencode-computer-use-win 安装包 artifact 和设置截图。

安装包 artifact 中的 tgz 可通过 npm install --global --omit=dev --ignore-scripts 安装。此工作流不发布 npm 注册表，也不自动创建 GitHub Release。

## 版本与许可

修改发布版本时同步 package.json 和 package-lock.json 的根版本，更新变更记录。保留 LICENSE、THIRD_PARTY.md 和生成的 dist/THIRD_PARTY_LICENSES.txt。构建产物、个人配置、访问凭据及本地安装备份不提交到源码仓库。
