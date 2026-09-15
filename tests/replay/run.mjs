import { runSuite } from './replay-checks.mjs';

const mode = process.argv[2] ?? 'verify';
if (!['smoke', 'verify'].includes(mode))
  throw new Error('Use smoke or verify.');
const seedIndex = process.argv.indexOf('--seeds');
const seeds =
  seedIndex < 0
    ? undefined
    : process.argv[seedIndex + 1]?.split(',').map(Number);
if (
  seeds &&
  (!seeds.length ||
    seeds.length > 20 ||
    seeds.some(
      (seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff,
    ))
)
  throw new Error('Use 1–20 unsigned 32-bit seeds.');
const result = await runSuite({ smoke: mode === 'smoke', seeds });
console.log('Optics · verified activity replay checks');
console.table(result.outcomes);
console.log(
  result.passed + '/' + result.cases + ' passed; ' + result.failed + ' failed.',
);
console.log('Saved application databases and evidence: ' + result.directory);
process.exitCode = result.failed ? 1 : 0;
