import { existsSync, mkdirSync, closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = process.env.DATABASE_URL;
// Prisma's Windows schema engine can fail to create a new SQLite file during
// migrate deploy. Create only an absent, empty file; never overwrite a database.
if (databaseUrl?.startsWith('file:')) {
  const name = databaseUrl.slice(5).split('?')[0];
  const database = path.isAbsolute(name) ? name : path.resolve('prisma', name);
  mkdirSync(path.dirname(database), { recursive: true });
  if (!existsSync(database)) closeSync(openSync(database, 'wx'));
}
const result = spawnSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 1);
