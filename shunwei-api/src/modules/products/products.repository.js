const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../../shared/config');

const defaultState = {
  products: [],
  imports: []
};

class ProductsRepository {
  constructor(filePath = path.join(config.dataDir, 'products.json')) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(defaultState);
      throw error;
    }
  }

  async writeAll(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    return fs.writeFile(this.filePath, JSON.stringify(normalizeState(state), null, 2), 'utf8');
  }

  async updateAll(updater) {
    const previous = this.queue.catch(() => {});
    const task = previous.then(async () => {
      const state = await this.readAll();
      const updated = updater(state) || state;
      await this.writeAll(updated);
      return normalizeState(updated);
    });

    this.queue = task.catch(() => {});
    return task;
  }
}

function normalizeState(state) {
  const current = state && typeof state === 'object' ? state : {};
  return {
    products: Array.isArray(current.products) ? current.products : [],
    imports: Array.isArray(current.imports) ? current.imports : []
  };
}

module.exports = { ProductsRepository };
