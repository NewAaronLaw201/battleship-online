# 军舰小游戏 (Battleship Online)

[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.19-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/socket.io-4.7-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](#license)
[![Tests](https://img.shields.io/badge/tests-passing-success)](#测试)

一个支持房间创建/加入、双方准备、手动军舰摆放、随机先手、回合制攻击、命中/落空同步、单船摧毁提示和胜负判定的 **11x11 双人联机战舰小游戏**。核心采用可扩展的 **Action / Item** 架构，方便后续加入探测、区域攻击、干扰、护盾等道具。

> 在线体验: https://battleship.snowlilyking.cc

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [系统架构](#系统架构)
- [游戏玩法详解](#游戏玩法详解)
  - [舰队配置](#舰队配置)
  - [房间系统](#房间系统)
  - [军舰摆放阶段](#军舰摆放阶段)
  - [战斗阶段](#战斗阶段)
  - [胜负判定](#胜负判定)
- [特色系统](#特色系统)
  - [ActionRegistry 可扩展行动系统](#actionregistry-可扩展行动系统)
  - [道具背包（预留）](#道具背包预留)
  - [安全信息隔离](#安全信息隔离)
  - [游戏重置与重开](#游戏重置与重开)
- [操作指南](#操作指南)
  - [创建/加入房间](#创建加入房间)
  - [摆放军舰](#摆放军舰)
  - [攻击操作](#攻击操作)
- [注意事项](#注意事项)
- [环境要求](#环境要求)
- [安装](#安装)
- [运行](#运行)
- [部署到 VPS](#部署到-vps)
- [项目结构](#项目结构)
- [测试](#测试)
- [扩展开发](#扩展开发)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)
- [联系方式](#联系方式)

---

## 项目简介

本项目是一个使用 **Node.js + Express + Socket.IO** 实现的双人联机战舰（Battleship）小游戏。两位玩家在浏览器中进入同一房间后，依次手动放置自己的舰队、准备开战，系统随机决定先手，随后按回合制进行攻击，先击沉对方全部 5 艘军舰的一方获胜。

游戏的客户端提交是 **行动 (Action)** 而非固定的"普通攻击"，后端通过 `actionRegistry` 派发到对应处理器；返回结果中包含 `keepTurn / events / publicResult` 等字段，便于将来实现连续行动、区域效果、临时信息揭示和跳过回合等高级机制。

## 功能特性

- 11x11 双方对战棋盘
- 房间号创建与加入（6位十六进制房间号）
- 手动摆放 5 艘军舰（长度 2/3/3/4/5），支持横/纵向
- 横向/纵向放置校验，禁止越界和重叠
- 双方准备后随机决定先手
- 左侧己方棋盘（含敌方攻击标记、被摧毁军舰高亮）+ 右侧敌方未知棋盘
- 命中可继续攻击，落空则切换回合
- 单艘军舰被完全命中后展示摧毁提示与特殊高亮
- 所有军舰被摧毁后游戏结束，可一键重开
- 预留 `inventory`（道具背包）和 Action Registry，便于扩展
- 内置基于 `node:test` 的核心规则单元测试
- 支持断线/退出检测，对手离开自动广播
- 移动端触摸操作适配

## 系统架构

```
┌────────────────┐    Socket.IO    ┌────────────────────────┐    Socket.IO    ┌────────────────┐
│  玩家 A 浏览器 │ ◀─────────────▶ │   Node.js 游戏服务端   │ ◀─────────────▶ │  玩家 B 浏览器 │
│  (client.js)   │     events      │  (server.js + engine)  │     events      │  (client.js)   │
└────────────────┘                 └────────────────────────┘                 └────────────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────────┐
                                       │   gameEngine +         │
                                       │   actionRegistry       │
                                       │   (房间/回合/胜负)      │
                                       └────────────────────────┘
```

单回合数据流：

```
客户端发起行动 (action)
   │
   ▼
服务端校验 + 派发 ActionHandler
   │
   ├── 更新房间状态（命中/落空/摧毁/胜负）
   │
   ├── 广播 publicResult（双方可见）
   │
   ├── 广播 privateResult（仅攻击方/防守方分别可见）
   │
   └── 返回 keepTurn → 控制是否切换当前回合
```

---

## 游戏玩法详解

### 舰队配置

每位玩家拥有 5 艘军舰，总长度 17 格：

| 编号 | 内部 ID | 名称 | 长度 |
|------|---------|------|------|
| 1 | `ship-2-1` | 巡逻艇 | 2 |
| 2 | `ship-3-1` | 驱逐舰 A | 3 |
| 3 | `ship-3-2` | 驱逐舰 B | 3 |
| 4 | `ship-4-1` | 战列舰 | 4 |
| 5 | `ship-5-1` | 航空母舰 | 5 |

### 房间系统

| 阶段 | 说明 |
|------|------|
| `waiting` | 等待第二名玩家加入 |
| `placing` | 军舰摆放阶段 |
| `battle` | 战斗阶段 |
| `finished` | 游戏结束 |

- **创建房间**：生成 6 位十六进制大写房间号（如 `A1B2C3`）
- **加入房间**：输入房间号，不区分大小写
- **退出房间**：主动离开或断线后，对手收到通知，房间重置为 `waiting` 状态
- **重置游戏**：一局结束后，房主可发起重置，回到 `placing` 阶段重新摆放

### 军舰摆放阶段

- 在左侧面板选中军舰，点击己方棋盘放置
- 方向按钮切换横/纵：横向从左向右延伸，纵向从上向下延伸
- **越界检测**：超出 11x11 范围禁止放置
- **重叠检测**：军舰之间不可重叠，可相邻
- **取消放置**：点击已放置军舰的"首格"取消该军舰
- **移动军舰**：点击已放置军舰的"非首格"，以该格为新起点移动（若移动非法则自动取消）
- **重置**：一键清空所有已放置军舰
- 全部 5 艘军舰摆放完成后，点击"准备"；双方准备后自动进入战斗

### 战斗阶段

- 双方准备后随机决定先手
- 当前回合玩家在右侧攻击棋盘点击未攻击过的格子发起攻击
- **命中**：该格标记为命中（红色），保留回合权，可继续攻击
- **落空**：该格标记为落空（蓝色），回合切换给对手
- **摧毁提示**：某艘军舰的所有格子都被命中后，双方均收到该军舰被摧毁的提示，且该军舰在棋盘上以特殊高亮样式显示

### 胜负判定

- 当一方全部 5 艘军舰被击沉时，游戏结束
- 击沉全部军舰的一方获胜
- 失败方收到"我方全部军舰已被摧毁"提示
- 游戏结束后显示"下一局"按钮，可立即重开新局

---

## 特色系统

### ActionRegistry 可扩展行动系统

当前攻击并非写死的"点击坐标"，而是通过 **ActionRegistry** 注册的行动处理器：

```json
{
  "type": "basic_attack",
  "payload": { "x": 3, "y": 5 }
}
```

Action Handler 返回结构化结果：

```json
{
  "keepTurn": true,
  "winnerId": null,
  "publicResult": {
    "type": "attack_result",
    "cell": { "x": 3, "y": 5 },
    "hit": true,
    "sunkShip": { "id": "ship-2-1", "label": "巡逻艇", "cells": [...] },
    "gameOver": false
  },
  "privateResultByPlayer": {
    "<attacker_id>": { "attackBoardMark": { "cell": ..., "result": "hit" } },
    "<defender_id>": { "ownBoardMark": { "cell": ..., "result": "hit" } }
  }
}
```

| 字段 | 说明 |
|------|------|
| `keepTurn` | 命中且游戏未结束时为 `true`，否则换边 |
| `winnerId` | 游戏结束时为攻击方 ID，否则 `null` |
| `publicResult` | 双方可见的攻击结果 |
| `privateResultByPlayer` | 仅攻击方和防守方分别可见的棋盘标记信息 |
| `sunkShip` | 击沉时返回该船完整信息（含 cells 和 orientation） |

### 道具背包（预留）

玩家状态中的 `inventory` 字段已预留，UI 侧已包含道具面板（当前显示"暂无道具"）。后续可轻松接入：

- `area_attack`：区域攻击
- `scan`：探测区域
- `jam`：干扰对方行动
- `shield`：护盾防御
- `skip_turn`：跳过对方回合

### 安全信息隔离

服务端在序列化房间状态时，严格区分可见信息：

| 信息类型 | 己方可见 | 对手可见 |
|---------|---------|---------|
| 己方船只完整信息 | ✅ | ❌（仅数量、剩余数） |
| 对手船只完整信息 | ❌（仅数量、剩余数） | ❌ |
| 攻击坐标及命中/落空 | ✅ | ✅ |
| 被摧毁船只的高亮 | ✅ | ✅ |
| 游戏结束后对手船只 | ✅（完整） | ✅（完整） |

**重要安全机制**：`sunkShip.cells` 始终返回**防守方**（被攻击方）棋盘坐标。客户端需通过 `isAttacker` 守卫正确写入攻击棋盘的视觉集合，避免将我方坐标误显示在对手棋盘上。

### 游戏重置与重开

- 游戏结束（`finished` 阶段）后，任何一方点击"下一局"可重置游戏
- 重置会清空所有玩家数据（船只、攻击记录、命中/落空标记、道具），回到 `placing` 阶段
- 断线重连后房间自动销毁（单人情况下）或重置为 `waiting`

---

## 操作指南

### 创建/加入房间

1. 打开页面后，在顶部输入玩家昵称（可选，默认"玩家 1"）
2. 点击 **「创建房间」**，系统生成房间号并显示在信息栏
3. 另一名玩家在房间号输入框输入该编号，点击 **「加入房间」**
4. 双方进入军舰摆放阶段

### 摆放军舰

1. 在下方军舰选择栏中选中要摆放的军舰（显示为蓝色选中态）
2. 点击左侧己方棋盘放置；横向/纵向通过顶部按钮切换
3. 悬停在空白格子上会显示军舰放置预览（绿色合法/红色非法）
4. 点击已放置军舰的"首格"可取消该军舰；点击"非首格"可移动
5. 全部 5 艘军舰摆放完成后，「准备」按钮变为可用，点击即可准备

### 攻击操作

1. 双方准备后进入战斗阶段，信息栏显示"战斗开始"
2. 当前回合玩家在右侧攻击棋盘点击格子
3. 命中（红色）可继续攻击；落空（蓝色）自动切换回合
4. 摧毁对方军舰时弹出提示，且该军舰在棋盘上以高亮显示
5. 击沉全部 5 艘军舰即获胜
6. 游戏结束后点击"下一局"重开

---

## 注意事项

- **棋盘坐标系统**：内部使用 0-based 坐标（左上角为 `(0,0)`），UI 显示为 1-based（如 `(1,1)`）
- **Socket.IO 反代**：部署时 Nginx 必须配置 `Upgrade` 和 `Connection` 头，否则 WebSocket 会降级为轮询
- **端口权限**：生产环境建议 Node 监听 3000，通过 Nginx 反代到 80/443，避免以 root 运行 Node
- **CRLF 换行**：Windows 开发时 `deploy.sh` 使用 LF 换行符，通过 `.gitattributes` 控制
- **事件日志截断**：客户端事件日志最多保留 80 条，但 `sunkShipCells` Map 独立维护，确保摧毁视觉不因日志截断而丢失
- **断线处理**：玩家断线或刷新页面后，房间自动处理，对手收到"对手已离开"通知

---

## 环境要求

| 项目 | 版本要求 |
|------|---------|
| Node.js | `>= 18`（推荐 LTS 20/22） |
| npm | `>= 9`（随 Node 自带） |
| 操作系统 | Windows / macOS / Linux |
| 浏览器 | 任意支持 ES2020 的现代浏览器 |

## 安装

```bash
git clone https://github.com/NewAaronLaw201/battleship-online.git
cd battleship-online
npm install
```

## 运行

### 本地开发

```bash
npm run dev
# 访问 http://localhost:3000
```

### 生产模式

```bash
PORT=3000 npm start
```

### 运行测试

```bash
npm test
```

---

## 部署到 VPS

已配置 GitHub Actions 自动部署。首次在 VPS 上执行：

```bash
# 1. 安装环境
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git nginx certbot python3-certbot-nginx
npm install -g pm2

# 2. 拉取代码
mkdir -p /opt/battleship && cd /opt/battleship
git clone https://github.com/NewAaronLaw201/battleship-online.git .
npm install --production

# 3. 启动 PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# 4. 配置 Nginx
cp /opt/battleship/deploy/nginx.conf /etc/nginx/sites-available/battleship
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/battleship /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 5. 防火墙
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 6. HTTPS 证书
certbot --nginx -d battleship.snowlilyking.cc --non-interactive --agree-tos -m AaronLaw201@outlook.com
```

### GitHub Secrets 配置

在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|--------|------|
| `VPS_HOST` | VPS IP 或域名 |
| `VPS_USER` | SSH 用户（如 `root`） |
| `VPS_PORT` | SSH 端口（默认 22） |
| `VPS_SSH_KEY` | 可登录 VPS 的私钥全文 |

之后每次 `git push origin master` 会自动触发部署。

---

## 项目结构

```
.
├── src/
│   ├── server.js                # HTTP 服务和 Socket.IO 入口
│   ├── game/
│   │   ├── constants.js         # 棋盘大小、舰队配置、房间阶段、行动类型
│   │   ├── gameEngine.js        # 房间、玩家、回合、胜负等核心状态机
│   │   ├── validators.js        # 坐标合法性、军舰摆放、攻击校验
│   │   └── actions/
│   │       ├── actionRegistry.js# 行动处理器注册表
│   │       └── basicAttack.js   # 普通单格攻击处理器
│   └── public/
│       ├── index.html           # 游戏界面（响应式布局）
│       ├── styles.css           # 界面样式
│       └── client.js            # 前端交互、Socket 事件、棋盘渲染
├── test/
│   └── gameEngine.test.js       # 核心规则单元测试
├── deploy/
│   └── nginx.conf               # Nginx 生产配置（含 HTTPS）
├── ecosystem.config.js          # PM2 进程管理配置
├── deploy.sh                    # VPS 端自动部署脚本
├── .github/workflows/
│   └── deploy.yml               # GitHub Actions 部署工作流
├── .gitattributes               # 控制文件换行符
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

---

## 测试

```bash
npm test
```

使用 Node 内置的 [`node:test`](https://nodejs.org/api/test.html) 运行。当前覆盖：

- 双方摆放合法舰队后进入战斗
- 11x11 棋盘序列化
- 重叠军舰拒绝放置
- 落空切换回合、命中保留回合
- 击沉船只的 `sunkShip.cells` 坐标属于防守方棋盘（非攻击方）

---

## 扩展开发

得益于 Action / Item 架构，新增玩法只需：

1. 在 `src/game/actions/` 下创建新的 ActionHandler：

```js
// src/game/actions/areaAttack.js
const { assertAttackCell, cellKey } = require("../validators");

function areaAttack(context, payload) {
  const { actor, target } = context;
  const center = { x: payload.x, y: payload.y };
  assertAttackCell(center);
  // ... 实现区域攻击逻辑
  return {
    keepTurn: false,
    winnerId: null,
    publicResult: { type: "area_attack_result", cells: [...], hits: [...] }
  };
}

module.exports = { areaAttack };
```

2. 在 `actionRegistry.js` 中注册：

```js
registry.register("area_attack", areaAttack);
```

3. 客户端在 `client.js` 中按相同 `type` 提交行动即可。

---

## 路线图

- [ ] 道具背包（Inventory）UI 与后端事件（区域攻击、探测、干扰、护盾）
- [ ] 房间断线重连与观战模式
- [ ] 战绩统计与排行榜
- [ ] 国际化（中文 / 英文）
- [ ] 更完善的移动端响应式适配
- [ ] Docker 镜像与 CI 发布流程

---

## 贡献指南

欢迎以 Issue 或 Pull Request 的形式参与贡献！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/your-feature`
3. 提交前确保通过测试：`npm test`
4. 提交并推送到你的 Fork
5. 创建 Pull Request，描述变更与动机

提交规范：

- `feat: ...` 新功能
- `fix: ...` 修复
- `refactor: ...` 重构
- `docs: ...` 文档
- `test: ...` 测试

行为准则：保持友好、聚焦问题、尊重他人时间。

---

## 许可证

本项目以 **ISC License** 发布。

---

## 联系方式

- 维护者: NewAaronLaw201
- 仓库地址: https://github.com/NewAaronLaw201/battleship-online
- 问题反馈: [GitHub Issues](https://github.com/NewAaronLaw201/battleship-online/issues)

---

如果这个项目对你有帮助，欢迎点一个 ⭐ 支持一下！
