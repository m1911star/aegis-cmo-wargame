import { Database } from 'bun:sqlite';
import { importCmoSqlite, type CmoImportOptions } from '../src/db/cmoSqliteMapper';
import { validateCatalogIntegrity } from '../src/db';

async function main() {
  const args = Bun.argv.slice(2);
  const options: CmoImportOptions = {};
  let dbPath = '', outPath = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--include-hypothetical') { options.includeHypothetical = true; continue; }
    if (!['--db', '--out', '--platforms', '--country', '--limit'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const next = args[++i];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--db') dbPath = next;
    if (arg === '--out') outPath = next;
    if (arg === '--platforms') options.platforms = next.split(',').map(s => s.trim()).filter(Boolean);
    if (arg === '--country') options.country = next;
    if (arg === '--limit') options.limit = Number(next);
  }
  if (!dbPath || !outPath) throw new Error('Usage: bun run scripts/importCmoDb.ts --db <file.db3> --out <catalog.json> [--platforms <ids,names>] [--country <id|name>] [--limit <n>] [--include-hypothetical]');
  if (dbPath === outPath) throw new Error('Output must not overwrite the source database');
  const db = new Database(dbPath, { readonly: true });
  try {
    const catalog = importCmoSqlite(db, options);
    const result = validateCatalogIntegrity(catalog);
    if (!result.valid) throw new Error(result.errors.join('\n'));
    await Bun.write(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`Imported ${Object.entries(catalog).filter(([, v]) => typeof v === 'object').map(([k, v]) => `${Object.keys(v).length} ${k}`).join(', ')} into ${outPath}`);
  } finally { db.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
