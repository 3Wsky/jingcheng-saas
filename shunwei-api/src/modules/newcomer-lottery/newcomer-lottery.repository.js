const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../../shared/config');

const defaultState = {
  config: null,
  users: {}
};

class NewcomerLotteryRepository {
  constructor(filePath = path.join(config.dataDir, 'newcomer-lottery.json')) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : structuredClone(defaultState);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(defaultState);
      throw error;
    }
  }

  async writeAll(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(state, null, 2);
    return fs.writeFile(this.filePath, payload, 'utf8');
  }

  async updateUser(uid, updater) {
    return this.updateAll((state) => {
      state.users[uid] = updater(state.users[uid] || null);
      return state;
    }).then((state) => state.users[uid]);
  }

  async updateAll(updater) {
    const previous = this.queue.catch(() => {});
    const task = previous.then(async () => {
      const state = await this.readAll();
      if (!state.users || typeof state.users !== 'object') state.users = {};
      const updated = updater(state) || state;
      if (!updated.users || typeof updated.users !== 'object') updated.users = {};
      await this.writeAll(updated);
      return updated;
    });

    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { NewcomerLotteryRepository };
