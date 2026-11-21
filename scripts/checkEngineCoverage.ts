import { relative, resolve } from 'node:path';
import ts from 'typescript';

const engineSources = new Bun.Glob('src/engine/**/*.{ts,tsx,mts,cts}');
const transpileTs = new Bun.Transpiler({ loader: 'ts' });
const transpileTsx = new Bun.Transpiler({ loader: 'tsx' });
const minimumCoverage = 80;
const slashPath = (path: string) => path.replaceAll('\\', '/');

async function runtimeSources(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  // Scan the working tree, not Git's index or the files Bun happened to load.
  for await (const path of engineSources.scan({ cwd: root, dot: true })) {
    if (/\.d\.[cm]?ts$/.test(path)) continue;
    const transpiler = path.endsWith('.tsx') ? transpileTsx : transpileTs;
    const emitted = transpiler.transformSync(await Bun.file(resolve(root, path)).text());
    const { statements } = ts.createSourceFile('runtime.js', emitted, ts.ScriptTarget.Latest);
    // Files whose types erase to nothing (or only to `export {}`) have no lines to cover.
    if (statements.some((node) => !ts.isEmptyStatement(node) && !(
      ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause &&
      ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0
    ))) files.add(slashPath(path));
  }
  return files;
}

export async function checkEngineCoverage(root: string, lcov: string) {
  const expected = await runtimeSources(root);
  if (expected.size === 0) throw new Error('No runtime TypeScript sources found in src/engine');

  const records = new Map<string, { found: number; hit: number }>();
  for (const record of lcov.split(/^end_of_record\r?$/m).slice(0, -1)) {
    const source = record.match(/^SF:(.+)\r?$/m)?.[1];
    if (!source) continue;
    const path = slashPath(relative(root, resolve(root, slashPath(source))));
    if (!expected.has(path)) continue;
    if (records.has(path)) throw new Error(`Duplicate LCOV record for ${path}`);
    records.set(path, {
      found: Number(record.match(/^LF:(\d+)\r?$/m)?.[1]),
      hit: Number(record.match(/^LH:(\d+)\r?$/m)?.[1]),
    });
  }

  const problems: string[] = [];
  let linesFound = 0;
  let linesHit = 0;
  for (const path of [...expected].sort()) {
    const record = records.get(path);
    if (!record) problems.push(`${path}: missing LCOV record`);
    else if (!Number.isSafeInteger(record.found) || !Number.isSafeInteger(record.hit) ||
      record.found <= 0 || record.hit <= 0 || record.hit > record.found) {
      problems.push(`${path}: expected positive LCOV line counts (LH=${record.hit}, LF=${record.found})`);
    } else {
      linesFound += record.found;
      linesHit += record.hit;
    }
  }
  if (problems.length) throw new Error(`Incomplete engine coverage:\n${problems.join('\n')}`);

  const coverage = (linesHit / linesFound) * 100;
  const summary = `Engine line coverage: ${coverage.toFixed(2)}% (${linesHit}/${linesFound})`;
  if (coverage < minimumCoverage) throw new Error(`${summary}; minimum is ${minimumCoverage}%`);
  return summary;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const report = Bun.file(resolve(root, 'coverage/lcov.info'));
  if (!await report.exists()) throw new Error('No coverage/lcov.info; run bun run test:coverage');
  console.log(await checkEngineCoverage(root, await report.text()));
}
