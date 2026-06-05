class ActionRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(type, handler) {
    this.handlers.set(type, handler);
  }

  execute(context, action) {
    const handler = this.handlers.get(action?.type);
    if (!handler) {
      throw new Error("未知行动类型。");
    }
    return handler(context, action.payload || {});
  }
}

module.exports = {
  ActionRegistry
};
