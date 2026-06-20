const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../../shared/config');

const defaultState = { items: {} };

class IntegralProductExtRepository {
  constructor(filePath = path.join(config.dataDir, 'integral-product-ext.json')) {
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
    return fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async updateAll(updater) {
    const previous = this.queue.catch(() => {});
    const task = previous.then(async () => {
      const state = await this.readAll();
      const updated = updater(state) || state;
      await this.writeAll(updated);
      return updated;
    });
    this.queue = task;
    return task;
  }

  async get(productId) {
    const state = await this.readAll();
    return state.items[String(productId)] || null;
  }

  async save(productId, payload) {
    await this.updateAll((state) => {
      state.items[String(productId)] = {
        ...payload,
        updatedAt: Math.floor(Date.now() / 1000)
      };
      return state;
    });
    return this.get(productId);
  }
}

module.exports = { IntegralProductExtRepository };
