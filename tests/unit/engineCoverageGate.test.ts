import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEngineCoverage } from '../../scripts/checkEngineCoverage';

const mathSource = 'src/engine/math.ts';
const typesSource = 'src/engine/nested/mathTypes.ts';
const record = (source: string, found: number, hit: number) =>
  `TN:\nSF:${source}\nLF:${found}\nLH:${hit}\nend_of_record\n`;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'engine-coverage-fixture-'));
  await mkdir(join(root, 'src/engine/nested'), { recursive: true });
  await Bun.write(join(root, mathSource), 'export function double(n: number) { return n * 2; }\n');
  await Bun.write(join(root, typesSource), '/*! Type-only module */\nexport type Count = number;\nexport {};\n');
  await Bun.write(join(root, 'src/engine/ambient.d.ts'), 'declare const count: number;\n');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('counts only runtime engine files and resolves repository-relative and absolute source paths', async () => {
  const report = record(join(root, mathSource), 10, 8) + record(typesSource, 0, 0) +
    record('src/engine/removed.ts', 100, 100) + record('other/src/engine/math.ts', 100, 100);
  expect(await checkEngineCoverage(root, report)).toBe('Engine line coverage: 80.00% (8/10)');
});

test('fails when a newly added runtime file is missing even at 100% reported coverage', async () => {
  await Bun.write(join(root, 'src/engine/nested/new.ts'), 'export const count = 1;\n');
  const report = record(mathSource, 10, 10) + record('other/src/engine/nested/new.ts', 1, 1);
  await expect(checkEngineCoverage(root, report)).rejects.toThrow('src/engine/nested/new.ts: missing LCOV record');
});

test('fails when a previously type-only file gains runtime code without coverage', async () => {
  await Bun.write(join(root, typesSource), 'export type Count = number;\nexport const count: Count = 1;\n');
  await expect(checkEngineCoverage(root, record(mathSource, 10, 10))).rejects.toThrow(`${typesSource}: missing LCOV record`);
});

test.each([[0, 0], [1, 0], [1, 2]])('rejects invalid runtime line counts LF=%d, LH=%d', async (found, hit) => {
  await expect(checkEngineCoverage(root, record(mathSource, found, hit))).rejects.toThrow('expected positive LCOV line counts');
});

test('fails below the aggregate line coverage threshold', async () => {
  await expect(checkEngineCoverage(root, record(mathSource, 100, 79))).rejects.toThrow('minimum is 80%');
});
