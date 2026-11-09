import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const home = path.resolve(process.env.ROLEMOSAIC_HOME || './private');
export async function read(name, fallback) {
  try { return JSON.parse(await readFile(path.join(home, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function write(name, data) {
  return writeText(name, JSON.stringify(data, null, 2) + '\n');
}
export async function writeText(name, text) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const dest = path.join(home, name), tmp = `${dest}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600, flag: 'wx' });
  await rename(tmp, dest);
}
