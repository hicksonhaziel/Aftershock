import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'), output = join(root, '.aftershock/build');
mkdirSync(output, { recursive: true });
for (const [entry, name] of [['packages/runner/src/case-cli.ts', 'regression.mjs'], ['examples/trade-ledger/src/index.ts', 'adapter.mjs']])
  await build({ entryPoints: [join(root, entry)], outfile: join(output, name), bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false });
writeFileSync(join(output, 'schema.sql'), ['001_consumer_state.sql', '002_sample_event_payload.sql'].map(p => readFileSync(join(root, 'migrations', p), 'utf8')).join('\n'));
const hash = data => createHash('sha256').update(data).digest('hex');
const files = [];
const ref = path => ({ path, sha256: hash(readFileSync(join(output, path))) });
for (const name of ['regression.mjs', 'adapter.mjs', 'schema.sql']) files.push(ref(name));
const require = createRequire(join(root, 'packages/contracts/package.json'));
for (const [from, name] of [[join(root, 'LICENSE'), 'LICENSE'], [join(dirname(require.resolve('zod/package.json')), 'LICENSE'), 'LICENSE.zod']]) {
  writeFileSync(join(output, name), readFileSync(from)); files.push(ref(name));
}
const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  .filter(p => /^(packages\/(contracts|projection|runner|reference)\/src\/.*\.ts|examples\/trade-ledger\/src\/.*\.ts|migrations\/.*\.sql|pnpm-lock.yaml|scripts\/build-regression.mjs)$/.test(p));
const sourceFiles = [];
for (const path of [...new Set(sources)].sort()) {
  const destination = 'source/' + path; mkdirSync(dirname(join(output, destination)), { recursive: true });
  writeFileSync(join(output, destination), readFileSync(join(root, path))); const entry = ref(destination); sourceFiles.push(entry); files.push(entry);
}
writeFileSync(join(output, 'build-lock.json'), JSON.stringify({ sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim(),
  files, sourceFiles, implementationDigest: hash(JSON.stringify(sourceFiles)) }, null, 2) + '\n');
console.log('Built standalone regression runner and maintained adapter in .aftershock/build.');
