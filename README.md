# 双人联机战舰小游戏

一个支持房间创建、加入、双方准备、军舰摆放、随机先手、回合攻击、命中/落空同步、摧毁提示和胜负判定的 11x11 双人联机小游戏。

## 功能

- 11x11 双方棋盘
- 房间创建和房间号加入
- 每名玩家选择并摆放 5 艘军舰：长度 2、3、3、4、5
- 横向/纵向放置校验，禁止越界和重叠
- 双方准备后随机决定先手
- 左侧显示自己的棋盘和敌方攻击标记
- 右侧显示攻击对方的未知棋盘
- 命中后继续攻击，落空后切换回合
- 单艘军舰全中后提示摧毁
- 所有军舰被摧毁后游戏结束
- 预留道具背包和行动处理器，方便后续加入特殊攻击、探测、干扰、防御等道具

## 运行方式

```bash
npm install
npm start
```

启动后打开：

```text
http://localhost:3000
```

一个玩家点击“创建房间”，另一个玩家输入房间号并点击“加入房间”。双方摆放完军舰后点击“准备”，即可开始对战。

## 开发方式

```bash
npm run dev
```

运行测试：

```bash
npm test
```

## 代码结构

```text
src/
  server.js              # HTTP 服务和 Socket.IO 入口
  game/
    constants.js         # 棋盘大小、舰队配置、行动类型
    gameEngine.js        # 房间、玩家、回合、胜负等核心状态
    validators.js        # 坐标、军舰摆放、攻击合法性校验
    actions/
      actionRegistry.js  # 可扩展行动注册表
      basicAttack.js     # 当前版本的普通单格攻击
  public/
    index.html           # 游戏界面
    styles.css           # 界面样式
    client.js            # 前端交互和实时同步
test/
  gameEngine.test.js     # 核心规则测试
```

## 道具系统扩展思路

当前实现没有把游戏逻辑写死成“只能普通攻击”。客户端提交的是行动：

```js
{
  type: "basic_attack",
  payload: { x: 3, y: 5 }
}
```

后端通过 `actionRegistry` 查找对应处理器。后续新增道具时，可以添加新的 action handler，例如：

- `area_attack`：一次攻击多个格子
- `scan`：临时揭示某个区域是否有船
- `jam`：干扰对方下一次行动
- `shield`：防御一次命中
- `skip_turn`：令对方跳过回合

玩家状态中已经预留 `inventory` 字段，回合结算也由 action handler 返回 `keepTurn`、`events`、`publicResult` 等结果，方便以后支持连续攻击、区域效果、临时信息揭示和跳过回合。
