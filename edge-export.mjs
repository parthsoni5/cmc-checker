// Fallback for when the browser blocks compare.html from calling Experience Edge.
// Reads content from XM Cloud (read-only) and saves a .json file to drop into compare.html.
//
// The Context ID is read from an environment variable so it does not end up in your command history:
//   $env:EDGE_CONTEXT_ID = "<paste Preview Context ID>"
//   node edge-export.mjs --name preview --path "/sitecore/content/Collection/Site/Home"
//
// Options: --name preview|live (required)  --path <start path> (required)
//          --lang en[,fr]  --env XMC  --max 2000
import './edge-core.js';
import { writeFile } from 'node:fs/promises';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const contextId = process.env.EDGE_CONTEXT_ID;
if (!contextId || !args.name || !args.path) {
  console.error('Set $env:EDGE_CONTEXT_ID and pass --name preview|live and --path "<start path>". See README.md.');
  process.exit(1);
}

const result = await globalThis.EdgeExport.exportFromEdge({
  contextId,
  environment: args.env || 'XMC',
  database: args.name,
  rootPaths: [args.path],
  languages: (args.lang || 'en').split(',').map(s => s.trim()).filter(Boolean),
  maxItems: parseInt(args.max, 10) || 2000,
  onProgress: n => process.stdout.write(`\r${n} items`)
});

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const file = `content-${result.environment}-${args.name}-${stamp}.json`;
await writeFile(file, JSON.stringify(result));
console.log(`\nSaved ${result.items.length} items to ${file}`);
if (result.notFound.length) console.log(`Not found: ${result.notFound.join(', ')}`);
