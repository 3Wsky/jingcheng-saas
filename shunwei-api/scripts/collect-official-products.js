#!/usr/bin/env node

const fs = require('node:fs/promises');
const { ProductsService } = require('../src/modules/products/products.service');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const models = await readModels(args);
  if (!models.length) {
    throw new Error('No models provided. Use --models-file <path> or --models "A\\nB".');
  }

  const service = new ProductsService();
  const batches = chunk(models, 8);
  const results = [];
  for (const [index, batch] of batches.entries()) {
    console.log(`Collecting batch ${index + 1}/${batches.length}: ${batch.join(', ')}`);
    const result = await service.collectFromOfficial({
      models: batch,
      isShow: args.show !== 'false',
      categoryId: args.categoryId || undefined
    });
    results.push(result);
    console.log(JSON.stringify({
      batch: index + 1,
      models: batch,
      createdCount: result.createdCount || 0,
      updatedCount: result.updatedCount || 0,
      total: result.total || 0
    }));
  }

  const summary = results.reduce((acc, item) => {
    acc.total += Number(item.total || 0);
    acc.createdCount += Number(item.createdCount || 0);
    acc.updatedCount += Number(item.updatedCount || 0);
    acc.skippedCount += Number(item.skippedCount || 0);
    return acc;
  }, { total: 0, createdCount: 0, updatedCount: 0, skippedCount: 0 });
  console.log('Official collect complete:', JSON.stringify(summary));
}

async function readModels(args) {
  const raw = args.modelsFile
    ? await fs.readFile(args.modelsFile, 'utf8')
    : String(args.models || '');
  return raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[toCamel(key.slice(2))] = value;
  }
  return args;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
