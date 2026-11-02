// Opt-in persistent cache for the demo owner (DEMO_CACHE=1). Keys are SHA-256 based, so a
// repeated demo with the same photo reuses the tone result and renders instead of spending
// units. Off by default: with it off, nothing personal is ever written to disk.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function createDemoCache({ enabled, dir }) {
  const fileFor = (key, ext) => join(dir, createHash('sha256').update(key).digest('hex').slice(0, 32) + ext);
  if (!enabled) {
    return { enabled: false, getJson: async () => null, setJson: async () => {}, getBinary: async () => null, setBinary: async () => {} };
  }
  return {
    enabled: true,
    async getJson(key) {
      try {
        return JSON.parse(await readFile(fileFor(key, '.json'), 'utf8'));
      } catch {
        return null;
      }
    },
    async setJson(key, value) {
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(key, '.json'), JSON.stringify(value));
    },
    async getBinary(key) {
      try {
        const meta = JSON.parse(await readFile(fileFor(key, '.meta.json'), 'utf8'));
        const buffer = await readFile(fileFor(key, '.bin'));
        return { buffer, contentType: meta.contentType };
      } catch {
        return null;
      }
    },
    async setBinary(key, { buffer, contentType }) {
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(key, '.bin'), buffer);
      await writeFile(fileFor(key, '.meta.json'), JSON.stringify({ contentType }));
    },
  };
}
