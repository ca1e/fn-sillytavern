# fn-sillytavern

[English](#english) | [中文](#中文)

---

## 中文

SillyTavern（酒馆）的飞牛 fnOS 原生应用封装。内置 SillyTavern **1.19.0** 完整源码，安装时通过 npm 安装依赖（可选国内镜像），面向高级用户的本地 LLM 角色扮演 / 对话创作前端。

参考 [fn-deepseek-harness](../fn-deepseek-harness) 与 [fn-memos](../fn-memos) 的应用模式实现。

### 功能特性

- 内置 SillyTavern 1.19.0，无需在 NAS 上手动 clone / 更新上游仓库
- 安装向导：监听端口、npm 镜像源、额外白名单网段
- 自动探测 NAS 所在网段（如 `192.168.1.0/24`）写入 SillyTavern 白名单，局域网免配置直接访问
- 安装时预编译前端（webpack），首次启动无需现场编译
- 数据（聊天记录、角色卡、世界书、设置）持久化在应用共享目录 `fn-sillytavern` 中，升级自动保留
- 卸载时可选保留或删除数据

### 访问方式

安装完成后，通过 fnOS 桌面的 **SillyTavern** 图标打开（浏览器直接访问 `http://NAS地址:端口`，默认端口 `8000`）。

> **注意**：本应用不走 fnOS 统一网关，而是直连端口（SillyTavern 前端大量使用绝对路径，无法挂载在 `/app/xxx` 子路径下）。如果你使用 **HTTPS** 访问飞牛桌面，浏览器会拦截 HTTP 方式的 iframe 页面——请改用 HTTP 访问飞牛桌面，或在浏览器站点设置中允许"不安全内容"。

### 安装

```bash
# 在 fnOS 上通过 appcenter-cli 安装本地 fpk
appcenter-cli install-fpk fn-sillytavern.fpk

# 或开启手动安装入口后，在应用中心上传 fpk
appcenter-cli manual-install enable
```

安装向导字段：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| 监听端口 | 8000 | SillyTavern 监听端口，桌面图标使用该端口打开 |
| 额外白名单 | 空 | 除 NAS 所在网段外放行的 IP/CIDR，逗号分隔 |
| npm 镜像源 | 官方源 | 安装依赖时使用；国内网络建议 taobao |

安装过程需要联网执行 `npm install`（约 1-3 分钟，视网络而定）。

### 数据位置

| 内容 | 路径 |
|------|------|
| 用户数据（聊天/角色/设置） | 共享目录 `fn-sillytavern/data/` |
| SillyTavern 配置 | 共享目录 `fn-sillytavern/config/config.yaml` |
| 运行日志 | `/var/apps/fn-sillytavern/var/info.log` |
| npm 缓存 | `/var/apps/fn-sillytavern/home/.npm-cache/` |

访问控制由 SillyTavern 白名单实现（`config.yaml` 的 `whitelist` 字段，支持 CIDR）。需要更精细的控制（如 basicAuth）可直接编辑共享目录中的 `config.yaml` 后重启应用。

### 升级与卸载

- **升级**：直接安装新版 fpk。用户数据在共享目录中自动保留；若新版 SillyTavern 依赖有变化，升级回调会自动补装依赖。
- **卸载**：卸载向导中可选择"保留数据"（推荐，日后重装可继续使用）或"删除数据"（清空共享目录）。

### 构建

```bash
# Linux（x86_64）机器上：下载 SillyTavern 源码并打包 fpk
./build.sh              # 默认 1.19.0
./build.sh 1.20.0       # 指定 SillyTavern 版本

# macOS / Windows：仅装载源码（app/sillytavern/），不打包
# 完整打包请推送到 GitHub 触发 .github/workflows/build-fpk.yml
```

- 源码默认经 `https://gh-proxy.com` 加速下载，可用 `GH_PROXY=...` 覆盖
- fnpack CLI（fnOS 打包工具）在 Linux 上自动从飞牛官方地址下载，可用 `FNPACK_URL=...` 覆盖
- 发布：推送 `v*` tag 触发 CI 构建并附到 GitHub Release
- **版本约定**：应用版本与所捆绑的 SillyTavern 版本保持一致（如 `1.19.0`），升级 SillyTavern 时同步修改 `manifest` 的 `version` 与 `build.sh` 的 `ST_VERSION`

### 排障

| 现象 | 处理 |
|------|------|
| 安装卡在依赖安装 | 查看 `/var/apps/fn-sillytavern/var/info.log`；多为网络问题，重装并换 npm 镜像源 |
| 桌面图标打开空白 | 应用可能仍在启动，稍等刷新；或确认浏览器能访问 `http://NAS:端口` |
| 页面提示 403 Forbidden | 你的 IP 不在白名单内，在应用配置页追加网段后保存 |
| 改了端口打不开 | 配置向导保存后会自动重启；确认新端口未被占用且浏览器地址已更新 |

### 安全须知

- SillyTavern 的白名单是唯一访问控制，**不要**将端口暴露到公网；如需远程使用，建议通过 VPN / Tailscale 等组网方式，并在白名单中放行对应网段
- 各家 LLM 的 API Key 保存在 NAS 本地（`data/` 目录），请确保 NAS 及局域网环境可信
- 本应用按 AGPL-3.0 分发，SillyTavern 版权归其作者所有

---

## English

Native fnOS packaging for [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.19.0, modeled after the `fn-deepseek-harness` / `fn-memos` app patterns in this repository.

- Bundles the full SillyTavern source; dependencies are installed via npm during app install (mirror selectable in the wizard)
- Direct-port access (SillyTavern uses absolute URLs and cannot be mounted under a sub-path): the desktop icon opens `http://<NAS>:<port>/`
- Auto-detects the NAS subnet and writes it into the SillyTavern whitelist; extra CIDRs configurable in the wizard
- Frontend (webpack) is pre-compiled at install time so the first start is fast
- User data persists in the `fn-sillytavern` share across upgrades; uninstall wizard offers keep/remove

Build: `./build.sh [st-version]` on Linux (fnpack is fetched automatically), or push a `v*` tag for CI. Logs: `/var/apps/fn-sillytavern/var/info.log`.
