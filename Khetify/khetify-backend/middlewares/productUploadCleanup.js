const fs = require('fs');
const path = require('path');

const requests = new WeakMap();
const PRODUCT_UPLOAD_DIRECTORY = path.resolve(__dirname, '../uploads/products');

// Called only by the product Multer wrapper, never from request body data.
function capture(req, directory = PRODUCT_UPLOAD_DIRECTORY) {
  const root = path.resolve(directory);
  const files = new Set();
  for (const field of ['productImages', 'variantImages']) {
    for (const file of req.files?.[field] || []) {
      if (!file.path) continue;
      const target = path.resolve(file.path);
      if (path.dirname(target) === root) files.add(target);
    }
  }
  requests.set(req, { files, committed: false });
}

function commit(req) {
  const state = requests.get(req);
  if (state) state.committed = true;
}

async function rollback(req) {
  const state = requests.get(req);
  if (!state || state.committed) return;
  for (const target of state.files) {
    try {
      await fs.promises.unlink(target);
      state.files.delete(target);
    } catch (error) {
      if (error.code === 'ENOENT') state.files.delete(target);
      else console.error('Product upload cleanup failed:', error.code);
    }
  }
}

// A network/write acknowledgement error may follow an actual database write.
// Only known non-persisting errors permit rollback once a write was attempted.
async function rollbackRejected(req, error, writeStarted) {
  if (!writeStarted || ['ValidationError', 'CastError'].includes(error?.name) || error?.code === 11000) {
    await rollback(req);
  }
}

module.exports = { PRODUCT_UPLOAD_DIRECTORY, capture, commit, rollback, rollbackRejected };
