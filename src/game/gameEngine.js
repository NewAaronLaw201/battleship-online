const crypto = require("crypto");
const { ACTION_TYPES, BOARD_SIZE, ROOM_PHASES } = require("./constants");
const { cellKey, validateFleetPlacement } = require("./validators");
const { ActionRegistry } = require("./actions/actionRegistry");
const { basicAttack } = require("./actions/basicAttack");

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name: name || "玩家",
    ready: false,
    ships: [],
    attacks: new Set(),
    receivedHits: new Set(),
    receivedMisses: new Set(),
    inventory: []
  };
}

function createEmptyRoom(roomId) {
  return {
    id: roomId,
    phase: ROOM_PHASES.WAITING,
    players: [],
    currentTurnPlayerId: null,
    winnerId: null,
    actionLog: []
  };
}

class GameEngine {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map();
    this.actions = new ActionRegistry();
    this.actions.register(ACTION_TYPES.BASIC_ATTACK, basicAttack);
  }

  createRoom(socketId, playerName) {
    const room = createEmptyRoom(this.createRoomId());
    room.players.push(createPlayer(socketId, playerName));
    room.phase = ROOM_PHASES.PLACING;
    this.rooms.set(room.id, room);
    this.playerRooms.set(socketId, room.id);
    return room;
  }

  joinRoom(roomId, socketId, playerName) {
    const room = this.rooms.get(String(roomId).trim().toUpperCase());
    if (!room) throw new Error("房间不存在。");
    if (room.players.length >= 2) throw new Error("房间已满。");
    if (room.phase !== ROOM_PHASES.WAITING && room.phase !== ROOM_PHASES.PLACING) {
      throw new Error("游戏已经开始。");
    }

    room.players.push(createPlayer(socketId, playerName));
    room.phase = ROOM_PHASES.PLACING;
    this.playerRooms.set(socketId, room.id);
    return room;
  }

  removePlayer(socketId) {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    this.playerRooms.delete(socketId);
    if (!room) return null;

    room.players = room.players.filter((player) => player.id !== socketId);
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
    } else {
      room.phase = ROOM_PHASES.PLACING;
      room.currentTurnPlayerId = null;
      room.winnerId = null;
      room.players.forEach((player) => {
        player.ready = false;
      });
    }

    return room;
  }

  placeFleet(socketId, ships) {
    const { room, player } = this.getRoomAndPlayer(socketId);
    if (room.phase !== ROOM_PHASES.PLACING) {
      throw new Error("当前不能摆放军舰。");
    }

    const result = validateFleetPlacement(ships);
    if (!result.ok) throw new Error(result.message);

    player.ships = result.ships;
    player.ready = true;

    if (room.players.length === 2 && room.players.every((roomPlayer) => roomPlayer.ready)) {
      room.phase = ROOM_PHASES.BATTLE;
      room.currentTurnPlayerId = room.players[Math.floor(Math.random() * 2)].id;
    }

    return room;
  }

  executeAction(socketId, action) {
    const { room, player } = this.getRoomAndPlayer(socketId);
    if (room.phase !== ROOM_PHASES.BATTLE) {
      throw new Error("战斗尚未开始。");
    }
    if (room.currentTurnPlayerId !== socketId) {
      throw new Error("还没轮到你。");
    }

    const target = room.players.find((roomPlayer) => roomPlayer.id !== player.id);
    if (!target) throw new Error("对手不存在。");

    const result = this.actions.execute({ room, actor: player, target }, action);
    if (result.winnerId) {
      room.phase = ROOM_PHASES.FINISHED;
      room.winnerId = result.winnerId;
    } else if (!result.keepTurn) {
      room.currentTurnPlayerId = target.id;
    }

    room.actionLog.push({
      at: new Date().toISOString(),
      actionType: action.type,
      actorId: player.id,
      result: result.publicResult
    });

    return { room, actionResult: result };
  }

  getRoomForPlayer(socketId) {
    const roomId = this.playerRooms.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  getRoomAndPlayer(socketId) {
    const room = this.getRoomForPlayer(socketId);
    if (!room) throw new Error("你尚未加入房间。");

    const player = room.players.find((roomPlayer) => roomPlayer.id === socketId);
    if (!player) throw new Error("玩家不存在。");

    return { room, player };
  }

  createRoomId() {
    let roomId;
    do {
      roomId = crypto.randomBytes(3).toString("hex").toUpperCase();
    } while (this.rooms.has(roomId));
    return roomId;
  }
}

function serializeCellSet(set) {
  return Array.from(set).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });
}

function serializeRoomForPlayer(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  const opponent = room.players.find((player) => player.id !== viewerId);

  return {
    id: room.id,
    phase: room.phase,
    boardSize: BOARD_SIZE,
    currentTurnPlayerId: room.currentTurnPlayerId,
    winnerId: room.winnerId,
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          ready: viewer.ready,
          ships: viewer.ships.map((ship) => ({
            id: ship.id,
            label: ship.label,
            length: ship.length,
            orientation: ship.orientation,
            cells: ship.cells,
            hits: ship.hits
          })),
          receivedHits: serializeCellSet(viewer.receivedHits),
          receivedMisses: serializeCellSet(viewer.receivedMisses),
          attacks: serializeCellSet(viewer.attacks),
          inventory: viewer.inventory
        }
      : null,
    opponent: opponent
      ? {
          id: opponent.id,
          name: opponent.name,
          ready: opponent.ready,
          shipCount: opponent.ships.length,
          remainingShips: opponent.ships.filter((ship) => !ship.cells.every((cell) => ship.hits.includes(cellKey(cell)))).length,
          inventoryCount: opponent.inventory.length
        }
      : null
  };
}

module.exports = {
  GameEngine,
  serializeRoomForPlayer
};
