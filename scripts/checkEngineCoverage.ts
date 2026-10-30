const lcovPath = 'coverage/lcov.info';
const lcov = await Bun.file(lcovPath).text();
let engineFile = false;
let linesFound = 0;
let linesHit = 0;

for (const line of lcov.split('\n')) {
  if (line.startsWith('SF:')) {
    engineFile = line.slice(3).replaceAll('\\', '/').includes('src/engine/');
  } else if (engineFile && line.startsWith('LF:')) {
    linesFound += Number(line.slice(3));
  } else if (engineFile && line.startsWith('LH:')) {
    linesHit += Number(line.slice(3));
  }
}

if (linesFound === 0) {
  throw new Error(`No src/engine coverage records found in ${lcovPath}`);
}

const coverage = (linesHit / linesFound) * 100;
console.log(`Engine line coverage: ${coverage.toFixed(2)}% (${linesHit}/${linesFound})`);
if (coverage < 80) process.exit(1);
