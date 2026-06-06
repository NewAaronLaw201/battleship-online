const socket = io();

console.log("Socket connected:", socket.connected);
console.log("Socket id:", socket.id);

socket.on("connect", () => {
  console.log("Socket connected, id:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
});

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
let isLeavingRoom = false;
let leaveRoomTimeoutId = null;
// 独立追踪已被击沉的对手军舰：cellKey -> orientation
// 不受 eventLog 滚动截断影响，确保攻击棋盘的摧毁视觉始终完整
let sunkShipCells = new Map();

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
  shipPicker: document.querySelector("#shipPicker"),
  resetPlacementButton: document.querySelector("#resetPlacementButton"),
  readyButton: document.querySelector("#readyButton"),
  ownBoard: document.querySelector("#ownBoard"),
  attackBoard: document.querySelector("#attackBoard"),
  inventoryList: document.querySelector("#inventoryList"),
  eventLog: document.querySelector("#eventLog"),
  leaveRoomButton: document.querySelector("#leaveRoomButton"),
  nextRoundButton: document.querySelector("#nextRoundButton")
};

console.log("leaveRoomButton element:", els.leaveRoomButton);

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

function findPlacementAtCell(x, y) {
  return placements.find((placement) => {
    return cellsForPlacement(placement).some((cell) => cell.x === x && cell.y === y);
  }) || null;
}

function isFirstCellOfPlacement(x, y, placement) {
  if (!placement) return false;
  return placement.x === x && placement.y === y;
}

function unplaceShip(shipId) {
  const index = placements.findIndex((p) => p.id === shipId);
  if (index === -1) return null;
  const [removed] = placements.splice(index, 1);
  selectedShipId = shipId;
  return removed;
}

function selectedShip() {
  // 返回任何选中的船只（无论是否已放置）
  return FLEET.find((ship) => ship.id === selectedShipId) || null;
}

function firstUnplacedShip() {
  return FLEET.find((ship) => !isShipPlaced(ship.id)) || null;
}

