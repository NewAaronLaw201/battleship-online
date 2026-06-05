const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { ACTION_TYPES } = require("./game/constants");
const { GameEngine, serializeRoomForPlayer } = require("./game/gameEngine");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const engine = new GameEngine();

app.use(express.static(path.join(__dirname, "public")));

function emitRoomState(room) {
  for (const player of room.players) {
    io.to(player.id).emit("room_state", serializeRoomForPlayer(room, player.id));
  }
}

function handleSocketError(socket, error) {
  socket.emit("error_message", error.message || "操作失败。");
}

// AI 玩家自动攻击定时器
const aiAttackTimers = new Map();

// AI 自动攻击逻辑
function scheduleAIAction(room, aiPlayerId) {
  // 清除之前的定时器
  if (aiAttackTimers.has(room.id)) {
    clearTimeout(aiAttackTimers.get(room.id));
  }

  // 延迟 1-2 秒后 AI 行动
  const delay = 1000 + Math.random() * 1000;
  const timer = setTimeout(() => {
    try {
      const action = engine.getAIAction(room, aiPlayerId);
      if (action) {
        const { room: updatedRoom, actionResult } = engine.executeAIAction(aiPlayerId, action);
        for (const player of updatedRoom.players) {
          io.to(player.id).emit("action_result", {
            publicResult: actionResult.publicResult,
            privateResult: actionResult.privateResultByPlayer.get(player.id) || null
          });
        }
        emitRoomState(updatedRoom);

        // 如果 AI 还在回合中，继续攻击
        const newAiPlayer = updatedRoom.players.find(p => p.isAI);
        if (newAiPlayer && updatedRoom.phase === "battle" && updatedRoom.currentTurnPlayerId === newAiPlayer.id) {
          scheduleAIAction(updatedRoom, newAiPlayer.id);
        }
      }
    } catch (err) {
      console.error("AI action error:", err);
    }
  }, delay);

  aiAttackTimers.set(room.id, timer);
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ playerName } = {}) => {
    try {
      const room = engine.createRoom(socket.id, playerName);
      socket.join(room.id);
      emitRoomState(room);
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("join_room", ({ roomId, playerName } = {}) => {
    try {
      const room = engine.joinRoom(roomId, socket.id, playerName);
      socket.join(room.id);
      emitRoomState(room);
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("create_ai_room", ({ playerName } = {}) => {
    try {
      const { room, aiPlayerId } = engine.createAIRoom(socket.id, playerName);
      socket.join(room.id);
      emitRoomState(room);

      // AI 准备就绪（自动放置舰队）
      setTimeout(() => {
        try {
          const updatedRoom = engine.placeFleetForAI(aiPlayerId);
          emitRoomState(updatedRoom);

          // 检查是否轮到 AI 行动（AI 先手的情况）
          const aiPlayer = updatedRoom.players.find(p => p.isAI);
          if (aiPlayer && updatedRoom.phase === "battle" && updatedRoom.currentTurnPlayerId === aiPlayer.id) {
            scheduleAIAction(updatedRoom, aiPlayer.id);
          }
        } catch (err) {
          console.error("AI placement error:", err);
        }
      }, 500);
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("leave_room", (payload = {}) => {
    console.log("Received leave_room from socket:", socket.id, "payload:", payload);
    try {
      // 清除 AI 攻击定时器
      const roomId = engine.getPlayerRoomId(socket.id);
      if (roomId && aiAttackTimers.has(roomId)) {
        clearTimeout(aiAttackTimers.get(roomId));
        aiAttackTimers.delete(roomId);
      }

      const result = engine.leaveRoom(socket.id);
      console.log("leaveRoom result:", result);
      if (result.success) {
        socket.leave(result.roomId);
        socket.emit("room_left", { roomId: result.roomId, playerId: socket.id });
        console.log("Emitted room_left to socket:", socket.id);
        // 通知房间内的其他玩家
        if (result.room) {
          for (const player of result.room.players) {
            io.to(player.id).emit("opponent_left", {
              playerId: socket.id
            });
          }
          emitRoomState(result.room);
        }
      } else {
        console.log("leaveRoom failed:", result.error);
        socket.emit("leave_room_failed", { message: result.error || "退出房间失败，请重试。" });
      }
    } catch (error) {
      console.error("leave_room error:", error);
      socket.emit("leave_room_failed", { message: error.message || "退出房间失败，请重试。" });
    }
  });

  socket.on("place_fleet", ({ ships } = {}) => {
    try {
      const room = engine.placeFleet(socket.id, ships);
      emitRoomState(room);
      if (room.currentTurnPlayerId) {
        io.to(room.id).emit("game_event", {
          type: "battle_started",
          firstPlayerId: room.currentTurnPlayerId
        });

        // 检查是否轮到 AI 行动（AI 先手的情况）
        const aiPlayer = room.players.find(p => p.isAI);
        if (aiPlayer && room.phase === "battle" && room.currentTurnPlayerId === aiPlayer.id) {
          scheduleAIAction(room, aiPlayer.id);
        }
      }
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("reset_game", () => {
    try {
      const room = engine.resetGame(socket.id);
      emitRoomState(room);

      // 如果是 AI 房间，AI 重新放置舰队
      const aiPlayer = room.players.find(p => p.isAI);
      if (aiPlayer) {
        const aiPlayerId = aiPlayer.id;
        setTimeout(() => {
          try {
            const updatedRoom = engine.placeFleetForAI(aiPlayerId);
            emitRoomState(updatedRoom);

            // 检查是否轮到 AI 行动（AI 先手的情况）
            const newAiPlayer = updatedRoom.players.find(p => p.isAI);
            if (newAiPlayer && updatedRoom.phase === "battle" && updatedRoom.currentTurnPlayerId === newAiPlayer.id) {
              scheduleAIAction(updatedRoom, newAiPlayer.id);
            }
          } catch (err) {
            console.error("AI placement error:", err);
          }
        }, 500);
      }
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("perform_action", ({ action } = {}) => {
    try {
      const { room, actionResult } = engine.executeAction(socket.id, action || { type: ACTION_TYPES.BASIC_ATTACK });
      for (const player of room.players) {
        io.to(player.id).emit("action_result", {
          publicResult: actionResult.publicResult,
          privateResult: actionResult.privateResultByPlayer.get(player.id) || null
        });
      }
      emitRoomState(room);

      // 如果是 AI 房间，检查是否轮到 AI 行动
      const aiPlayer = room.players.find(p => p.isAI);
      if (aiPlayer && room.phase === "battle" && room.currentTurnPlayerId === aiPlayer.id) {
        scheduleAIAction(room, aiPlayer.id);
      }
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("disconnect", () => {
    const room = engine.removePlayer(socket.id);
    if (room) {
      socket.to(room.id).emit("game_event", {
        type: "opponent_left",
        message: "对手已离开房间。"
      });
      emitRoomState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Battleship Online is running at http://localhost:${PORT}`);
});
