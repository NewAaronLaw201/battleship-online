const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION_TYPES } = require("../src/game/constants");
const { GameEngine, serializeRoomForPlayer } = require("../src/game/gameEngine");

function validFleet(offset = 0) {
  return [
    { id: "ship-2-1", x: 0, y: offset, orientation: "horizontal" },
    { id: "ship-3-1", x: 0, y: offset + 1, orientation: "horizontal" },
    { id: "ship-3-2", x: 0, y: offset + 2, orientation: "horizontal" },
    { id: "ship-4-1", x: 0, y: offset + 3, orientation: "horizontal" },
    { id: "ship-5-1", x: 0, y: offset + 4, orientation: "horizontal" }
  ];
}

test("starts battle after both players place valid fleets", () => {
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");
  assert.equal(room.phase, "placing");
  engine.joinRoom(room.id, "p2", "B");

  engine.placeFleet("p1", validFleet(0));
  const readyRoom = engine.placeFleet("p2", validFleet(0));

  assert.equal(readyRoom.phase, "battle");
  assert.ok(["p1", "p2"].includes(readyRoom.currentTurnPlayerId));
});

test("serializes an 11 by 11 board", () => {
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");

  assert.equal(serializeRoomForPlayer(room, "p1").boardSize, 11);
});

test("rejects overlapping ships", () => {
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");
  engine.joinRoom(room.id, "p2", "B");

  assert.throws(
    () =>
      engine.placeFleet("p1", [
        { id: "ship-2-1", x: 0, y: 0, orientation: "horizontal" },
        { id: "ship-3-1", x: 0, y: 0, orientation: "vertical" },
        { id: "ship-3-2", x: 0, y: 2, orientation: "horizontal" },
        { id: "ship-4-1", x: 0, y: 3, orientation: "horizontal" },
        { id: "ship-5-1", x: 0, y: 4, orientation: "horizontal" }
      ]),
    /重叠/
  );
});

test("miss switches turn and hit keeps turn", () => {
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");
  engine.joinRoom(room.id, "p2", "B");
  engine.placeFleet("p1", validFleet(0));
  engine.placeFleet("p2", validFleet(0));

  room.currentTurnPlayerId = "p1";
  engine.executeAction("p1", { type: ACTION_TYPES.BASIC_ATTACK, payload: { x: 8, y: 8 } });
  assert.equal(room.currentTurnPlayerId, "p2");

  engine.executeAction("p2", { type: ACTION_TYPES.BASIC_ATTACK, payload: { x: 0, y: 0 } });
  assert.equal(room.currentTurnPlayerId, "p2");
});

test("sunkShip.cells belong to the defender's board, not the attacker's", () => {
  // 关键：服务端在 sunkShip.cells 中返回的是**被攻击方**（防守方）的船格子。
  // 客户端在收到 action_result 时，必须根据 isAttacker 守卫，避免把我方棋盘
  // 坐标错误地写入攻击棋盘的 sunkShipCells 集合。
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");
  engine.joinRoom(room.id, "p2", "B");

  // p1 摆在 y=0..4，p2 摆在 y=5..9（错开避免重叠）
  const p1Fleet = validFleet(0);
  const p2Fleet = validFleet(5);
  engine.placeFleet("p1", p1Fleet);
  engine.placeFleet("p2", p2Fleet);

  // 取 p2 的 ship-2-1 整条船的 cells（这是被击沉测试目标）
  const targetShipCells = p2Fleet[0]; // ship-2-1, 起点 (0, 5)，cells: [(0,5),(1,5)]
  const expectedKeys = new Set(
    Array.from({ length: 2 }, (_, i) => `${(0 + i).toString()},5`)
  );

  // p1 先手：依次命中 p2 的 ship-2-1 全部格子
  room.currentTurnPlayerId = "p1";
  const result1 = engine.executeAction("p1", {
    type: ACTION_TYPES.BASIC_ATTACK,
    payload: { x: 0, y: 5 }
  });
  // 第一击：命中但未击沉（还有 1 格未命中）
  assert.equal(result1.actionResult.publicResult.hit, true);
  assert.equal(result1.actionResult.publicResult.sunkShip, null);

  const result2 = engine.executeAction("p1", {
    type: ACTION_TYPES.BASIC_ATTACK,
    payload: { x: 1, y: 5 }
  });
  // 第二击：命中且击沉
  assert.equal(result2.actionResult.publicResult.hit, true);
  assert.ok(result2.actionResult.publicResult.sunkShip, "sunkShip 应存在");
  const sunk = result2.actionResult.publicResult.sunkShip;

  // sunkShip.cells 应来自**防守方 p2** 的棋盘坐标，且与 p1 自己棋盘坐标无交集
  assert.equal(sunk.id, targetShipCells.id);
  const sunkKeys = new Set(sunk.cells.map((c) => `${c.x},${c.y}`));
  for (const k of expectedKeys) {
    assert.ok(sunkKeys.has(k), `sunkShip.cells 应包含 ${k}`);
  }
  // 不应混入 p1 的船坐标
  for (const cell of sunk.cells) {
    assert.ok(
      cell.y >= 5,
      `sunkShip.cells 不应包含 p1 自己棋盘的格子（y=${cell.y} < 5）`
    );
  }
});

test("when defender's ship is sunk, action_result still exposes sunkShip with defender's cells", () => {
  // 对称验证：当 p2 击沉 p1 的船时，sunkShip.cells 必须是 p1 棋盘上的坐标。
  // 客户端应根据 isAttacker 守卫**忽略**这些坐标（不写入攻击棋盘 sunkShipCells），
  // 避免把"我方棋盘坐标"误显示在"对手棋盘视图"上。
  const engine = new GameEngine();
  const room = engine.createRoom("p1", "A");
  engine.joinRoom(room.id, "p2", "B");
  const p1Fleet = validFleet(0);
  const p2Fleet = validFleet(5);
  engine.placeFleet("p1", p1Fleet);
  engine.placeFleet("p2", p2Fleet);

  // 让 p2 先手
  room.currentTurnPlayerId = "p2";

  // p2 击沉 p1 的 ship-2-1（位于 (0,0),(1,0)）
  engine.executeAction("p2", {
    type: ACTION_TYPES.BASIC_ATTACK,
    payload: { x: 0, y: 0 }
  });
  const result = engine.executeAction("p2", {
    type: ACTION_TYPES.BASIC_ATTACK,
    payload: { x: 1, y: 0 }
  });

  const sunk = result.actionResult.publicResult.sunkShip;
  assert.ok(sunk, "击沉 p1 的船后应返回 sunkShip");
  // sunkShip.cells 必须在 p1 棋盘（y=0..4 范围）而不是 p2 棋盘（y=5..9 范围）
  for (const cell of sunk.cells) {
    assert.ok(
      cell.y <= 4,
      `sunkShip.cells 应在 p1 棋盘范围内（y=${cell.y}）`
    );
  }
  // p1 的 privateResult 应能正确看到自己的船被标记为已击沉
  const p1Private = result.actionResult.privateResultByPlayer.get("p1");
  assert.ok(p1Private, "p1 应收到 privateResult");
  assert.ok(p1Private.ownBoardMark, "p1 应收到 ownBoardMark");
});
