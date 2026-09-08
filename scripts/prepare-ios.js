import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, ['scripts/build-mobile.js'], { cwd:root, stdio:'inherit' });
await fs.rm(path.join(root, 'ios/Web'), { recursive:true, force:true });
await fs.cp(path.join(root, 'dist/native-web'), path.join(root, 'ios/Web'), { recursive:true });
console.log('Bundled local assets. Open ios/MyTube.xcodeproj, choose MyTube, and Run.');
