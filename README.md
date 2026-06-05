# 军舰小游戏 (Battleship Online)

[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.19-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/socket.io-4.7-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](#license)
[![Status](https://img.shields.io/badge/status-active-success.svg)](#)

一个支持房间创建/加入、双方准备、手动军舰摆放、随机先手、回合制攻击、命中/落空同步、单船摧毁提示和胜负判定的 **11x11 双人联机战舰小游戏**。核心采用可扩展的 Action / Item 架构，方便后续加入探测、区域攻击、干扰、护盾等道具。

> 在线仓库: [github.com/NewAaronLaw201/battleship-online](https://github.com/NewAaronLaw201/battleship-online)

---

## 目录

- [项目简介](#项目简介)
- [特性](#特性)
- [架构与流程图](#架构与流程图)
- [环境要求](#环境要求)
- [安装](#安装)
- [运行](#运行)
- [使用说明](#使用说明)
- [游戏规则](#游戏规则)
- [协议与消息](#协议与消息)
- [项目结构](#项目结构)
- [配置项](#配置项)
- [测试](#测试)
- [扩展开发](#扩展开发)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)
- [联系方式](#联系方式)

---

## 项目简介

本项目是一个使用 **Node.js + Express + Socket.IO** 实现的双人联机战舰（Battleship）小游戏。两位玩家在浏览器中进入同一房间后，依次手动放置自己的舰队、准备开战，系统随机决定先手，随后按回合制进行攻击，先击沉对方全部 5 艘军舰的一方获胜。

游戏的客户端提交是 **行动 (Action)** 而非固定的“普通攻击”，后端通过 `actionRegistry` 派发到对应处理器；返回结果中包含 `keepTurn / events / publicResult` 等字段，便于将来实现连续行动、区域效果、临时信息揭示和跳过回合等高级机制。

## 特性

- 11x11 双方对战棋盘
- 房间号创建与加入（房间号由服务端生成）
- 每位玩家手动摆放 5 艘军舰（长度 2 / 3 / 3 / 4 / 5）
- 横向/纵向放置校验，禁止越界和重叠
- 双方准备后随机决定先手
- 左侧己方棋盘（含敌方攻击标记）+ 右侧敌方未知棋盘
- 命中可继续攻击，落空则切换回合
- 单艘军舰被完全命中后展示摧毁动画与提示
- 全舰被击沉后判定胜负并广播结果
- 预留 `inventory`（道具背包）和 Action Registry，便于扩展
- 内置基于 `node:test` 的核心规则单元测试

## 架构与流程图

```text
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

```text
客户端发起行动 (action)
   │
   ▼
服务端校验 + 派发 ActionHandler
   │
   ├── 更新房间状态（命中/落空/摧毁/胜负）
   │
   ├── 广播 publicResult（双方可见）
   │
   └── 返回 keepTurn → 控制是否切换当前回合
```

## 环境要求

| 项目     | 版本要求                  |
| -------- | ------------------------- |
| Node.js  | `>= 18` (推荐 LTS 20/22) |
| npm      | `>= 9`（随 Node 自带）   |
| 操作系统 | Windows / macOS / Linux  |
| 浏览器   | 任意支持 ES2020 的现代浏览器 |

> 端口：默认 `3000`。如被占用可通过 `PORT` 环境变量修改（见 [配置项](#配置项)）。

## 安装

```bash
# 克隆仓库
git clone https://github.com/NewAaronLaw201/battleship-online.git
cd battleship-online

# 安装依赖
npm install
```

## 运行

### 生产模式

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

### 开发模式（热重载）

```bash
npm run dev
```

使用 Node 内置的 `--watch`，修改 `src/` 下的文件会自动重启服务。

## 使用说明

1. 玩家 A 打开页面，点击 **「创建房间」**，服务器会生成一个房间号并显示在页面上。
2. 玩家 B 在同一页面输入该房间号，点击 **「加入房间」**。
3. 两位玩家在自己的 11x11 棋盘上**手动摆放 5 艘军舰**（长度 2、3、3、4、5），可横放或竖放。
4. 双方都点击 **「准备」** 后，系统随机决定先手。
5. 当前回合玩家点击右侧敌方棋盘上的格子发起攻击：
   - 命中：保留回合，可继续攻击。
   - 落空：切换到对方回合。
6. 一方全部 5 艘军舰被击沉后，另一方获胜，房间进入结算状态。

## 游戏规则

- 棋盘大小：11 × 11
- 舰队组成：

  | 编号 | 名称 | 长度 |
  | ---- | ---- | ---- |
  | 1    | 巡洋舰 | 2    |
  | 2    | 潜艇   | 3    |
  | 3    | 驱逐舰 | 3    |
  | 4    | 战列舰 | 4    |
  | 5    | 航空母舰 | 5  |

- 军舰之间**不可重叠**，可相邻；放置时**不可越界**。
- 命中后保留攻击权；落空则换边。
- 同一艘军舰的每个格子都被命中后，广播“已摧毁”。

## 协议与消息

客户端通过 Socket.IO 提交 **Action** 形式的行动，而非写死的“攻击坐标”：

```json
{
  "type": "basic_attack",
  "payload": { "x": 3, "y": 5 }
}
```

Action Handler 返回结构（关键字段）：

```json
{
  "keepTurn": true,
  "events": ["hit", "sunk:submarine"],
  "publicResult": { "x": 3, "y": 5, "result": "hit" }
}
```

| 字段          | 说明                                                |
| ------------- | --------------------------------------------------- |
| `keepTurn`    | 是否保留当前回合玩家的行动权                        |
| `events`      | 触发的逻辑事件列表（用于客户端触发动画 / 提示）     |
| `publicResult`| 对双方可见的本次行动结果                            |

## 项目结构

```text
.
├── src/
│   ├── server.js                # HTTP 服务和 Socket.IO 入口
│   ├── game/
│   │   ├── constants.js         # 棋盘大小、舰队配置、行动类型
│   │   ├── gameEngine.js        # 房间、玩家、回合、胜负等核心状态
│   │   ├── validators.js        # 坐标、军舰摆放、攻击合法性校验
│   │   └── actions/
│   │       ├── actionRegistry.js# 可扩展行动注册表
│   │       └── basicAttack.js   # 当前版本的普通单格攻击
│   └── public/
│       ├── index.html           # 游戏界面
│       ├── styles.css           # 界面样式
│       └── client.js            # 前端交互和实时同步
├── test/
│   └── gameEngine.test.js       # 核心规则单元测试
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

## 配置项

当前版本通过 **环境变量** 配置：

| 变量名 | 默认值 | 说明                                       |
| ------ | ------ | ------------------------------------------ |
| `PORT` | `3000` | HTTP / Socket.IO 监听端口                  |

示例（Windows PowerShell）：

```powershell
$env:PORT=8080; npm start
```

示例（macOS / Linux）：

```bash
PORT=8080 npm start
```

> 进阶配置（例如房间超时、断线重连策略）将在后续版本中以配置文件或 `config.js` 形式提供。

## 测试

```bash
npm test
```

使用 Node 内置的 [`node:test`](https://nodejs.org/api/test.html) 运行 `test/` 下的单元测试，覆盖棋盘、舰队放置、回合切换、命中/落空与胜负判定等核心规则。

## 扩展开发

得益于 Action / Item 架构，新增玩法只需：

1. 在 `src/game/actions/` 下创建新的 ActionHandler：

   ```js
   // src/game/actions/areaAttack.js
   module.exports = {
     type: "area_attack",
     validate: (state, playerId, payload) => { /* ... */ },
     apply: (state, playerId, payload) => {
       // 修改 state，返回 { keepTurn, events, publicResult }
     }
   };
   ```

2. 在 `actionRegistry.js` 中注册：

   ```js
   const areaAttack = require("./areaAttack");
   registry.register(areaAttack);
   ```

3. 客户端在 `client.js` 中按相同 `type` 提交行动即可。

可拓展方向示例：

- `area_attack`：一次攻击多个格子
- `scan`：临时揭示某个区域是否有船
- `jam`：干扰对方下一次行动
- `shield`：防御一次命中
- `skip_turn`：令对方跳过回合
- `inventory` 道具背包已在玩家状态中预留

## 路线图

- [ ] 道具背包（Inventory）UI 与后端事件
- [ ] 房间断线重连与观战模式
- [ ] 战绩统计与排行榜
- [ ] 国际化（中文 / 英文）
- [ ] 移动端响应式适配
- [ ] Docker 镜像与 CI 发布流程

## 贡献指南

欢迎以 Issue 或 Pull Request 的形式参与贡献！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/your-feature`
3. 提交前确保通过测试：`npm test`
4. 提交并推送到你的 Fork
5. 创建 Pull Request，描述变更与动机

提交规范建议：

- `feat: ...` 新功能
- `fix: ...`  修复
- `refactor: ...` 重构
- `docs: ...`  文档
- `test: ...`  测试

行为准则：保持友好、聚焦问题、尊重他人时间。

## 许可证

本项目以 **ISC License** 发布。详见 `LICENSE` 文件（如仓库尚未提供，请在使用前向维护者确认）。

## 联系方式

- 维护者: NewAaronLaw201
- 仓库地址: https://github.com/NewAaronLaw201/battleship-online
- 问题反馈: [GitHub Issues](https://github.com/NewAaronLaw201/battleship-online/issues)
- 邮箱:  （如需公开联系邮箱请在此处补充）

---

如果这个项目对你有帮助，欢迎点一个 ⭐ 支持一下！
