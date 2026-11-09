# DSH HTML Preview

DeepSeek Harness 聊天 HTML 预览插件。将助手回复中最后一个完整的 `html` 代码块显示为交互式卡片，并隐藏对应的源码代码块。

已在 DSH `0.2.1-rc.5` 验证；其他版本需要核对 Cordis 服务和聊天插槽接口。

## 功能

- 在聊天回合末尾显示 HTML 预览，支持页面内 JavaScript。
- 不重复展示被预览的 HTML 源码。
- 卡片右上角 `⋯` 菜单提供 **保存为 HTML** 和 **保存为 PNG**。
- 保存到点击时的当前会话工作目录，使用标题与 UUID 生成文件名，避免覆盖已有文件。
- 显示保存进度、完整文件路径和失败原因。
- Host 提供 `htmlOutputSaver` 服务、`/html-output-save` 命令和 `html_output_save` 工具，复用同一保存逻辑。

## 安装

```sh
git clone https://github.com/chajiuqqq/dsh-html-preview.git
```

在 DSH 中请助手通过 `plugin_manager` 安装克隆目录的**绝对路径**，例如：

> 安装本地插件 /absolute/path/to/dsh-html-preview

仓库包含已构建的 `client.js`；安装时无需手动构建。依赖由插件管理器处理。

Bundle 会关闭旧的 `ui-html-output` 插件条目，并注册以下条目：

- `ui-html-output-compat`：聊天预览卡片。
- `html-output-save`：HTML / PNG 保存后端。

包名保留为 `@local/dsh-html-output-client-compat`，以兼容现有安装。

## 使用

让助手返回完整的 HTML 代码块即可：

````markdown
```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>示例卡片</title></head>
<body><h1>Hello DSH</h1><p>点击右上角 ⋯ 导出。</p></body>
</html>
```
````

HTML 导出保留页面文档；PNG 导出使用卡片当前宽度和页面完整高度，通过内嵌的 html2canvas 渲染。

## 开发

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

修改 `client-source.js` 后执行构建，不要直接修改生成的 `client.js`。提交时同时更新生成文件。

主要文件：

- `client-source.js`：预览、源码隐藏、导出菜单及浏览器 PNG 渲染。
- `client.js`：内嵌 html2canvas 的构建产物，不依赖 CDN。
- `save-host.js`：保存服务、命令和工具，遵循当前会话文件沙箱策略。
- `build.js`：客户端打包脚本。
- `cordis.patch.yml`：插件组合。
- `client-regression.test.mjs`：保存接口响应解析的回归测试。

## 实现说明与限制

- 预览使用独立不透明来源的 `data:` iframe，并设置 `allow-scripts allow-same-origin`。它允许 html2canvas 访问自己的临时子帧，同时保持与 DSH 主页面跨源。**不要将这个组合直接改成 `srcDoc` 或宿主来源的 Blob URL**。
- PNG 请求通过 `postMessage` 传递，父页面校验消息来源窗口和请求编号。请求编号不依赖仅在安全上下文可用的 `crypto.randomUUID()`。
- 保存接口正确解包 DSH RPC 的 `{ ok, value }` 返回值后，再读取 `value.result`。
- HTML 内容最大 2 MiB。PNG 渲染限制为 2400 万像素和 20000 像素高度，并有 30 秒响应超时。
- html2canvas 对部分复杂 CSS、跨域图片、视频和嵌入页面存在限制；导出结果不等同于浏览器原生截图。
- PNG 写入通过会话的 shell 沙箱执行，需要执行环境提供 `node` 命令。
- 当前每个回合只预览最后一个完整 HTML 代码块；源码隐藏依赖当前 DSH 聊天 DOM 结构，升级 DSH 后应复核。

## 第三方许可

PNG 渲染使用 [html2canvas](https://github.com/niklasvh/html2canvas) 1.4.1，遵循 MIT 许可证。许可证副本见 `html2canvas-LICENSE`。
