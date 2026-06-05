const { BOARD_SIZE, FLEET_CONFIG } = require("./constants");

function isInsideBoard(cell) {
  return (
    Number.isInteger(cell?.x) &&
    Number.isInteger(cell?.y) &&
    cell.x >= 0 &&
    cell.x < BOARD_SIZE &&
    cell.y >= 0 &&
    cell.y < BOARD_SIZE
  );
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function normalizeShipPlacement(ship) {
  if (!ship || !Number.isInteger(ship.x) || !Number.isInteger(ship.y)) {
    return null;
  }

  const orientation = ship.orientation === "vertical" ? "vertical" : "horizontal";
  return {
    id: String(ship.id || ""),
    x: ship.x,
    y: ship.y,
    orientation
  };
}

function buildShipCells(ship, length) {
  return Array.from({ length }, (_, index) => ({
    x: ship.orientation === "horizontal" ? ship.x + index : ship.x,
    y: ship.orientation === "vertical" ? ship.y + index : ship.y
  }));
}

function validateFleetPlacement(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET_CONFIG.length) {
    return { ok: false, message: "舰队数量不正确。" };
  }

  const occupied = new Set();
  const normalized = [];

  for (const config of FLEET_CONFIG) {
    const placement = normalizeShipPlacement(ships.find((ship) => ship.id === config.id));
    if (!placement) {
      return { ok: false, message: `缺少 ${config.label} 的摆放信息。` };
    }

    const cells = buildShipCells(placement, config.length);
    if (!cells.every(isInsideBoard)) {
      return { ok: false, message: `${config.label} 超出棋盘范围。` };
    }

    for (const cell of cells) {
      const key = cellKey(cell);
      if (occupied.has(key)) {
        return { ok: false, message: `${config.label} 与其他军舰重叠。` };
      }
      occupied.add(key);
    }

    normalized.push({
      ...config,
      orientation: placement.orientation,
      cells,
      hits: []
    });
  }

  return { ok: true, ships: normalized };
}

function assertAttackCell(cell) {
  if (!isInsideBoard(cell)) {
    throw new Error("攻击坐标不合法。");
  }
}

module.exports = {
  isInsideBoard,
  cellKey,
  buildShipCells,
  validateFleetPlacement,
  assertAttackCell
};
