const BOARD_SIZE = 11;

const FLEET_CONFIG = [
  { id: "ship-2-1", length: 2, label: "巡逻艇" },
  { id: "ship-3-1", length: 3, label: "驱逐舰 A" },
  { id: "ship-3-2", length: 3, label: "驱逐舰 B" },
  { id: "ship-4-1", length: 4, label: "战列舰" },
  { id: "ship-5-1", length: 5, label: "航空母舰" }
];

const ROOM_PHASES = {
  WAITING: "waiting",
  PLACING: "placing",
  BATTLE: "battle",
  FINISHED: "finished"
};

const ACTION_TYPES = {
  BASIC_ATTACK: "basic_attack"
};

module.exports = {
  BOARD_SIZE,
  FLEET_CONFIG,
  ROOM_PHASES,
  ACTION_TYPES
};
