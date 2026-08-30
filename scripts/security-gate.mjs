/* global console */
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

import { scanBuiltAssets } from './security-built-policy.mjs';

const sourceRoot = resolve('src');
const distRoot = resolve('dist');
const allowedBareImports = new Set(['react', 'react-dom/client', 'zod']);
const ambientRoots = new Set(['window', 'globalThis', 'self', 'document', 'navigator', 'location', 'history']);
const safeAmbientPaths = new Set([
  'document.getElementById',
  'globalThis.matchMedia',
  'window.matchMedia',
  'window.setInterval',
  'window.clearInterval',
]);
const safeAmbientIdentifiers = new Set(['matchMedia']);
const forbiddenProperties = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie',
  'eval', 'Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'open', 'assign', 'replace', 'pushState', 'replaceState', 'submit', 'requestSubmit',
  'contentWindow', 'defaultView', 'ownerDocument',
]);
const receiverIndependentSinks = new Set([
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'contentWindow', 'defaultView', 'ownerDocument',
]);
const privilegedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form']);

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Security gate rejects symlink asset ${relative('.', path)}.`);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

function staticString(node, constants) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression, constants);
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, constants);
    const right = staticString(node.right, constants);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function propertyName(node, constants) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined) {
    return staticString(node.argumentExpression, constants);
  }
  return undefined;
}

function ambientPath(node, constants) {
  if (ts.isIdentifier(node) && ambientRoots.has(node.text)) return [node.text];
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const base = ambientPath(node.expression, constants);
    const property = propertyName(node, constants);
    return base === undefined || property === undefined ? undefined : [...base, property];
  }
  return undefined;
}

function isNestedAccess(node) {
  return (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
    && node.parent.expression === node;
}

function localImportCandidates(file, specifier) {
  const base = resolve(dirname(file), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, join(base, 'index.ts'), join(base, 'index.tsx')];
}

async function assertImport(file, specifier) {
  if (!specifier.startsWith('.')) {
    if (!allowedBareImports.has(specifier)) {
      throw new Error(`${relative('.', file)} has forbidden production import ${specifier}.`);
    }
    return;
  }
  for (const candidate of localImportCandidates(file, specifier)) {
    try {
      const resolved = await realpath(candidate);
      if (!resolved.startsWith(`${sourceRoot}/`)) {
        throw new Error(`${relative('.', file)} import escapes src: ${specifier}.`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes('escapes src')) throw error;
    }
  }
  throw new Error(`${relative('.', file)} has unresolved local import ${specifier}.`);
}

async function scanSource(file) {
  const source = await readFile(file, 'utf8');
  const kind = extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if (tree.parseDiagnostics.length > 0) {
    throw new Error(`${relative('.', file)} has TypeScript parse diagnostics.`);
  }
  const constants = new Map();
  const imports = [];
  const violations = [];

  const collect = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer !== undefined
      && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const value = staticString(node.initializer, constants);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push('dynamic import');
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') violations.push('require');
      if (ts.isIdentifier(node.expression)
        && ['fetch', 'eval', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Function'].includes(node.expression.text)) {
        violations.push(`forbidden call ${node.expression.text}`);
      }
      if (ts.isIdentifier(node.expression) && safeAmbientIdentifiers.has(node.expression.text)) {
        // Exact safe direct capability.
      }
      if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        && propertyName(node.expression, constants) === 'get'
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Reflect'
        && node.arguments.some((argument) => ambientPath(argument, constants) !== undefined)) {
        violations.push('Reflect ambient escape');
      }
      if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        && propertyName(node.expression, constants) === 'createElement') {
        const tag = node.arguments[0] === undefined ? undefined : staticString(node.arguments[0], constants);
        if (tag === undefined || privilegedTags.has(tag.toLowerCase())) violations.push('privileged element creation');
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !isNestedAccess(node)) {
      const path = ambientPath(node, constants);
      const name = propertyName(node, constants);
      if (name === undefined && ambientPath(node.expression, constants) !== undefined) {
        violations.push('unknown computed ambient property');
      }
      if (name !== undefined
        && forbiddenProperties.has(name)
        && (receiverIndependentSinks.has(name) || path !== undefined)) {
        violations.push(`forbidden property ${name}`);
      }
      if (path !== undefined && !safeAmbientPaths.has(path.join('.'))) {
        violations.push(`ambient authority ${path.join('.')}`);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined
      && ambientPath(node.initializer, constants) !== undefined) {
      violations.push('ambient authority alias/destructure');
    }
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && ambientPath(node.right, constants) !== undefined) {
      violations.push('ambient authority assignment');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree).toLowerCase();
      if (privilegedTags.has(tag)) violations.push(`privileged JSX ${tag}`);
      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property) && property.name.getText(tree) === 'dangerouslySetInnerHTML') {
          violations.push('unsafe JSX HTML');
        }
      }
    }
    if (ts.isStringLiteralLike(node) && /(?:https?:)?\/\//u.test(node.text)) {
      violations.push('source endpoint literal');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (violations.length > 0) {
    throw new Error(`${relative('.', file)} violates structural security policy: ${[...new Set(violations)].join(', ')}.`);
  }
  await Promise.all(imports.map((specifier) => assertImport(file, specifier)));
}

const sourceFiles = (await filesUnder(sourceRoot)).filter((file) =>
  ['.ts', '.tsx'].includes(extname(file))
    && !file.includes('.test.')
    && !file.startsWith(join(sourceRoot, 'test')));
await Promise.all(sourceFiles.map(scanSource));
const assetCounts = await scanBuiltAssets(distRoot, filesUnder);

console.log(`Structural security gate passed: ${sourceFiles.length} production TS/TSX files, parsed imports/ambient authority/computed aliases/capability sinks.`);
console.log(`Built asset gate passed: ${JSON.stringify(assetCounts)}, strict CSP/local references/zero network primitives, documented React and Zod vendor allowlists.`);
