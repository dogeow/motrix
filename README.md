# Motrix

一个基于 Tauri、React 和 aria2 的轻量跨平台下载管理器，支持 HTTP、FTP、BitTorrent、磁力链接和种子文件。

> [!IMPORTANT]
> 本项目源自 [agalwood/Motrix](https://github.com/agalwood/Motrix)，是以 Tauri + React 重新实现的版本。产品设计、功能思路以及随应用分发的 aria2c sidecar 均参考或来自原 Motrix。当前仓库采用独立 Git 历史，因此 GitHub 页面不会显示为 Fork；这不改变项目与原 Motrix 的来源关系。

## 下载

安装包可从 [GitHub Releases](https://github.com/dogeow/motrix/releases) 获取。

支持的平台：

- macOS：Apple Silicon、Intel
- Windows：x86_64
- Linux：x86_64

## 功能

- 任务管理：全部、下载中、等待中和已停止任务，支持按状态筛选、搜索、自然名称排序和多选批量操作
- 添加任务：HTTP、HTTPS、FTP、磁力链接、种子文件、拖放 `.torrent` 和剪贴板监听
- BT 下载：多文件选择、节点与连接详情、Tracker 自动更新、UPnP 和做种比例
- 跨客户端下载续传：可校验 Folx 等其他客户端下载的同一种子数据，只补齐缺失或损坏的数据块
- 下载控制：全局下载和上传限速、并发数、连接数和分片数
- 系统集成：系统托盘、macOS Dock 进度和速度、完成通知、开机启动、深链和文件关联
- 外观与语言：浅色、深色、跟随系统；简体中文和英文
- 大量任务：列表按可见区域渲染并测量实际行高，刷新保留滚动位置，减少无变化任务的重复渲染
- 文件选择：保留未保存的修改，支持保存期间继续编辑，慢速刷新不会覆盖选择
- 稳定性：aria2 异常退出后自动重启，任务会话和 DHT 数据持久化
- 自动更新：GitHub Actions 构建多平台安装包，通过签名的 `latest.json` 检查并安装更新

## 技术架构

- **桌面层**：Tauri 2 / Rust
  - 管理 aria2c sidecar 生命周期、随机本地 RPC 端口和密钥
  - 负责系统托盘、Dock、窗口状态、深链、文件关联和安全删除
  - 应用退出时先通过 RPC 请求 aria2 保存会话并关闭，再执行兜底终止
- **界面层**：React 19 / TypeScript / Vite 7 / Tailwind CSS v4 / shadcn / Zustand
  - 通过本地 WebSocket JSON-RPC 直接操作 aria2
  - 使用 aria2 事件通知和定时轮询刷新任务状态
  - 页面由 `components/app`、`components/preferences` 与 `hooks` 分层组合
  - 限速、筛选和排序等纯逻辑位于 `lib`，使用 Vitest 单元测试保护
- **下载引擎**：[aria2](https://github.com/aria2/aria2)
  - sidecar 位于 `src-tauri/binaries/`
  - 静态配置位于 `src-tauri/resources/aria2.conf`
  - 动态端口、密钥、目录和限速由 Rust 启动参数覆盖

macOS 数据目录：

```text
~/Library/Application Support/com.dogeow.motrix/
```

## 开发

需要 Node.js 22、Rust stable 和 Tauri 对应平台的系统依赖。

```bash
npm install
npm run tauri dev
```

前端构建：

```bash
npm run build
```

提交前质量检查（ESLint、TypeScript、Vitest）：

```bash
npm run check
```

桌面安装包：

```bash
npm run tauri build
```

## Sidecar

`src-tauri/binaries/` 中的 aria2c 按 Tauri target triple 命名：

- `aria2c-aarch64-apple-darwin`
- `aria2c-x86_64-apple-darwin`
- `aria2c-aarch64-unknown-linux-gnu`
- `aria2c-x86_64-unknown-linux-gnu`
- `aria2c-x86_64-pc-windows-msvc.exe`

这些二进制来自原 [Motrix](https://github.com/agalwood/Motrix) 项目使用的 aria2 构建。

## 发布与自动更新

更新包使用 minisign 签名。公钥位于 `src-tauri/tauri.conf.json`，签名私钥只保存在本机和 GitHub Actions Secrets 中，不得提交到仓库。

现有更新签名链继续使用同一把私钥；本机文件沿用更名前的历史文件名：

```text
~/.tauri/motrix-tauri.key
```

GitHub Actions 需要以下 Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：签名私钥文件的完整内容
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：未设置密码时留空

推送版本标签后，`.github/workflows/release.yml` 会构建各平台安装包、签名文件和 `latest.json`：

```bash
npm version patch
git push --follow-tags
```

工作流默认创建草稿 Release，检查构建产物后再手动发布。

普通分支推送和 Pull Request 会先由 `.github/workflows/ci.yml` 检查前端代码、单元测试、生产构建、Rust 格式和 Rust 测试。

更新端点：

```text
https://github.com/dogeow/motrix/releases/latest/download/latest.json
```

## 项目来源与致谢

- [agalwood/Motrix](https://github.com/agalwood/Motrix)：本项目的来源，采用 MIT License
- [aria2/aria2](https://github.com/aria2/aria2)：下载引擎，采用 GPL-2.0 License
- [ngosang/trackerslist](https://github.com/ngosang/trackerslist)：公共 BitTorrent Tracker 列表

本仓库不是原 Motrix 的官方后续版本，与原项目维护者不存在隶属关系。
