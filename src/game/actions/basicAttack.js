const { assertAttackCell, cellKey } = require("../validators");

function findShipAt(player, cell) {
  return player.ships.find((ship) => ship.cells.some((shipCell) => cellKey(shipCell) === cellKey(cell)));
}

function isShipSunk(ship) {
  return ship.cells.every((cell) => ship.hits.includes(cellKey(cell)));
}

function basicAttack(context, payload) {
  const { actor, target } = context;
  const cell = { x: payload.x, y: payload.y };
  assertAttackCell(cell);

  const key = cellKey(cell);
  if (actor.attacks.has(key)) {
    throw new Error("该位置已经攻击过。");
  }

  actor.attacks.add(key);
  const ship = findShipAt(target, cell);
  const hit = Boolean(ship);
  let sunkShip = null;

  if (hit) {
    target.receivedHits.add(key);
    ship.hits.push(key);
    if (isShipSunk(ship)) {
      sunkShip = { id: ship.id, label: ship.label, length: ship.length };
    }
  } else {
    target.receivedMisses.add(key);
  }

  const allSunk = target.ships.every(isShipSunk);

  return {
    keepTurn: hit && !allSunk,
    winnerId: allSunk ? actor.id : null,
    publicResult: {
      type: "attack_result",
      attackerId: actor.id,
      defenderId: target.id,
      cell,
      hit,
      sunkShip,
      gameOver: allSunk
    },
    privateResultByPlayer: new Map([
      [
        actor.id,
        {
          attackBoardMark: { cell, result: hit ? "hit" : "miss", sunkShip }
        }
      ],
      [
        target.id,
        {
          ownBoardMark: { cell, result: hit ? "hit" : "miss", sunkShip }
        }
      ]
    ])
  };
}

module.exports = {
  basicAttack
};