function ensureSelectedShip() {
  // 确保选中了一艘船（可以是已放置或未放置的）
  if (!selectedShip()) {
    selectedShipId = FLEET[0]?.id || null;
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
  const hitCells = new Set((roomState?.you?.receivedHits || []).map(key));
  const missCells = new Set((roomState?.you?.receivedMisses || []).map(key));
  const placedShips = roomState?.you?.ships?.length ? roomState.you.ships : placements;

  // 创建船只格子映射，同时标记被摧毁的船只和方向
  const shipCells = new Set();
  const destroyedShipCells = new Map(); // key -> orientation

  placedShips.forEach((ship) => {
    // 服务器返回的 ships 有 cells 属性，本地 placements 有 x, y 属性
    let shipCellsList;
    let orientation;

    if (Array.isArray(ship.cells) && ship.cells.length > 0) {
      // 服务器格式：已经有计算好的 cells
      shipCellsList = ship.cells;
      orientation = ship.orientation;
    } else {
      // 本地格式：需要计算 cells
      shipCellsList = cellsForPlacement(ship);
      orientation = ship.orientation;
    }

    // 过滤无效格子（防止 NaN/undefined 污染 shipCells）
    const validCells = shipCellsList.filter(
      (cell) => Number.isInteger(cell?.x) && Number.isInteger(cell?.y)
    );
    if (validCells.length === 0) return;

    // 检查船只是否被摧毁（所有格子都被击中）
    const isDestroyed = validCells.every((cell) => hitCells.has(key(cell)));

    validCells.forEach((cell) => {
      const cellKey = key(cell);
      shipCells.add(cellKey);
      if (isDestroyed) {
        destroyedShipCells.set(cellKey, orientation);
      }
    });
  });

  const preview = getPreviewCells();
  const showRemovable = hoverCell && !roomState?.you?.ready;
  // 满足以下任一条件时，整艘军舰的所有格子都显示"取消放置"视觉：
  //  1) 悬停于该军舰的"第一格"
  //  2) 悬停于该军舰的"其他格子"但以此格为首格的移动非法
  const hoverRemovablePlacement = showRemovable
    ? (() => {
        const placement = findPlacementAtCell(hoverCell.x, hoverCell.y);
        if (!placement) return null;
        if (isFirstCellOfPlacement(hoverCell.x, hoverCell.y, placement)) return placement;
        const moved = { ...placement, x: hoverCell.x, y: hoverCell.y };
        return placementIsValid(moved) ? null : placement;
      })()
    : null;

  // 只更新格子状态，而不是重新创建整个棋盘
  const cells = els.ownBoard.querySelectorAll(".cell");

  if (cells.length === 0) {
    // 第一次渲染，创建棋盘
    els.ownBoard.innerHTML = "";
    for (let y = 0; y < boardSize(); y += 1) {
      for (let x = 0; x < boardSize(); x += 1) {
        const cell = document.createElement("button");
        const cellKey = key({ x, y });
        cell.className = `cell ${(x + y) % 2 ? "water-alt" : ""}`;
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.type = "button";
        els.ownBoard.appendChild(cell);
      }
    }
  }

  // 更新所有格子的状态
  els.ownBoard.querySelectorAll(".cell").forEach((cell) => {
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    const cellKey = key({ x, y });

    // 重置类名
    cell.className = `cell ${(x + y) % 2 ? "water-alt" : ""}`;

    // 添加状态类
    if (shipCells.has(cellKey)) {
      // 如果船只被摧毁，显示摧毁效果
      const destroyedOrientation = destroyedShipCells.get(cellKey);
      if (destroyedOrientation) {
        cell.classList.add(`ship-destroyed-${destroyedOrientation}`);
      } else {
        cell.classList.add("ship");
      }
    }
    if (preview.cells.has(cellKey)) cell.classList.add(preview.valid ? "preview" : "invalid-preview");
    if (hitCells.has(cellKey)) cell.classList.add("hit");
    if (missCells.has(cellKey)) cell.classList.add("miss");
    // 悬停触发取消放置时，整艘军舰的所有格子都显示取消放置的视觉反馈
    if (hoverRemovablePlacement) {
      const hoverShipCells = cellsForPlacement(hoverRemovablePlacement);
      if (hoverShipCells.some((c) => c.x === x && c.y === y)) {
        cell.classList.add("removable");
      }
    }
  });
}

function getPreviewCells() {
  const ship = selectedShip();
  if (!hoverCell || roomState?.you?.ready) {
    return { cells: new Set(), valid: true };
  }
  const placementUnderHover = findPlacementAtCell(hoverCell.x, hoverCell.y);
  if (placementUnderHover) {
    if (isFirstCellOfPlacement(hoverCell.x, hoverCell.y, placementUnderHover)) {
      // 悬停于"第一格" → 抑制预览（取消视觉接管）
      return { cells: new Set(), valid: true };
    }
    // 悬停于军舰的其他格子：以被点击格为新首格，显示移动后的预览
    // 若移动非法则返回空预览（取消视觉接管）
    const moved = { ...placementUnderHover, x: hoverCell.x, y: hoverCell.y };
    if (!placementIsValid(moved)) {
      return { cells: new Set(), valid: true };
    }
    return {
      cells: new Set(cellsForPlacement(moved).map(key)),
      valid: true
    };
  }
  if (!ship) {
    return { cells: new Set(), valid: true };
  }
  // 空白格：显示当前选中舰的预览
  const previewShip = { ...ship, ...hoverCell, orientation };
  return {
    cells: new Set(cellsForPlacement(previewShip).map(key)),
    valid: placementIsValid(previewShip)
  };
}

function renderAttackBoard() {
  const attacks = new Set((roomState?.you?.attacks || []).map(key));
  const isFinished = roomState?.phase === "finished";
  const canAttack = !isFinished && roomState?.phase === "battle" && roomState.currentTurnPlayerId === roomState.you?.id;
  els.attackBoard.classList.toggle("disabled", !canAttack && !isFinished);

  // 收集所有被摧毁军舰的格子
  // 使用独立的 sunkShipCells Map（不受 eventLog 滚动截断影响），
  // 同时合并当前事件日志中的 sunkShipInfo 作为兼容/兜底
  const destroyedShipCells = new Map(sunkShipCells);

  for (const entry of eventLog) {
    const sunkShipInfo = entry.attackMark?.sunkShipInfo;
    if (sunkShipInfo && Array.isArray(sunkShipInfo.cells) && sunkShipInfo.cells.length > 0) {
      sunkShipInfo.cells.forEach((cell) => {
        if (Number.isInteger(cell?.x) && Number.isInteger(cell?.y)) {
          const cellKey = key(cell);
          if (!destroyedShipCells.has(cellKey)) {
            destroyedShipCells.set(cellKey, sunkShipInfo.orientation);
          }
        }
      });
    }
  }

  // 游戏结束后或战斗中，对手的所有船只格子（用于显示完整布局或追踪）
  const opponentShipCells = new Set();
  const opponentShipCellsDestroyed = new Map(); // key -> orientation
  // 只有在 finished 阶段才显示对手所有船只（包括未击中的）
  // 在 placing 阶段不应该有任何 opponent.ships 数据
  if (roomState?.phase === "finished" && roomState.opponent?.ships) {
    roomState.opponent.ships.forEach((ship) => {
      // 检查该船只是否已被摧毁
      const isDestroyed = ship.cells.every(cell => ship.hits.includes(key(cell)));
      ship.cells.forEach((cell) => {
        const cellKey = key(cell);
        opponentShipCells.add(cellKey);
        if (isDestroyed) {
          opponentShipCellsDestroyed.set(cellKey, ship.orientation);
        }
      });
    });
  }

  els.attackBoard.innerHTML = "";

  for (let y = 0; y < boardSize(); y += 1) {
    for (let x = 0; x < boardSize(); x += 1) {
      const cell = document.createElement("button");
      const cellKey = key({ x, y });
      const knownResult = getKnownAttackResult(cellKey);
      const destroyedOrientation = destroyedShipCells.get(cellKey);

      cell.className = `cell ${(x + y) % 2 ? "water-alt" : ""}`;
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.type = "button";

      if (knownResult) cell.classList.add(knownResult);

      // 如果是被摧毁军舰的格子，添加摧毁样式
      if (destroyedOrientation) {
        cell.classList.add(`ship-destroyed-${destroyedOrientation}`);
      }

      // 游戏结束后，显示对手未被发现/未摧毁的船只位置
      if (opponentShipCells.has(cellKey) && !destroyedOrientation) {
        const shipDestroyedOrientation = opponentShipCellsDestroyed.get(cellKey);
        if (shipDestroyedOrientation) {
          cell.classList.add(`ship-destroyed-${shipDestroyedOrientation}`);
        } else {
          // 未被摧毁的船只显示为普通船只样式
          cell.classList.add("ship");
        }
      }

      // 游戏结束后不降低棋盘亮度（保持所有按钮可点击状态）
      cell.disabled = !isFinished && (!canAttack || attacks.has(cellKey));
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
  if (roomState?.you?.ready) {
    addLog("你已经准备好了，无法再摆放军舰。", "tone-warning");
    return;
  }

  // 取消放置：点击已放置军舰的"第一格" → 取消该军舰
  // 移动：点击已放置军舰的"其他格子" → 以被点击格为新首格
  //  若移动非法，则改为取消该军舰（与悬停视觉一致）
  const existingPlacement = findPlacementAtCell(x, y);
  if (existingPlacement && isFirstCellOfPlacement(x, y, existingPlacement)) {
    const removed = unplaceShip(existingPlacement.id);
    if (removed) {
      addLog(`已取消 ${removed.label} 的摆放。`, "tone-success");
      updateSetup();
      renderOwnBoard();
    }
    return;
  }
  if (existingPlacement) {
    const movedPlacement = { ...existingPlacement, x, y };
    if (!placementIsValid(movedPlacement)) {
      // 移动非法 → 取消该军舰
      const removed = unplaceShip(existingPlacement.id);
      if (removed) {
        addLog(`无法移动，已取消 ${removed.label} 的摆放。`, "tone-warning");
        updateSetup();
        renderOwnBoard();
      }
      return;
    }
    const index = placements.findIndex((p) => p.id === existingPlacement.id);
    if (index !== -1) {
      placements.splice(index, 1, movedPlacement);
      selectedShipId = existingPlacement.id;
      addLog(`已移动 ${existingPlacement.label}。`, "tone-success");
      updateSetup();
      renderOwnBoard();
    }
    return;
  }

  ensureSelectedShip();
  const ship = selectedShip();
  if (!ship) {
    addLog("请先选择一艘军舰。", "tone-warning");
    return;
  }

  // 检查是否已经放置过这艘船（移动场景）
  const existingIndex = placements.findIndex(p => p.id === ship.id);
  const isReplacing = existingIndex !== -1;

  const placement = { ...ship, x, y, orientation };
  if (!placementIsValid(placement)) {
    addLog("这个位置不能摆放军舰。", "tone-danger");
    return;
  }

  // 如果已经放置过，先移除旧的
  if (isReplacing) {
    placements.splice(existingIndex, 1);
    addLog(`已将 ${ship.label} 移动到新位置。`, "tone-success");
  } else {
    addLog(`已放置 ${ship.label}。`, "tone-success");
  }

  placements.push(placement);
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
  const placedCount = placements.length;
  const totalCount = FLEET.length;
  els.readyButton.disabled = placedCount !== totalCount || roomState?.you?.ready;
  renderShipPicker();
}

function renderShipPicker() {
  els.shipPicker.innerHTML = "";
  FLEET.forEach((ship) => {
    const placed = isShipPlaced(ship.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ship-option ${selectedShipId === ship.id ? "active" : ""} ${placed ? "placed" : ""}`;
    button.innerHTML = `<span class="ship-marker" aria-hidden="true">✓</span><span>${ship.label}</span><strong>${ship.length}格</strong>`;
    button.disabled = roomState?.you?.ready;
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

  // 游戏结束后显示"下一局"按钮
  if (els.nextRoundButton) {
    els.nextRoundButton.style.display = roomState?.phase === "finished" ? "block" : "none";
  }

  // "退出房间"按钮：未在房间中时禁用，进入房间后启用；正在退出时显示加载文案
  if (els.leaveRoomButton) {
    els.leaveRoomButton.disabled = !roomState || isLeavingRoom;
    els.leaveRoomButton.textContent = isLeavingRoom ? "正在退出..." : "退出房间";
  }
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
    resetLocalGameState();
  }
  // 游戏重置（从 finished 进入 placing）时清空本地数据
  if (previousPhase === "finished" && roomState.phase === "placing") {
    resetLocalGameState();
  }
  // 新一局开始时（placing 阶段且玩家未准备），清空所有残留状态
  if (roomState.phase === "placing" && roomState.you && !roomState.you.ready) {
    if (placements.length > 0) {
      placements = [];
    }
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

els.readyButton.addEventListener("click", () => {
  socket.emit("place_fleet", { ships: placements });
});

els.resetPlacementButton.addEventListener("click", () => {
  if (roomState?.you?.ready) {
    addLog("你已经准备好了，无法重置。", "tone-warning");
    return;
  }
  if (placements.length === 0) {
    addLog("没有已放置的军舰。", "tone-warning");
    return;
  }
  if (confirm("确定要重置所有已放置的军舰吗？")) {
    placements = [];
    selectedShipId = FLEET[0]?.id || null;
    updateSetup();
    renderOwnBoard();
    addLog("已重置所有军舰。", "tone-success");
  }
});

els.leaveRoomButton.addEventListener("click", () => {
  handleLeaveRoomClick();
});

function handleLeaveRoomClick() {
  // 检查是否在房间中
  if (!roomState) {
    addLog("你当前不在任何房间中。", "tone-warning");
    return;
  }

  // 防止重复提交
  if (isLeavingRoom) {
    return;
  }

  // 确认对话框
  const confirmed = confirm("确定要退出房间吗？");
  if (!confirmed) {
    return;
  }

  // 进入加载状态
  isLeavingRoom = true;
  renderHeader();

  // 收集房间ID和用户身份
  const roomId = roomState.id;
  const playerId = roomState.you?.id || socket.id;
  const playerName = roomState.you?.name || "";

  // 设置超时定时器
  leaveRoomTimeoutId = setTimeout(() => {
    if (isLeavingRoom) {
      handleLeaveRoomFailure("退出房间超时，请检查网络连接。");
    }
  }, 8000);

  // 发送退出请求
  try {
    socket.emit("leave_room", { roomId, playerId, playerName });
  } catch (err) {
    handleLeaveRoomFailure("发送退出请求失败：" + (err.message || "未知错误"));
  }
}

function handleLeaveRoomSuccess() {
  // 清理超时定时器
  if (leaveRoomTimeoutId) {
    clearTimeout(leaveRoomTimeoutId);
    leaveRoomTimeoutId = null;
  }

  // 清除本地数据
  roomState = null;
  placements = [];
  selectedShipId = FLEET[0]?.id || null;
  hoverCell = null;
  eventLog = [];
  sunkShipCells = new Map();

  // 恢复按钮状态（必须在 renderHeader 之前清掉 isLeavingRoom，
  // 这样 renderHeader 才能正确把按钮置为"未在房间中"的禁用态）
  isLeavingRoom = false;

  // 重新渲染所有UI（回到非房间状态）
  renderHeader();
  updateSetup();
  renderInventory();
  renderBoards();
  renderLog();

  // 隐藏"下一局"按钮
  if (els.nextRoundButton) {
    els.nextRoundButton.style.display = "none";
  }

  addLog("你已退出房间", "tone-success");
}

function handleLeaveRoomFailure(errorMessage) {
  // 清理超时定时器
  if (leaveRoomTimeoutId) {
    clearTimeout(leaveRoomTimeoutId);
    leaveRoomTimeoutId = null;
  }

  // 恢复按钮状态（renderHeader 会根据 roomState 重新启用按钮）
  isLeavingRoom = false;
  renderHeader();

  // 显示错误并保留房间状态
  addLog(errorMessage || "退出房间失败，请重试。", "tone-danger");
}

function resetLocalGameState() {
  // 立即清空所有本地游戏数据
  placements = [];
  selectedShipId = FLEET[0].id;
  hoverCell = null;
  eventLog = [];
  sunkShipCells = new Map();
}

els.nextRoundButton.addEventListener("click", () => {
  if (!roomState || roomState.phase !== "finished") return;
  // 立即清空本地状态，确保即使服务器响应延迟也能重置
  resetLocalGameState();
  socket.emit("reset_game");
});

socket.on("room_state", syncRoomState);

socket.on("error_message", (message) => {
  addLog(message, "tone-danger");
});

socket.on("room_left", () => {
  console.log("Received room_left event");
  handleLeaveRoomSuccess();
});

socket.on("leave_room_failed", ({ message }) => {
  handleLeaveRoomFailure(message || "退出房间失败，请重试。");
});

socket.on("opponent_left", ({ playerId }) => {
  addLog("对手已退出房间", "tone-warning");
  if (roomState) {
    roomState.phase = "waiting";
    updateTurnUI();
  }
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

  // 独立记录被击沉的**对手**军舰格子（不受事件日志截断影响）
  // 关键守卫：sunkShip.cells 在我方击沉对手时记录的是**对手**棋盘坐标，
  // 在对手击沉我方时记录的是**我方**棋盘坐标。攻击棋盘只能使用前者。
  if (
    isAttacker &&
    publicResult.sunkShip &&
    Array.isArray(publicResult.sunkShip.cells) &&
    publicResult.sunkShip.cells.length > 0
  ) {
    publicResult.sunkShip.cells.forEach((cell) => {
      if (Number.isInteger(cell?.x) && Number.isInteger(cell?.y)) {
        sunkShipCells.set(key(cell), publicResult.sunkShip.orientation);
      }
    });
  }

  if (isAttacker) {
    const attackMark = privateResult?.attackBoardMark;
    const sunkShipInfo = publicResult.sunkShip ? {
      cells: publicResult.sunkShip.cells,
      orientation: publicResult.sunkShip.orientation
    } : null;
    eventLog.unshift({
      message: `你攻击 ${cellText}：${resultText}${publicResult.sunkShip ? `，摧毁 ${publicResult.sunkShip.label}` : ""}`,
      tone: publicResult.hit ? "tone-success" : "",
      at: new Date().toLocaleTimeString(),
      attackMark: { key: key(attackMark?.cell || publicResult.cell), result: attackMark?.result || (publicResult.hit ? "hit" : "miss"), sunkShipInfo }
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
  renderAttackBoard();
});

renderHeader();
updateSetup();
renderBoards();
renderLog();

// Setup click handlers after a short delay to ensure DOM is ready
setTimeout(() => {
  // Event delegation for own board clicks
  els.ownBoard.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    placeCurrentShip(x, y);
  });

  // Event delegation for own board hover
  els.ownBoard.addEventListener("mouseover", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    
    if (hoverCell?.x !== x || hoverCell?.y !== y) {
      hoverCell = { x, y };
      renderOwnBoard();
    }
  });

  els.ownBoard.addEventListener("mouseout", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    
    // 检查是否真的离开了棋盘
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && els.ownBoard.contains(relatedTarget)) {
      return;
    }
    
    hoverCell = null;
    renderOwnBoard();
  });

  // Event delegation for attack board clicks
  els.attackBoard.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || cell.disabled) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    attackCell(x, y);
  });

  // Touch event handling for mobile
  let touchStartTime = 0;
  
  els.ownBoard.addEventListener("touchstart", () => {
    touchStartTime = Date.now();
  }, { passive: true });

  els.ownBoard.addEventListener("touchend", (e) => {
    // Prevent double-tap zoom on mobile
    if (Date.now() - touchStartTime < 300) {
      e.preventDefault();
    }
    
    // Handle touch tap for placement
    const cell = e.target.closest(".cell");
    if (!cell) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    placeCurrentShip(x, y);
  }, { passive: false });

  els.attackBoard.addEventListener("touchstart", () => {
    touchStartTime = Date.now();
  }, { passive: true });

  els.attackBoard.addEventListener("touchend", (e) => {
    // Prevent double-tap zoom on mobile
    if (Date.now() - touchStartTime < 300) {
      e.preventDefault();
    }
    
    // Handle touch tap for attack
    const cell = e.target.closest(".cell");
    if (!cell || cell.disabled) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    attackCell(x, y);
  }, { passive: false });

  // Prevent context menu on long press
  els.ownBoard.addEventListener("contextmenu", (e) => e.preventDefault());
  els.attackBoard.addEventListener("contextmenu", (e) => e.preventDefault());
}, 100);
