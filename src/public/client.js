const socket = io();

const FLEET = [
  { id: "ship-2-1", length: 2, label: "巡逻艇" },
  { id: "ship-3-1", length: 3, label: "驱逐舰 A" },
  { id: "ship-3-2", length: 3, label: "驱逐舰 B" },
  { id: "ship-4-1", length: 4, label: "战列舰" },
  { id: "ship-5-1", length: 5, label: "航空母舰" }
];

const ACTION_TYPES = {
  BASIC_ATTACK: "basic_attack"
};

let roomState = null;
let orientation = "horizontal";
let placements = [];
let selectedShipId = FLEET[0].id;
let hoverCell = null;
let eventLog = [];

const els = {
  statusText: document.querySelector("#statusText"),
  playerNameInput: document.querySelector("#playerNameInput"),
  roomIdInput: document.querySelector("#roomIdInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  roomIdText: document.querySelector("#roomIdText"),
  youText: document.querySelector("#youText"),
  opponentText: document.querySelector("#opponentText"),
  turnText: document.querySelector("#turnText"),
  setupPanel: document.querySelector("#setupPanel"),
  horizontalButton: document.querySelector("#horizontalButton"),
  verticalButton: document.querySelector("#verticalButton"),
  currentShipText: document.querySelector("#currentShipText"),
  shipPicker: document.querySelector("#shipPicker"),
  resetFleetButton: document.querySelector("#resetFleetButton"),
  readyButton: document.querySelector("#readyButton"),
  ownBoard: document.querySelector("#ownBoard"),
  attackBoard: document.querySelector("#attackBoard"),
  inventoryList: document.querySelector("#inventoryList"),
  eventLog: document.querySelector("#eventLog")
};

function boardSize() {
  return roomState?.boardSize || 11;
}

function key(cell) {
  return `${cell.x},${cell.y}`;
}

function cellsForPlacement(ship, origin = ship) {
  return Array.from({ length: ship.length }, (_, index) => ({
    x: origin.orientation === "horizontal" ? origin.x + index : origin.x,
    y: origin.orientation === "vertical" ? origin.y + index : origin.y
  }));
}

function isShipPlaced(shipId) {
  return placements.some((placement) => placement.id === shipId);
}

function selectedShip() {
  return FLEET.find((ship) => ship.id === selectedShipId && !isShipPlaced(ship.id)) || null;
}

function firstUnplacedShip() {
  return FLEET.find((ship) => !isShipPlaced(ship.id)) || null;
}

function ensureSelectedShip() {
  if (!selectedShip()) {
    selectedShipId = firstUnplacedShip()?.id || null;
  }
}

function placementIsValid(ship) {
  const occupied = new Set(
    placements.filter((placement) => placement.id !== ship.id).flatMap((placement) => cellsForPlacement(placement).map(key))
  );
  return cellsForPlacement(ship).every((cell) => {
    return cell.x >= 0 && cell.x < boardSize() && cell.y >= 0 && cell.y < boardSize() && !occupied.has(key(cell));
  });
}

function addLog(message, tone = "") {
  eventLog.unshift({ message, tone, at: new Date().toLocaleTimeString() });
  eventLog = eventLog.slice(0, 80);
  renderLog();
}

function renderLog() {
  els.eventLog.innerHTML = eventLog
    .map((entry) => `<div class="log-entry ${entry.tone}">${entry.at} ${entry.message}</div>`)
    .join("");
}

function renderBoards() {
  document.documentElement.style.setProperty("--board-size", boardSize());
  renderOwnBoard();
  renderAttackBoard();
}

function renderOwnBoard() {
  const shipCells = new Set();
  const hitCells = new Set((roomState?.you?.receivedHits || []).map(key));
  const missCells = new Set((roomState?.you?.receivedMisses || []).map(key));
  const placedShips = roomState?.you?.ships?.length ? roomState.you.ships : placements;

  placedShips.forEach((ship) => {
    cellsForPlacement(ship).forEach((cell) => shipCells.add(key(cell)));
  });

  const preview = getPreviewCells();
  els.ownBoard.innerHTML = "";

  for (let y = 0; y < boardSize(); y += 1) {
    for (let x = 0; x < boardSize(); x += 1) {
      const cell = document.createElement("button");
      const cellKey = key({ x, y });
      cell.className = `cell ${(x + y) % 2 ? "water-alt" : ""}`;
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (shipCells.has(cellKey)) cell.classList.add("ship");
      if (preview.cells.has(cellKey)) cell.classList.add(preview.valid ? "preview" : "invalid-preview");
      if (hitCells.has(cellKey)) cell.classList.add("hit");
      if (missCells.has(cellKey)) cell.classList.add("miss");

      cell.addEventListener("mouseenter", () => {
        hoverCell = { x, y };
        renderOwnBoard();
      });
      cell.addEventListener("mouseleave", () => {
        hoverCell = null;
        renderOwnBoard();
      });
      cell.addEventListener("click", () => placeCurrentShip(x, y));
      els.ownBoard.appendChild(cell);
    }
  }
}

function getPreviewCells() {
  const ship = selectedShip();
  if (!ship || !hoverCell || roomState?.you?.ready) {
    return { cells: new Set(), valid: true };
  }
  const previewShip = { ...ship, ...hoverCell, orientation };
  return {
    cells: new Set(cellsForPlacement(previewShip).map(key)),
    valid: placementIsValid(previewShip)
  };
}

function renderAttackBoard() {
  const attacks = new Set((roomState?.you?.attacks || []).map(key));
  const canAttack = roomState?.phase === "battle" && roomState.currentTurnPlayerId === roomState.you?.id;
  els.attackBoard.classList.toggle("disabled", !canAttack);
  els.attackBoard.innerHTML = "";

  for (let y = 0; y < boardSize(); y += 1) {
    for (let x = 0; x < boardSize(); x += 1) {
      const cell = document.createElement("button");
      const cellKey = key({ x, y });
      const knownResult = getKnownAttackResult(cellKey);
      cell.className = `cell ${(x + y) % 2 ? "water-alt" : ""}`;
      if (knownResult) cell.classList.add(knownResult);
      cell.disabled = !canAttack || attacks.has(cellKey);
      cell.addEventListener("click", () => attackCell(x, y));
      els.attackBoard.appendChild(cell);
    }
  }
}

function getKnownAttackResult(cellKey) {
  for (const entry of eventLog) {
    const match = entry.attackMark;
    if (match?.key === cellKey) return match.result;
  }
  return null;
}

function placeCurrentShip(x, y) {
  if (!roomState?.you) {
    addLog("请先创建或加入房间。", "tone-warning");
    return;
  }
  if (roomState.phase !== "placing") {
    addLog("当前还不能摆放军舰。", "tone-warning");
    return;
  }
  if (roomState?.you?.ready) return;
  ensureSelectedShip();
  const ship = selectedShip();
  if (!ship) {
    addLog("请先选择一艘未摆放的军舰。", "tone-warning");
    return;
  }

  const placement = { ...ship, x, y, orientation };
  if (!placementIsValid(placement)) {
    addLog("这个位置不能摆放军舰。", "tone-danger");
    return;
  }

  placements.push(placement);
  addLog(`已放置 ${ship.label}。`, "tone-success");
  selectedShipId = firstUnplacedShip()?.id || null;
  updateSetup();
  renderOwnBoard();
}

function attackCell(x, y) {
  socket.emit("perform_action", {
    action: {
      type: ACTION_TYPES.BASIC_ATTACK,
      payload: { x, y }
    }
  });
}

function updateSetup() {
  ensureSelectedShip();
  const ship = selectedShip();
  els.currentShipText.textContent = ship ? `${ship.label}（长度 ${ship.length}）` : "舰队已摆放完成";
  els.readyButton.disabled = placements.length !== FLEET.length || roomState?.you?.ready;
  renderShipPicker();
}

function renderShipPicker() {
  els.shipPicker.innerHTML = "";
  FLEET.forEach((ship) => {
    const placed = isShipPlaced(ship.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ship-option ${selectedShipId === ship.id && !placed ? "active" : ""} ${placed ? "placed" : ""}`;
    button.innerHTML = `<span>${ship.label}</span><strong>${ship.length}格</strong>`;
    button.disabled = placed || roomState?.you?.ready;
    button.addEventListener("click", () => {
      selectedShipId = ship.id;
      updateSetup();
      renderOwnBoard();
    });
    els.shipPicker.appendChild(button);
  });
}

function renderHeader() {
  els.roomIdText.textContent = roomState?.id || "-";
  els.youText.textContent = roomState?.you ? `${roomState.you.name}${roomState.you.ready ? "（已准备）" : ""}` : "-";
  els.opponentText.textContent = roomState?.opponent
    ? `${roomState.opponent.name}${roomState.opponent.ready ? "（已准备）" : ""}`
    : "等待加入";

  if (!roomState) {
    els.turnText.textContent = "-";
    els.statusText.textContent = "创建或加入房间开始游戏";
  } else if (roomState.phase === "waiting") {
    els.turnText.textContent = "-";
    els.statusText.textContent = "等待第二名玩家加入";
  } else if (roomState.phase === "placing") {
    els.turnText.textContent = "-";
    els.statusText.textContent = roomState.you.ready ? "等待对手准备" : "请在左侧棋盘摆放军舰";
  } else if (roomState.phase === "battle") {
    const isMyTurn = roomState.currentTurnPlayerId === roomState.you.id;
    els.turnText.textContent = isMyTurn ? "轮到你" : "对手回合";
    els.statusText.textContent = isMyTurn ? "请选择右侧棋盘进行攻击" : "等待对手行动";
  } else if (roomState.phase === "finished") {
    const won = roomState.winnerId === roomState.you.id;
    els.turnText.textContent = won ? "胜利" : "失败";
    els.statusText.textContent = won ? "你摧毁了对方全部军舰" : "我方全部军舰已被摧毁";
  }

  els.setupPanel.style.display = roomState?.phase === "placing" && !roomState?.you?.ready ? "block" : "none";
}

function renderInventory() {
  const inventory = roomState?.you?.inventory || [];
  els.inventoryList.innerHTML = inventory.length
    ? inventory.map((item) => `<button disabled>${item.name || item.type}</button>`).join("")
    : '<div class="empty-inventory">暂无道具</div>';
}

function syncRoomState(nextState) {
  const previousPhase = roomState?.phase;
  const previousRoomId = roomState?.id;
  roomState = nextState;
  if (previousRoomId && previousRoomId !== roomState.id) {
    placements = [];
    selectedShipId = FLEET[0].id;
  }
  renderHeader();
  updateSetup();
  renderInventory();
  renderBoards();

  if (previousPhase !== "battle" && roomState.phase === "battle") {
    addLog(roomState.currentTurnPlayerId === roomState.you.id ? "战斗开始，你是先手。" : "战斗开始，对手先手。", "tone-success");
  }
}

els.createRoomButton.addEventListener("click", () => {
  socket.emit("create_room", { playerName: els.playerNameInput.value.trim() || "玩家 1" });
});

els.joinRoomButton.addEventListener("click", () => {
  socket.emit("join_room", {
    roomId: els.roomIdInput.value.trim(),
    playerName: els.playerNameInput.value.trim() || "玩家 2"
  });
});

els.horizontalButton.addEventListener("click", () => {
  orientation = "horizontal";
  els.horizontalButton.classList.add("active");
  els.verticalButton.classList.remove("active");
  renderOwnBoard();
});

els.verticalButton.addEventListener("click", () => {
  orientation = "vertical";
  els.verticalButton.classList.add("active");
  els.horizontalButton.classList.remove("active");
  renderOwnBoard();
});

els.resetFleetButton.addEventListener("click", () => {
  placements = [];
  selectedShipId = FLEET[0].id;
  updateSetup();
  renderOwnBoard();
});

els.readyButton.addEventListener("click", () => {
  socket.emit("place_fleet", { ships: placements });
});

socket.on("room_state", syncRoomState);

socket.on("error_message", (message) => {
  addLog(message, "tone-danger");
});

socket.on("game_event", (event) => {
  if (event.type === "opponent_left") {
    addLog(event.message, "tone-warning");
  }
});

socket.on("action_result", ({ publicResult, privateResult }) => {
  if (!publicResult || !roomState?.you) return;

  const isAttacker = publicResult.attackerId === roomState.you.id;
  const resultText = publicResult.hit ? "命中" : "落空";
  const cellText = `(${publicResult.cell.x + 1}, ${publicResult.cell.y + 1})`;

  if (isAttacker) {
    const attackMark = privateResult?.attackBoardMark;
    eventLog.unshift({
      message: `你攻击 ${cellText}：${resultText}${publicResult.sunkShip ? `，摧毁 ${publicResult.sunkShip.label}` : ""}`,
      tone: publicResult.hit ? "tone-success" : "",
      at: new Date().toLocaleTimeString(),
      attackMark: attackMark ? { key: key(attackMark.cell), result: attackMark.result } : null
    });
  } else {
    eventLog.unshift({
      message: `对手攻击 ${cellText}：${resultText}${publicResult.sunkShip ? `，${publicResult.sunkShip.label} 被摧毁` : ""}`,
      tone: publicResult.hit ? "tone-danger" : "",
      at: new Date().toLocaleTimeString()
    });
  }

  eventLog = eventLog.slice(0, 80);
  renderLog();
});

renderHeader();
updateSetup();
renderBoards();
renderLog();
