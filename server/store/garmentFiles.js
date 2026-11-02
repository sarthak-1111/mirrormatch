// Uploads garment reference images (store catalogue assets, not personal data) to the YouCam
// File API once and reuses the file_id. YouCam keeps uploaded files for 30 days, so ids are
// cached on disk for 25 days.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const MAX_AGE_MS = 25 * 86400000;

export function createGarmentFiles({ youcam, publicDir, cachePath }) {
  let cache = null;
  const load = async () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(cachePath, 'utf8'));
    } catch {
      cache = {};
    }
    return cache;
  };
  const inflight = new Map();
  return {
    async fileIdFor(product) {
      if (!product.garmentImage) throw new Error(`No garment image for ${product.id}`);
      const c = await load();
      const key = `${youcam.mode}:${product.garmentImage}`;
      const hit = c[key];
      if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.fileId;
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        const buf = await readFile(join(publicDir, product.garmentImage));
        const fileId = await youcam.uploadImage(buf, { contentType: 'image/png', fileName: product.garmentImage.split('/').pop() });
        c[key] = { fileId, at: Date.now() };
        if (youcam.mode === 'live') {
          await mkdir(dirname(cachePath), { recursive: true });
          await writeFile(cachePath, JSON.stringify(c, null, 1));
        }
        return fileId;
      })();
      inflight.set(key, p);
      try {
        return await p;
      } finally {
        inflight.delete(key);
      }
    },
  };
}
