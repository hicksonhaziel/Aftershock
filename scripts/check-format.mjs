import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(p => /\.(ts|mjs|json|sql|ya?ml)$/.test(p));
let failed = false;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('\r') || /[\t ]+$/m.test(text) || !text.endsWith('\n')) {
    console.error(`Whitespace formatting check failed: ${file}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Whitespace formatting checked in ${files.length} tracked source/configuration files.`);
