#!/usr/bin/env node
// Publishes config/<version>[/<channel>]/<name>.json to the same URL path, validated
// against the version's <name>.schema.json. --check validates without writing dist/.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = join(ROOT, 'config');
const DIST = join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');
const STABLE = 'stable';
const BASE_URL = 'https://casualties-hub.github.io/casualties-hub-config';
const BASE_PATH = new URL(BASE_URL).pathname;

const errors = [];
const fail = (file, message) => errors.push(`${relative(ROOT, file)}: ${message}`);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const list = (path, wanted) => readdirSync(path, { withFileTypes: true }).filter(wanted).map((e) => e.name).sort();
const dirsIn = (path) => list(path, (e) => e.isDirectory());
const filesIn = (path, suffix, exclude = ' ') => list(path, (e) => e.isFile() && e.name.endsWith(suffix) && !e.name.endsWith(exclude));
const documentsIn = (path) => filesIn(path, '.json', '.schema.json');
const schemasIn = (path) => filesIn(path, '.schema.json');

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'uncommitted';
  }
}

function compileSchema(path) {
  try {
    return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    const hint = /already exists/.test(error.message)
      ? '. Each schema needs its own "$id"; a schema copied from another version must have its "$id" updated to match'
      : '';
    fail(path, `could not be compiled as a JSON Schema: ${error.message}${hint}`);
    return null;
  }
}

function loadValidators(version) {
  const validators = new Map();
  for (const schema of schemasIn(join(CONFIG, version))) {
    validators.set(schema.replace('.schema.json', ''), compileSchema(join(CONFIG, version, schema)));
  }
  return validators;
}

// Rules a JSON Schema cannot express on its own.
function crossFieldChecks(file, doc) {
  const announcements = [doc.currentAnnouncement, ...(doc.previousAnnouncements ?? [])].filter(Boolean);

  const seen = new Set();
  for (const a of announcements) {
    if (seen.has(a.id)) fail(file, `announcement id "${a.id}" is used more than once; ids must be unique across currentAnnouncement and previousAnnouncements`);
    seen.add(a.id);
  }

  const skewMs = 24 * 60 * 60 * 1000;
  for (const a of announcements) {
    const at = Date.parse(a.publishedAtUtc);
    if (Number.isNaN(at)) fail(file, `announcement "${a.id}" has an unparseable publishedAtUtc "${a.publishedAtUtc}"`);
    else if (at > Date.now() + skewMs) fail(file, `announcement "${a.id}" is published more than a day in the future (${a.publishedAtUtc})`);
  }

  const history = doc.previousAnnouncements ?? [];
  for (let i = 1; i < history.length; i += 1) {
    if (Date.parse(history[i - 1].publishedAtUtc) < Date.parse(history[i].publishedAtUtc)) {
      fail(file, `previousAnnouncements must be ordered newest first, but "${history[i].id}" is newer than "${history[i - 1].id}"`);
    }
  }

  if (doc.currentAnnouncement && history.length && Date.parse(doc.currentAnnouncement.publishedAtUtc) < Date.parse(history[0].publishedAtUtc)) {
    fail(file, `currentAnnouncement "${doc.currentAnnouncement.id}" is older than the newest entry in previousAnnouncements ("${history[0].id}")`);
  }
}

function loadDocument(file, validate) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, `is not valid JSON: ${error.message}`);
    return null;
  }

  delete doc.$schema; // editor hint, never published

  if (!validate) return null; // no schema or one that failed to compile, reported by the caller
  if (!validate(doc)) {
    for (const e of validate.errors) fail(file, `${e.instancePath || '/'} ${e.message}`);
    return null;
  }

  crossFieldChecks(file, doc);
  return doc;
}

function collect() {
  const documents = [];
  if (!existsSync(CONFIG)) return documents;

  for (const version of dirsIn(CONFIG)) {
    if (!/^v\d+$/.test(version)) {
      fail(join(CONFIG, version), 'schema version directories must be named v1, v2, ...');
      continue;
    }
    const versionDir = join(CONFIG, version);
    const validators = loadValidators(version);
    const channels = [
      { channel: STABLE, dir: versionDir, urlPath: version },
      ...dirsIn(versionDir).map((channel) => ({ channel, dir: join(versionDir, channel), urlPath: `${version}/${channel}` })),
    ];

    for (const { channel, dir, urlPath } of channels) {
      if (channel !== STABLE) {
        for (const nested of dirsIn(dir)) {
          fail(join(dir, nested), 'is nested too deeply to be published. Documents live at config/<version>/<name>.json or config/<version>/<channel>/<name>.json');
        }
        for (const schema of schemasIn(dir)) {
          fail(join(dir, schema), `is in a channel directory and will never be read. Every channel of ${version} shares config/${version}/${schema}`);
        }
      }
      for (const fileName of documentsIn(dir)) {
        const file = join(dir, fileName);
        const name = fileName.slice(0, -'.json'.length);
        if (!validators.has(name)) fail(file, `has no schema at config/${version}/${name}.schema.json. Add one before publishing this document`);
        documents.push({ version, channel, urlPath, fileName, name, output: loadDocument(file, validators.get(name)) });
      }
    }
  }
  return documents;
}

const documents = collect();
if (!documents.length) fail(CONFIG, 'no config documents found');

if (errors.length) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'} found:\n`);
  for (const message of errors) console.error(`  ✗ ${message}`);
  console.error('');
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log(`✓ ${documents.length} document${documents.length === 1 ? '' : 's'} valid`);
  for (const doc of documents) console.log(`    ${doc.urlPath}/${doc.fileName}  (channel: ${doc.channel})`);
  process.exit(0);
}

rmSync(DIST, { recursive: true, force: true });

const manifest = documents.map((doc) => {
  mkdirSync(join(DIST, doc.urlPath), { recursive: true });
  writeFileSync(join(DIST, doc.urlPath, doc.fileName), `${JSON.stringify(doc.output, null, 2)}\n`);
  return {
    document: doc.name,
    schemaVersion: Number(doc.version.slice(1)),
    channel: doc.channel,
    path: `${BASE_PATH}/${doc.urlPath}/${doc.fileName}`,
    url: `${BASE_URL}/${doc.urlPath}/${doc.fileName}`,
  };
});

for (const version of dirsIn(CONFIG)) {
  for (const schema of schemasIn(join(CONFIG, version))) {
    cpSync(join(CONFIG, version, schema), join(DIST, version, schema));
  }
}

writeFileSync(join(DIST, 'index.json'), `${JSON.stringify({ commit: currentCommit(), documents: manifest }, null, 2)}\n`);
writeFileSync(join(DIST, '.nojekyll'), ''); // keeps Pages from running Jekyll over the output

console.log(`✓ built ${manifest.length} document${manifest.length === 1 ? '' : 's'} into dist/`);
for (const entry of manifest) console.log(`    ${entry.path}  (channel: ${entry.channel})`);
