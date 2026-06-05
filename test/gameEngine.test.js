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
