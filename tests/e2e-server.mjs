import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

mkdirSync(path.resolve('tests/.runtime'), { recursive: true });
const browserDatabase = path.resolve('tests/.runtime/browser.db');
if (!existsSync(browserDatabase)) writeFileSync(browserDatabase, '');
const environment = {
  ...process.env,
  DATABASE_URL: `file:${browserDatabase.replaceAll('\\', '/')}`,
  APP_MODE: 'demo', DEMO_AUTH: 'true', NEXT_DIST_DIR: '.next-e2e',
  SESSION_SECRET: 'synthetic-e2e-session-key-not-a-production-secret',
  LLM_API_KEY: '', OPENAI_API_KEY: '',
};
for (const args of [
  [path.resolve('node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'],
  [path.resolve('node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'],
]) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3100'], { env: environment, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
