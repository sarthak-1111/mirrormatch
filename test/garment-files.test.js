// Garment references must be uploaded per session: YouCam's task/delete removes a task's input
// files too, so a file_id shared across sessions breaks after the first return's cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGarmentFiles } from '../server/store/garmentFiles.js';

const publicDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public');
const product = { id: 'dress-wrap-marigold', garmentImage: '/assets/garments/dress-wrap-marigold.png' };

function fakeYoucam() {
  const calls = [];
  return {
    calls,
    async uploadImage(buf, opts) {
      calls.push({ size: buf.length, ...opts });
      return `file-${calls.length}`;
    },
  };
}

test('garment is uploaded once per session and reused within it', async () => {
  const youcam = fakeYoucam();
  const g = createGarmentFiles({ youcam, publicDir });
  const session = {};
  const [a, b] = await Promise.all([g.fileIdFor(product, session), g.fileIdFor(product, session)]);
  assert.equal(a, b);
  assert.equal(await g.fileIdFor(product, session), a);
  assert.equal(youcam.calls.length, 1);
  assert.equal(youcam.calls[0].contentType, 'image/png');
});

test('a new session never reuses another session\'s garment file_id', async () => {
  const youcam = fakeYoucam();
  const g = createGarmentFiles({ youcam, publicDir });
  const first = await g.fileIdFor(product, {});
  const second = await g.fileIdFor(product, {});
  assert.notEqual(first, second);
  assert.equal(youcam.calls.length, 2);
});

test('a failed upload is not cached, so the next render can retry', async () => {
  let n = 0;
  const youcam = {
    async uploadImage() {
      n += 1;
      if (n === 1) throw new Error('network');
      return 'file-ok';
    },
  };
  const g = createGarmentFiles({ youcam, publicDir });
  const session = {};
  await assert.rejects(g.fileIdFor(product, session));
  assert.equal(await g.fileIdFor(product, session), 'file-ok');
});
