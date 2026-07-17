// Validates every src/data/*.json file against its JSON Schema in schema/.
// Run standalone via `npm run validate-data`, or automatically before
// `npm run build` via the "prebuild" npm lifecycle script.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'schema');
const DATA_DIR = path.join(ROOT, 'src', 'data');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const FILES = [
  'balance.json',
  'biomes.json',
  'boons.json',
  'bosses.json',
  'brands.json',
  'classes.json',
  'colors.json',
  'combat.json',
  'floor-events.json',
  'hazards.json',
  'modifiers.json',
  'monster-ai.json',
  'monsters.json',
  'npcs.json',
  'omens.json',
  'patrons.json',
  'rescues.json',
  'shapes.json',
  'smiths.json',
  'sprite-map.json',
];

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });

// Shared fragment referenced via relative filename ($ref: "_effect-spec.schema.json")
// from boons/brands/modifiers/classes schemas.
const effectSpecSchema = readJson(path.join(SCHEMA_DIR, '_effect-spec.schema.json'));
ajv.addSchema(effectSpecSchema, '_effect-spec.schema.json');

let hasErrors = false;

for (const file of FILES) {
  const base = file.replace(/\.json$/, '');
  const schemaPath = path.join(SCHEMA_DIR, `${base}.schema.json`);
  const dataPath = path.join(DATA_DIR, file);

  const schema = readJson(schemaPath);
  const data = readJson(dataPath);
  const validate = ajv.compile(schema);

  if (validate(data)) {
    console.log(`✓ ${file}`);
  } else {
    hasErrors = true;
    console.error(`✗ ${file}`);
    for (const err of validate.errors ?? []) {
      console.error(`    ${err.instancePath || '(root)'} ${err.message}`);
    }
  }
}

if (hasErrors) {
  console.error('\nData validation failed.');
  process.exit(1);
}

console.log(`\nAll ${FILES.length} data files valid against their schemas.`);
