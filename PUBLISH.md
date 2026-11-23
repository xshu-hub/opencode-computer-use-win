# 构建与交付

本仓库面向 OpenCode V1。原 DSH 市场发布说明已归档到 docs/reference/PUBLISH.dsh.md，不适用于当前包。

## 本地验证

~~~powershell
npm ci --ignore-scripts
npm run build
npm run build:native
node scripts/check-build.mjs
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

## npm 发布

首次发布前登录 npm 并按账号要求完成双因素验证。确认目标版本未发布，且对应代码已通过 Windows CI。

~~~powershell
npm login --registry=https://registry.npmjs.org
npm publish --dry-run --access public --registry=https://registry.npmjs.org
npm pack
npm publish .\opencode-computer-use-win-0.2.0.tgz --access public --registry=https://registry.npmjs.org
npm view opencode-computer-use-win@0.2.0 version dist.integrity --registry=https://registry.npmjs.org
~~~

发布命令应使用本次构建并验证过的 tgz；版本变化时替换命令中的版本。发布后在独立目录从注册表安装并运行 test/package-smoke.mjs 验证。已发布的同名同版本不能覆盖。凭据保留在 npm 登录环境中，不写入仓库或工作流。

## 版本与许可

修改发布版本时同步 package.json 和 package-lock.json 的根版本，更新变更记录。保留 LICENSE、THIRD_PARTY.md 和生成的 dist/THIRD_PARTY_LICENSES.txt。构建产物、个人配置、访问凭据及本地安装备份不提交到源码仓库。
