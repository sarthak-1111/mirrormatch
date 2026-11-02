// Scans every git-tracked (and staged) file for things that look like secrets.
// Exit code 1 if anything is found. Run before every push: npm run secret-scan
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f));

const PATTERNS = [
  ['YouCam/OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Bearer token literal', /Bearer\s+[A-Za-z0-9._-]{24,}/],
  ['RSA/PEM key', /-----BEGIN [A-Z ]*(PRIVATE|PUBLIC) KEY-----|MIG[fJ]MA0GCSqGSIb3DQEBAQUAA4/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Generic secret assignment', /\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i],
  ['YOUCAM_API_KEY with a value', /YOUCAM_API_KEY\s*=\s*[^\s#]{8,}/],
];

let hits = 0;
for (const f of files) {
  if (f === 'scripts/secret-scan.mjs') continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) {
        hits++;
        console.log(`${f}:${i + 1}  ${name}`);
      }
    }
  });
}
if (execSync('git ls-files .env', { encoding: 'utf8' }).trim()) {
  console.log('.env is tracked by git!');
  hits++;
}
console.log(hits ? `\n✘ ${hits} possible secret(s) found` : `✔ no secrets found in ${files.length} files`);
process.exit(hits ? 1 : 0);
