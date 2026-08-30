import { relative, resolve } from 'node:path';

import ts from 'typescript';

import {
  ambientRoots,
  assertSourceImport,
  forbiddenGlobalIdentifiers,
  forbiddenProperties,
  privilegedTags,
  receiverIndependentSinks,
  safeAmbientIdentifiers,
  safeAmbientPaths,
  safeReflectionSites,
} from './security-source-policy.mjs';
import {
  dynamicElementAccessIsUnsafe,
  isActualGlobal,
  resolvedSymbol,
  staticString,
} from './security-type-analysis.mjs';

function propertyName(node, constants, checker) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isElementAccessExpression(node) && node.argumentExpression !== undefined
    ? staticString(node.argumentExpression, constants, checker)
    : undefined;
}

function bindingPropertyName(node, constants, checker) {
  if (!ts.isObjectBindingPattern(node.parent)) return undefined;
  const property = node.propertyName;
  if (property === undefined) return ts.isIdentifier(node.name) ? node.name.text : undefined;
  if (ts.isIdentifier(property) || ts.isStringLiteralLike(property) || ts.isNumericLiteral(property)) {
    return property.text;
  }
  return ts.isComputedPropertyName(property)
    ? staticString(property.expression, constants, checker)
    : undefined;
}

function ambientPath(node, constants, checker) {
  if (ts.isIdentifier(node) && ambientRoots.has(node.text) && isActualGlobal(node, checker)) return [node.text];
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const base = ambientPath(node.expression, constants, checker);
    const property = propertyName(node, constants, checker);
    return base === undefined || property === undefined ? undefined : [...base, property];
  }
  return undefined;
}

function outermostAccess(node) {
  let current = node;
  while ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
    && current.parent.expression === current) current = current.parent;
  return current;
}

function isNestedAccess(node) {
  return (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
    && node.parent.expression === node;
}

function containsAmbientRoot(node, checker) {
  let found = false;
  const inspect = (candidate) => {
    if (ts.isFunctionLike(candidate)) return;
    if (ts.isIdentifier(candidate) && ambientRoots.has(candidate.text)
      && isActualGlobal(candidate, checker)) found = true;
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

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    current = current.parent;
  }
  return undefined;
}

function isSafeReflection(node, property, file, checker) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)
    || !['Object', 'Array'].includes(node.expression.text)
    || !isActualGlobal(node.expression, checker)) return false;
  const functionName = enclosingFunctionName(node);
  return functionName !== undefined
    && safeReflectionSites.has(`${relative('.', file)}#${functionName}#${property}`);
}

function collectConstants(tree, checker) {
  const constants = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const symbol = resolvedSymbol(node.name, checker);
      const value = staticString(node.initializer, constants, checker);
      if (symbol !== undefined && value !== undefined) constants.set(symbol, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return constants;
}

async function scanSource(file, tree, checker, sourceRoot) {
  const constants = collectConstants(tree, checker);
  const imports = [];
  const violations = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression !== undefined
        && ts.isStringLiteral(node.moduleReference.expression)) imports.push(node.moduleReference.expression.text);
      else violations.push('TypeScript import alias');
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push('dynamic import');
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && isActualGlobal(node.expression, checker)) violations.push('require');
      const callPath = ambientPath(node.expression, constants, checker)?.join('.');
      const safeCall = callPath !== undefined && safeAmbientPaths.has(callPath);
      if (!safeCall && !safeAmbientIdentifiers.has(node.expression.getText(tree))
        && node.arguments.some((argument) => containsAmbientRoot(argument, checker))) {
        violations.push('ambient authority passed to unknown call');
      }
      if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        && propertyName(node.expression, constants, checker) === 'createElement') {
        const tag = node.arguments[0] === undefined ? undefined : staticString(node.arguments[0], constants, checker);
        if (tag === undefined || privilegedTags.has(tag.toLowerCase())) violations.push('privileged element creation');
      }
    }
    if (ts.isIdentifier(node) && !identifierIsPropertyName(node) && isActualGlobal(node, checker)) {
      if (forbiddenGlobalIdentifiers.has(node.text)) violations.push(`forbidden global identifier ${node.text}`);
      if (ambientRoots.has(node.text)) {
        const path = ambientPath(outermostAccess(node), constants, checker);
        if (path === undefined || !safeAmbientPaths.has(path.join('.'))) violations.push(`ambient authority ${node.text}`);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const path = ambientPath(node, constants, checker);
      const name = propertyName(node, constants, checker);
      if (dynamicElementAccessIsUnsafe(node, name, checker)) violations.push('forbidden dynamic capability access');
      if (name === undefined && ambientPath(node.expression, constants, checker) !== undefined) violations.push('unknown computed ambient property');
      if (name !== undefined && forbiddenProperties.has(name)
        && (receiverIndependentSinks.has(name) || path !== undefined)
        && !isSafeReflection(node, name, file, checker)) violations.push(`forbidden property ${name}`);
      if (!isNestedAccess(node) && path !== undefined && !safeAmbientPaths.has(path.join('.'))) violations.push(`ambient authority ${path.join('.')}`);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = bindingPropertyName(node, constants, checker);
      if (name === undefined && ts.isComputedPropertyName(node.propertyName)) {
        violations.push('unknown computed binding property');
      } else if (name !== undefined
        && (receiverIndependentSinks.has(name) || ['Reflect', 'Proxy'].includes(name))) {
        violations.push(`forbidden binding property ${name}`);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined
      && ambientPath(node.initializer, constants, checker) !== undefined) violations.push('ambient authority alias/destructure');
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && ambientPath(node.right, constants, checker) !== undefined) violations.push('ambient authority assignment');
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree).toLowerCase();
      if (privilegedTags.has(tag)) violations.push(`privileged JSX ${tag}`);
      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property) && property.name.getText(tree) === 'dangerouslySetInnerHTML') violations.push('unsafe JSX HTML');
      }
    }
    if (ts.isStringLiteralLike(node) && /(?:https?:)?\/\//u.test(node.text)) violations.push('source endpoint literal');
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (violations.length > 0) throw new Error(`${relative('.', file)} violates structural security policy: ${[...new Set(violations)].join(', ')}.`);
  await Promise.all(imports.map((specifier) => assertSourceImport(file, specifier, sourceRoot)));
}

export async function scanSourceFiles(sourceFiles, sourceRoot, configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) throw new Error('Security gate could not parse tsconfig.app.json.');
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve('.'));
  if (parsed.errors.length > 0) throw new Error('Security gate found TypeScript configuration diagnostics.');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  await Promise.all(sourceFiles.map(async (file) => {
    const tree = program.getSourceFile(resolve(file));
    if (tree === undefined) throw new Error(`${relative('.', file)} is absent from parsed tsconfig.app.json.`);
    if (program.getSyntacticDiagnostics(tree).length > 0) throw new Error(`${relative('.', file)} has TypeScript parse diagnostics.`);
    await scanSource(file, tree, checker, sourceRoot);
  }));
}
