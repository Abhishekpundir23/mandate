import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

import { JSDOM } from 'jsdom';
import ts from 'typescript';

const analyzedExtensions = new Set(['.ts', '.tsx']);
const unsupportedRuntimeExtensions = new Set(['.cts', '.jsx', '.js', '.mjs', '.cjs', '.mts']);
const resolvableExtensions = new Set([...analyzedExtensions, ...unsupportedRuntimeExtensions, '.css']);
const resolvedCandidates = [
  '', '.ts', '.tsx', '.css', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
];

function portable(path) {
  return path.split(sep).join('/');
}

function inside(root, file) {
  return file === root || file.startsWith(`${root}${sep}`);
}

function runtimeImport(statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.isTypeOnly === true) return undefined;
    if (clause?.name === undefined && clause?.namedBindings !== undefined
      && ts.isNamedImports(clause.namedBindings)
      && clause.namedBindings.elements.every((element) => element.isTypeOnly)) return undefined;
    return ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
  }
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return undefined;
    if (statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length > 0
      && statement.exportClause.elements.every((element) => element.isTypeOnly)) return undefined;
    return statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  }
  return undefined;
}

function scriptElements(html) {
  const document = new JSDOM(html).window.document;
  return [...document.querySelectorAll('script')].map((element) => ({
    attributes: new Map([...element.attributes].map((attribute) => [
      attribute.name.toLowerCase(),
      attribute.value,
    ])),
    body: element.textContent ?? '',
  }));
}

async function resolveHtmlEntry(htmlFile, reference, sourceRoot) {
  if (reference === '' || /[\\%&#?]/u.test(reference) || reference.includes(String.fromCharCode(0))
    || reference.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(reference)) {
    throw new Error(`HTML runtime entry has a remote, encoded, or ambiguous source: ${reference || '<empty>'}.`);
  }
  const projectRoot = dirname(htmlFile);
  const unresolved = reference.startsWith('/')
    ? resolve(projectRoot, reference.slice(1))
    : resolve(dirname(htmlFile), reference);
  let entry;
  try {
    entry = await realpath(unresolved);
  } catch {
    throw new Error(`HTML runtime entry does not resolve to a local file: ${reference}.`);
  }
  if (!inside(sourceRoot, entry)) {
    throw new Error(`HTML runtime entry escapes src: ${reference}.`);
  }
  rejectUnreceiptableModule(entry, sourceRoot);
  return entry;
}

export async function collectHtmlRuntimeEntries(htmlPath, sourceRootPath) {
  const canonicalRoot = await realpath(sourceRootPath);
  const htmlFile = await realpath(htmlPath);
  const html = await readFile(htmlFile, 'utf8');
  const document = new JSDOM(html).window.document;
  const refresh = [...document.querySelectorAll('meta[http-equiv]')].find((element) =>
    element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh');
  if (refresh !== undefined) throw new Error('HTML meta refresh navigation is forbidden.');
  const entries = [];
  for (const element of scriptElements(html)) {
    const rawType = element.attributes.get('type');
    if (rawType !== undefined && rawType.includes('&')) {
      throw new Error('HTML script type must not use entity-encoded markup.');
    }
    const type = (rawType ?? '').trim().toLowerCase();
    const executable = type === '' || type === 'module'
      || ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type);
    if (!executable) continue;
    if (type !== 'module') {
      throw new Error(`Executable HTML runtime entry uses unsupported script type ${type || '<classic>'}; only type=module is allowed.`);
    }
    const reference = element.attributes.get('src');
    if (reference === undefined) throw new Error('Inline executable HTML runtime entry is not allowed.');
    if (element.body.trim() !== '') throw new Error(`HTML runtime entry ${reference} contains inline executable content.`);
    entries.push(await resolveHtmlEntry(htmlFile, reference, canonicalRoot));
  }
  const unique = [...new Set(entries)].sort();
  if (unique.length === 0) throw new Error('HTML declares no analyzable runtime entries.');
  return unique;
}

async function resolveLocalImport(importer, specifier, sourceRoot) {
  const base = resolve(dirname(importer), specifier);
  const candidates = resolvableExtensions.has(extname(base))
    ? [base]
    : resolvedCandidates.map((suffix) => `${base}${suffix}`);
  for (const candidate of candidates) {
    try {
      const target = await realpath(candidate);
      if (!inside(sourceRoot, target)) {
        throw new Error(`${portable(relative('.', importer))} runtime import escapes src: ${specifier}.`);
      }
      return target;
    } catch (error) {
      if (error instanceof Error && error.message.includes('runtime import escapes src')) throw error;
    }
  }
  throw new Error(`${portable(relative('.', importer))} has unresolved runtime import ${specifier}.`);
}

function rejectUnreceiptableModule(file, sourceRoot) {
  const name = portable(relative(sourceRoot, file));
  if (name.startsWith('test/') || /(?:^|\/)test(?:s)?\//u.test(name) || /\.test\.[^.]+$/u.test(name)) {
    throw new Error(`Reachable production module src/${name} is test-scoped and cannot bypass an analysis receipt.`);
  }
  const extension = extname(file);
  if (unsupportedRuntimeExtensions.has(extension)) {
    throw new Error(`Reachable production module src/${name} uses unsupported executable extension ${extension}; every runtime module requires an analysis receipt.`);
  }
  if (!analyzedExtensions.has(extension)) {
    throw new Error(`Reachable production module src/${name} is outside the analyzed TS/TSX subset.`);
  }
}

export async function collectRuntimeSourceGraph(entryFiles, sourceRoot) {
  const canonicalRoot = await realpath(sourceRoot);
  const requestedEntries = Array.isArray(entryFiles) ? entryFiles : [entryFiles];
  const entries = await Promise.all(requestedEntries.map(async (entryFile) => realpath(entryFile)));
  if (entries.some((entry) => !inside(canonicalRoot, entry))) throw new Error('Production runtime entry escapes src.');
  const pending = [...entries];
  const visited = new Set();
  const localAssets = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    rejectUnreceiptableModule(file, canonicalRoot);
    visited.add(file);
    const source = await readFile(file, 'utf8');
    const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of tree.statements) {
      const specifier = runtimeImport(statement);
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const target = await resolveLocalImport(file, specifier, canonicalRoot);
      if (extname(target) === '.css') {
        localAssets.add(target);
      } else {
        pending.push(target);
      }
    }
  }

  const sourceFiles = [...visited].sort();
  const receipts = sourceFiles.map((file) => portable(relative('.', file))).sort();
  return {
    entry: entries.length === 1 ? portable(relative('.', entries[0])) : undefined,
    entries: entries.map((file) => portable(relative('.', file))).sort(),
    sourceFiles,
    receipts,
    localAssets: [...localAssets].map((file) => portable(relative('.', file))).sort(),
  };
}

export async function collectHtmlRuntimeSourceGraph(htmlFile, sourceRoot) {
  const entries = await collectHtmlRuntimeEntries(htmlFile, sourceRoot);
  const graph = await collectRuntimeSourceGraph(entries, sourceRoot);
  return {
    ...graph,
    html: portable(relative('.', await realpath(htmlFile))),
  };
}
