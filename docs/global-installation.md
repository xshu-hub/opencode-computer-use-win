# OpenCode V1 全局安装与升级

## 获取安装包

推荐从公共 npm 注册表安装：

~~~powershell
npm install --global opencode-computer-use-win --registry=https://registry.npmjs.org
npm root --global
~~~

安装完成后按下文获取入口并配置。也可以使用构建产出的 tgz：

在仓库 Actions 页面打开成功的 OpenCode Windows plugin 构建，下载 opencode-computer-use-win artifact。解压外层 artifact 后可得到 opencode-computer-use-win-VERSION.tgz。

~~~powershell
npm install --global --omit=dev --ignore-scripts .\opencode-computer-use-win-0.2.0.tgz
npm root --global
~~~

源码 0.2.0 同步上游 0.6.3；npm 命令安装的是已发布版本。使用尚未发布的源码版本时，先构建 tgz 再安装。

## 按包名配置（npm 版本）

在 ~/.config/opencode/opencode.json(c) 的 plugin 数组中添加服务入口：

~~~json
{"plugin":[["opencode-computer-use-win",{"locale":"zh"}]]}
~~~

在同目录 tui.json 的 plugin 数组中添加 TUI 入口：

~~~json
{"plugin":["opencode-computer-use-win"]}
~~~

两处使用同一个包名，OpenCode 根据入口类型选择 server 或 tui。需要固定版本时，两处均添加相同的 @版本号。按包名加载时 OpenCode 管理自己的依赖缓存；npm 全局安装主要提供 opencode-cu 命令。已有同插件的 file URI 条目时替换它，保留其他配置。

## 本地 tgz 或源码配置

本地未发布版本通过绝对文件入口加载。通过 PowerShell 获取当前全局安装入口的 file URI：

~~~powershell
$pluginRoot = Join-Path (npm root --global) 'opencode-computer-use-win'
[System.Uri]::new((Join-Path $pluginRoot 'opencode/plugin.mjs')).AbsoluteUri
[System.Uri]::new((Join-Path $pluginRoot 'opencode/tui.mjs')).AbsoluteUri
~~~

备份已有 OpenCode 配置，再将第一个 URI 追加到 ~/.config/opencode/opencode.json(c) 的 plugin 数组，将第二个 URI 追加到同目录 tui.json 的 plugin 数组。Windows 的 ~ 指用户目录；设置 XDG_CONFIG_HOME 时按 OpenCode 自己的配置目录规则处理。

服务插件可以使用元组形式指定中文：

~~~json
{
  "plugin": [
    ["file:///C:/path/to/opencode-computer-use-win/opencode/plugin.mjs", {"locale":"zh"}]
  ]
}
~~~

TUI 入口使用文件 URI：

~~~json
{
  "plugin": [
    "file:///C:/path/to/opencode-computer-use-win/opencode/tui.mjs"
  ]
}
~~~

其他插件和 MCP 配置照常保留。若已有手动 mcp.wincu 配置，先备份并移除；本插件会创建托管连接。不要同时注册源码版本与安装包版本。

## 验证

在没有项目本地配置的新目录打开 OpenCode，通过 MCP 列表确认 wincu 为 connected。输入 /computer-use，或使用命令面板的“电脑操控设置”入口。应只出现一个对应斜杠命令。

OpenCode 运行时，终端命令 opencode-cu settings 会查找当前项目的设置服务；未找到匹配项目时使用最近的活动服务。设置工具 computer_use_settings 对其他客户端可用。

## 升级与回滚

安装新的 tgz 后重启已有 OpenCode 实例，并刷新设置页面。设置数据保存在 %LOCALAPPDATA%\opencode-computer-use-win，独立于包目录。

Windows 可能因活动 worker 的当前目录而拒绝替换安装目录并报告 EBUSY。先结束使用该插件的 OpenCode 实例，再执行安装。升级前保留旧 tgz 和配置备份；回滚时重新安装旧包并恢复需要的配置。

设置页的“检查更新”只查询本插件的 npm 版本，“下载诊断”只下载经过脱敏的 TXT。不会调用 DSH 插件市场或替你重启 OpenCode。按包名加载时更新配置中的固定版本并重启；使用全局文件入口时更新 npm 安装后重启。

0.1.1 起，/computer-use 只由 TUI 注册，直接打开设置，不发起模型请求。0.1.2 起，设置页顶部不再展示参考项目与反馈栏。来源及 MIT 归属保留在 README.md、LICENSE 和 THIRD_PARTY.md。

本插件不修改 OpenCode 本体。V2 宿主和原生 GUI 设置页尚未适配。
