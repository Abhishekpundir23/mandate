/* global console */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

import { scanBuiltAssets } from './security-built-policy.mjs';
import {
  ambientRoots,
  assertSourceImport,
  forbiddenGlobalIdentifiers,
  forbiddenProperties,
  privilegedTags,
  receiverIndependentSinks,
  safeAmbientIdentifiers,
  safeAmbientPaths,
} from './security-source-policy.mjs';

const sourceRoot = resolve('src');
const distRoot = resolve('dist');

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

function outermostAccess(node) {
  let current = node;
  while ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
    && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}

function isInsideSafeAmbientPath(node, constants) {
  const path = ambientPath(outermostAccess(node), constants);
  return path !== undefined && safeAmbientPaths.has(path.join('.'));
}

function containsAmbientRoot(node) {
  let found = false;
  const inspect = (candidate) => {
    if (ts.isFunctionLike(candidate)) return;
    if (ts.isIdentifier(candidate) && ambientRoots.has(candidate.text)) found = true;
    if (!found) ts.forEachChild(candidate, inspect);
  };
  inspect(node);
  return found;
}

function identifierIsPropertyName(node) {
  return (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    || (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    || (ts.isMethodDeclaration(node.parent) && node.parent.name === node)
    || (ts.isPropertyDeclaration(node.parent) && node.parent.name === node)
    || (ts.isPropertySignature(node.parent) && node.parent.name === node);
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
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression !== undefined
        && ts.isStringLiteral(node.moduleReference.expression)) {
        imports.push(node.moduleReference.expression.text);
      } else {
        violations.push('TypeScript import alias');
      }
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
      const callPath = ambientPath(node.expression, constants)?.join('.');
      const safeCall = callPath !== undefined && safeAmbientPaths.has(callPath);
      if (!safeCall && !safeAmbientIdentifiers.has(node.expression.getText(tree))
        && node.arguments.some(containsAmbientRoot)) {
        violations.push('ambient authority passed to unknown call');
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
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
      && forbiddenGlobalIdentifiers.has(node.expression.text)) {
      violations.push(`forbidden constructor ${node.expression.text}`);
    }
    if (ts.isIdentifier(node) && !identifierIsPropertyName(node)) {
      if (forbiddenGlobalIdentifiers.has(node.text)) {
        violations.push(`forbidden global identifier ${node.text}`);
      }
      if (ambientRoots.has(node.text) && !isInsideSafeAmbientPath(node, constants)) {
        violations.push(`ambient authority ${node.text}`);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
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
      if (!isNestedAccess(node) && path !== undefined && !safeAmbientPaths.has(path.join('.'))) {
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
  await Promise.all(imports.map((specifier) => assertSourceImport(file, specifier, sourceRoot)));
}

const sourceFiles = (await filesUnder(sourceRoot)).filter((file) =>
  ['.ts', '.tsx'].includes(extname(file))
    && !file.includes('.test.')
    && !file.startsWith(join(sourceRoot, 'test')));
await Promise.all(sourceFiles.map(scanSource));
const assetCounts = await scanBuiltAssets(distRoot, filesUnder);

console.log(`Structural security gate passed: ${sourceFiles.length} production TS/TSX files, parsed imports/ambient authority/computed aliases/capability sinks.`);
console.log(`Built asset gate passed: ${JSON.stringify(assetCounts)}, strict CSP/local references/zero network primitives, documented React and Zod vendor allowlists.`);
