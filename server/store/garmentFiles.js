// Uploads garment reference images (store catalogue assets, not personal data) to the YouCam
// File API for clothes try-on.
//
// Verified live: POST /s2s/v2.0/task/delete removes a task's input files too, including the
// garment reference. Because MirrorMatch deletes every task when a return ends (privacy), a
// garment file_id must not be reused across sessions. So we upload per session (uploads are
// free: 0 units, ~0.3 s) and reuse the id only within the session.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createGarmentFiles({ youcam, publicDir }) {
  return {
    async fileIdFor(product, session) {
      if (!product.garmentImage) throw new Error(`No garment image for ${product.id}`);
      session.garmentFiles ??= {};
      if (!session.garmentFiles[product.id]) {
        session.garmentFiles[product.id] = (async () => {
          const buf = await readFile(join(publicDir, product.garmentImage));
          return youcam.uploadImage(buf, { contentType: 'image/png', fileName: product.garmentImage.split('/').pop() });
        })();
      }
      try {
        return await session.garmentFiles[product.id];
      } catch (e) {
        delete session.garmentFiles[product.id];
        throw e;
      }
    },
  };
}
