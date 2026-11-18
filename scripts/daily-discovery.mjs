import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const label = 'com.rolemosaic.discovery';
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function discoveryPlist({ runtime, home, time, node = process.execPath }) {
  if (![runtime, home, node].every(value => typeof value === 'string' && path.isAbsolute(value))) {
    throw Error('Provide absolute runtime, workspace and Node paths.');
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw Error('Provide a local time as HH:MM (24-hour clock).');
  const [hour, minute] = time.split(':').map(Number);
  const log = xml(path.join(home, 'discovery.log'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string>
    <string>${xml(path.join(runtime, 'src', 'discovery.js'))}</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>ROLEMOSAIC_HOME</key><string>${xml(home)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string>
</dict></plist>\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { runtime: { type: 'string' }, home: { type: 'string' }, time: { type: 'string' }, write: { type: 'boolean' } } });
    const manifest = discoveryPlist(values);
    await Promise.all([access(path.join(values.runtime, 'src/discovery.js')), access(path.join(values.home, 'connections.json'))]);
    if (values.write) {
      if (process.platform !== 'darwin') throw Error('This login schedule requires macOS.');
      const directory = path.join(os.homedir(), 'Library/LaunchAgents');
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, label + '.plist');
      await writeFile(file, manifest, { flag: 'wx', mode: 0o600 });
      console.log('Wrote ' + file + '. Load the reviewed launch agent to enable discovery.');
    } else {
      process.stdout.write(manifest);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
