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

  socket.on("leave_room", (payload = {}) => {
    console.log("Received leave_room from socket:", socket.id, "payload:", payload);
    try {
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
      }
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("reset_game", () => {
    try {
      const room = engine.resetGame(socket.id);
      emitRoomState(room);
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
