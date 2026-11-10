# DSH SVG / HTML Preview

DeepSeek Harness 聊天图表预览插件。将助手回复中的 `svg` / `html` 代码块原位替换为预览卡片，保留前后文字顺序，支持同一条回复中的多张图表。

默认引导模型用 Markdown 回答普通问题，用独立 SVG 绘制流程图、架构图等静态图表；仅在用户要求网页或交互 HTML 时生成完整 HTML。

目标运行环境：DSH `0.2.1-rc.5`。HTML 预览与导出曾人工验证；图表识别、后端保存和在线插件注册已验证。原位卡片依赖宿主 DOM 标记，浏览器排版与 PNG 点击导出仍需人工验收。

## 功能

- SVG 作为独立图片直接显示在聊天卡片中，宽度随聊天布局变化，高度保持原始比例；不需要 HTML 包装或固定高度 iframe。
- SVG 菜单：**保存为 SVG**、**保存为 PNG**。
- HTML 菜单：**保存为 HTML**、**保存为 PNG**，保留隔离的交互式网页预览。
- 保存到点击时的当前会话工作目录，文件名带 UUID，避免覆盖已有文件。
- 保存操作复用 Host 服务，同时向 UI 命令和 Agent 工具开放：`htmlOutputSaver` / `html_output_save`、`svgOutputSaver` / `svg_output_save`。

## 安装

```sh
git clone https://github.com/chajiuqqq/dsh-html-preview.git
```

在 DSH 中请助手通过 `plugin_manager` 安装克隆目录的**绝对路径**，例如：

> 安装本地插件 /absolute/path/to/dsh-html-preview

仓库包含已构建的 `client.js`；安装时无需手动构建。依赖由插件管理器处理。

Bundle 会关闭原有 `html-output` 的完整 HTML 输出提示词和旧的 `ui-html-output` 渲染器，并注册：

- `svg-output`：Markdown / SVG 引导与 SVG 保存后端。
- `html-output-save`：HTML / PNG 保存后端。
- `ui-html-output-compat`：SVG / HTML 聊天预览。

包名保留为 `@local/dsh-html-output-client-compat`，以兼容现有安装。对已经安装的本地链接修改后，需要通过插件管理器重新加载 Bundle，并刷新聊天页面以加载新的客户端代码。

## 使用

让助手“用 SVG 画一个流程图”即可。无需调用工具来显示图表：

````markdown
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">
  <title>示例流程</title>
  <rect x="20" y="30" width="140" height="60" rx="12" fill="#e8eefb"/>
  <path d="M170 60H220M210 50L220 60L210 70" fill="none" stroke="#52617b" stroke-width="2"/>
  <rect x="240" y="30" width="140" height="60" rx="12" fill="#e6f3ed"/>
  <g font-family="sans-serif" font-size="18" text-anchor="middle" fill="#223047">
    <text x="90" y="67">输入</text><text x="310" y="67">结果</text>
  </g>
</svg>
```
````

使用原生 SVG 的形状、路径和文字，包含 `xmlns` 和 `viewBox`，避免脚本、`foreignObject` 和外部资源。无效 XML 会显示错误并保留源码，方便修正。纯 SVG 放在 `html` 围栏中也会识别为 SVG。

## 开发

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

修改 `client-source.js` 后执行构建，不要直接修改生成的 `client.js`。提交时同时更新生成文件。

- `client-source.js`：定位宿主代码块、原位卡片、菜单及浏览器 PNG 渲染。
- `client.js`：内嵌 html2canvas 的构建产物，不依赖 CDN。
- `save-host.js`：HTML / PNG 保存服务，遵循当前会话文件沙箱策略。
- `svg-host.js`：SVG 优先提示词与 SVG 保存服务。
- `build.js`：客户端打包脚本。
- `cordis.patch.yml`：插件组合。
- `client-regression.test.mjs`：图表识别、标题提取、宿主标记契约、保存参数、会话目录和接口响应解析的回归测试。

## 实现说明与限制

- SVG 使用 `data:image/svg+xml` 图片，不把生成内容注入主页面 DOM；浏览器图片模式不执行 SVG 脚本，也不加载外部资源。SVG 导出会补全尺寸和 `viewBox`；PNG 通过浏览器原生 Canvas 转换，宽度在 600–1600 像素之间，保持比例并使用白色背景。
- HTML 使用独立不透明来源的 `data:` iframe，设置 `allow-scripts allow-same-origin`，使 html2canvas 能访问自己的临时子帧，同时保持与 DSH 主页面跨源。**不要直接改成 `srcDoc` 或宿主来源 Blob URL**。
- HTML PNG 请求通过 `postMessage` 传递，父页面校验来源窗口和请求编号；保存接口先解包 RPC 的 `{ ok, value }`，再读取 `value.result`。
- HTML 和 SVG 文本最大 2 MiB。PNG 限制为 2400 万像素和 20000 像素高度，并有 30 秒渲染超时。
- html2canvas 对复杂 CSS、跨域图片、视频等存在限制；HTML 导出结果不等同于浏览器原生截图。
- PNG 写入通过会话的 shell 沙箱执行，需要执行环境提供 `node` 命令。
- 原位渲染通过宿主自己的代码块标记定位：`div.md-code-block` 内的 `[data-code-block-banner]`（语言）与 `[data-code-block-content] pre`（源码）。卡片插入该代码块之前，并隐藏代码块，因此文字顺序与原生 Markdown 完全一致。
- 插件**不能**遮蔽 `conversation.chat.node` 的 `assistant-step` 渲染器：keyed 插槽要求同键条目使用不同优先级，而 `register` 在条目声明的子插槽已被声明时会抛出 `slot "…" is already declared`，正文渲染器正是 `reasoning.body` 与 `message.images` 的声明者。因此原位渲染必须直接操作 DOM，本机已安装的 `dsh-mermaid` 也采用同一做法。
- 只有当 SVG 能完整解析时才替换代码块；流式过程中的半截 SVG 或无效 SVG 继续显示源码。HTML 无语法校验，按围栏语言直接替换。
- 保存动作需要一个会话 ID，客户端只能从插槽条目的 props 获得，因此保留一个不渲染任何内容的 `turnTail` 条目（`html-output-preview-compat`）作为会话来源，并可用于只读插槽检查确认插件是否加载。
- DOM 结构变化时卡片会重建（`MutationObserver` + 60ms 合并），代码块内容变化时卡片重建；插件卸载时移除卡片并恢复源码显示。DSH 升级后应复核上述标记。

## 第三方许可

HTML 的 PNG 渲染使用 [html2canvas](https://github.com/niklasvh/html2canvas) 1.4.1，遵循 MIT 许可证。许可证副本见 `html2canvas-LICENSE`。
