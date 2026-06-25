# Chartero

Chartero 是一个 Zotero 插件，用于记录和可视化文献阅读情况。

## 功能

- 记录阅读页码、阅读时间和阅读进度。
- 在文库列表中显示阅读进度列。
- 在阅读器侧边栏显示仪表盘、统计图和文档图片。
- 提供文库概览、阅读统计、文献关系等可视化页面。
- 支持 Zotero 9 到 10.1。

## 安装

从发布页下载 `chartero.xpi`：

- GitHub: https://github.com/JuanZhio/Chartero/releases

在 Zotero 中打开：

```text
工具 -> 插件 -> 从文件安装插件
```

选择下载的 `chartero.xpi`，安装后重启 Zotero。

## 本地构建

安装依赖：

```bash
npm install
```

构建插件：

```bash
npm run build
```

构建产物位于：

```text
build/chartero.xpi
```

开发构建：

```bash
npm run build-dev
```

监听构建：

```bash
npm run build-watch
```

Vue 测试页面：

```bash
npm run dev
```

质量检查：

```bash
npm run lint
npm run typecheck
npm test
```

`typecheck` 会检查 `worker`、`bootstrap`、`tools` 和 `vue` 四部分。发布或提交较大改动前建议同时运行：

```bash
npm run build
```

## 目录结构

```text
addon/        插件静态资源和 manifest
src/bootstrap 插件主逻辑
src/vue       Vue 页面
src/worker    后台数据处理
tools/        构建和发布脚本
build/        构建输出目录
doc/          截图和文档资源
```

## 配置

默认设置位于 `package.json` 的 `config.defaultSettings`。

常用 npm 脚本：

```text
npm run build             生产构建完整插件
npm run build-dev         开发构建完整插件
npm run build-bootstrap   仅构建插件 bootstrap 部分
npm run build-watch       监听构建
npm run dev               启动 Vue 测试页面
npm run lint              运行 Biome lint
npm run typecheck         运行全部 TypeScript 类型检查
npm test                  运行阅读历史核心测试
```

插件 ID：

```text
chartero@volatile.static
```

自动更新地址：

```text
https://github.com/JuanZhio/Chartero/releases/download/update/update.json
```

## 问题反馈

- GitHub Issues: https://github.com/JuanZhio/Chartero/issues

## 许可证

Apache-2.0，详见 `LICENSE`。
