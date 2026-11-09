import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
export const home = path.resolve(process.env.ROLEMOSAIC_HOME || './private');
export async function read(name, fallback) {
  try { return JSON.parse(await readFile(path.join(home, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function write(name, data) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const dest = path.join(home, name), tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, dest);
}
