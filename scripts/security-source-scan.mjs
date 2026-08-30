import { relative, resolve } from 'node:path';

import ts from 'typescript';

import { normalizeProgram } from './security-assignment-analysis.mjs';
import {
  approvedMediaQueries,
  assertSourceImport,
  browserFacadePath,
  effectIsBudgeted,
  forbiddenGlobalIdentifiers,
  forbiddenHostEffects,
  hostEffects,
  privilegedTags,
} from './security-source-policy.mjs';
import {
  createOriginAnalysis,
  describeOrigin,
  expressionTypeIsUncertain,
  isActualGlobal,
  isProvenMutableLocal,
} from './security-type-analysis.mjs';

const dangerousProjectionNames = new Set([
  '__proto__',
  'constructor',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getPrototypeOf',
  'prototype',
]);

const ambientNames = new Set([
  'window',
  'globalThis',
  'self',
  'document',
  'navigator',
  'location',
  'history',
]);

function nodeLocation(node) {
  const file = node.getSourceFile();
  const point = file.getLineAndCharacterOfPosition(node.getStart(file));
  return {
    file: relative('.', file.fileName),
    line: point.line + 1,
    column: point.character + 1,
  };
}

function diagnostic(node, code, message, provenance) {
  const location = nodeLocation(node);
  return {
    ...location,
    code,
    message,
    provenance: provenance ?? 'syntax-derived closed-world policy',
  };
}

function formatDiagnostic(item) {
  return `${item.file}:${item.line}:${item.column} [${item.code}] ${item.message}; provenance: ${item.provenance}`;
}

function isPropertyNameIdentifier(node) {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.propertyName === node)
    || (ts.isImportSpecifier(parent) && parent.propertyName === node);
}

function outerAccess(node) {
  let current = node;
  while ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
    && current.parent.expression === current) current = current.parent;
  return current;
}

function containingCallee(node) {
  const access = outerAccess(node);
  const parent = access.parent;
  return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === access
    ? parent
    : undefined;
}

function jsxTag(node) {
  return node.tagName.getText(node.getSourceFile()).toLowerCase();
}

function targetKey(write, analysis) {
  if (write.literalKey !== undefined) return write.literalKey;
  if (write.keyNode !== undefined) return analysis.staticKey(write.keyNode);
  return undefined;
}

function mutationEffect(receiver) {
  return receiver.tags.has('UiCell') ? 'HOST_UI_STATE' : 'HOST_LOCAL_MUTATION';
}

function getterFreeObject(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) && current.properties.every((property) => {
    if (ts.isSpreadAssignment(property) || ts.isGetAccessor(property) || ts.isSetAccessor(property)) return false;
    if (ts.isPropertyAssignment(property)) {
      const name = property.name.getText().replace(/^['"]|['"]$/gu, '');
      return name !== '__proto__' && name !== 'get' && name !== 'set';
    }
    return ts.isShorthandPropertyAssignment(property);
  });
}

function descriptorIsDataOnly(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  if (!ts.isObjectLiteralExpression(current)) return false;
  return current.properties.every((property) => {
    if (ts.isSpreadAssignment(property) || ts.isGetAccessor(property) || ts.isSetAccessor(property)) return false;
    const name = property.name?.getText().replace(/^['"]|['"]$/gu, '');
    return name !== 'get' && name !== 'set' && name !== '__proto__';
  });
}

function descriptorMapIsDataOnly(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) && current.properties.every((property) =>
    ts.isPropertyAssignment(property) && descriptorIsDataOnly(property.initializer));
}

function callName(node, analysis) {
  const callee = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && callee.argumentExpression !== undefined) {
    return analysis.staticString(callee.argumentExpression);
  }
  return undefined;
}

function callArguments(node) {
  return ts.isTaggedTemplateExpression(node) ? [] : [...(node.arguments ?? [])];
}

function importedSpecifiers(tree) {
  const imports = [];
  for (const statement of tree.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push({ node: statement.moduleSpecifier, specifier: statement.moduleSpecifier.text });
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      const expression = ts.isExternalModuleReference(statement.moduleReference)
        ? statement.moduleReference.expression
        : undefined;
      imports.push({
        node: statement,
        specifier: expression !== undefined && ts.isStringLiteral(expression)
          ? expression.text
          : '<TypeScript import alias>',
        importEquals: true,
      });
    }
  }
  return imports;
}

function rawAmbientEffect(node) {
  const text = outerAccess(node).getText();
  if (/matchMedia/u.test(text)) return 'HOST_VIEWPORT_READ';
  if (/setInterval|clearInterval/u.test(text)) return 'HOST_TIMER';
  if (/getElementById/u.test(text)) return 'HOST_DOM_MOUNT';
  if (/location|history/u.test(text)) return 'HOST_NAVIGATION';
  if (/navigator/u.test(text)) return 'HOST_NETWORK';
  return 'HOST_UNKNOWN';
}

function addEffect(report, file, effect) {
  report.totals.set(effect, (report.totals.get(effect) ?? 0) + 1);
  if (!report.modules.has(file)) report.modules.set(file, new Map());
  const module = report.modules.get(file);
  module.set(effect, (module.get(effect) ?? 0) + 1);
}

function formatEffectReport(report) {
  const effects = hostEffects.map((effect) => `${effect}=${report.totals.get(effect) ?? 0}`).join(', ');
  const forbidden = [...forbiddenHostEffects]
    .reduce((total, effect) => total + (report.totals.get(effect) ?? 0), 0);
  const unknown = report.totals.get('HOST_UNKNOWN') ?? 0;
  const modules = [...report.modules.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, values]) => `${file}[${[...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([effect, count]) => `${effect}:${count}`)
      .join('|')}]`)
    .join(', ');
  return `${effects}; forbidden=${forbidden}; unknown=${unknown}; modules=${modules}`;
}

export async function scanSourceFiles(sourceFiles, sourceRoot, configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) throw new Error('Security gate could not parse tsconfig.app.json.');
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve('.'));
  if (parsed.errors.length > 0) throw new Error('Security gate found TypeScript configuration diagnostics.');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const trees = [];
  const diagnostics = [];

  for (const file of [...sourceFiles].sort()) {
    const tree = program.getSourceFile(resolve(file));
    if (tree === undefined) throw new Error(`${relative('.', file)} is absent from parsed tsconfig.app.json.`);
    if (program.getSyntacticDiagnostics(tree).length > 0) throw new Error(`${relative('.', file)} has TypeScript parse diagnostics.`);
    trees.push(tree);
    for (const item of importedSpecifiers(tree)) {
      if (item.importEquals === true) {
        diagnostics.push(diagnostic(item.node, 'IMPORT_ALIAS', 'TypeScript import aliases are outside the production subset'));
        continue;
      }
      try {
        await assertSourceImport(file, item.specifier, sourceRoot);
      } catch (error) {
        diagnostics.push(diagnostic(item.node, 'IMPORT_BOUNDARY', error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const ir = normalizeProgram(trees);
  const analysis = createOriginAnalysis({ checker, sourceFiles: trees, ir });
  const report = { totals: new Map(), modules: new Map() };
  const hasSourceDeclaration = (node) => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol?.declarations?.some((declaration) => {
      const file = resolve(declaration.getSourceFile().fileName);
      return file === sourceRoot || file.startsWith(`${sourceRoot}/`);
    }) ?? false;
  };

  const recordEffect = (node, effect, message, provenance) => {
    const file = relative('.', node.getSourceFile().fileName);
    addEffect(report, file, effect);
    if (forbiddenHostEffects.has(effect) || !effectIsBudgeted(node.getSourceFile().fileName, effect)) {
      diagnostics.push(diagnostic(
        node,
        forbiddenHostEffects.has(effect) ? 'FORBIDDEN_EFFECT' : 'MODULE_EFFECT_BUDGET',
        `${message} emits ${effect}, which is ${forbiddenHostEffects.has(effect) ? 'forbidden' : 'outside this module effect budget'}`,
        provenance,
      ));
    }
  };

  for (const unsupported of ir.unsupported) {
    diagnostics.push(diagnostic(unsupported.node, 'UNSUPPORTED_TARGET', `unsupported ${unsupported.channel} target is outside the closed production subset`));
  }

  for (const write of ir.writes) {
    const receiver = analysis.originOf(write.receiver);
    const key = targetKey(write, analysis);
    if (!isProvenMutableLocal(receiver)) {
      diagnostics.push(diagnostic(
        write.node,
        'UNPROVEN_WRITE_RECEIVER',
        `${write.channel} write to ${write.receiver.getText()} is not a proven fresh local allocation or UI cell (${describeOrigin(receiver)})`,
        `${write.receiver.getText()} -> ${describeOrigin(receiver)}`,
      ));
      continue;
    }
    if (key === '__proto__') {
      diagnostics.push(diagnostic(write.node, 'PROTOTYPE_WRITE', 'writes to __proto__ are forbidden'));
      continue;
    }
    if (key === undefined && !receiver.nullPrototype) {
      diagnostics.push(diagnostic(
        write.node,
        'UNKNOWN_PROTOTYPE_KEY',
        'prototype-bearing local object writes require a finite safe key; unknown keys are limited to owned null-prototype dictionaries',
        describeOrigin(receiver),
      ));
      continue;
    }
    recordEffect(write.node, mutationEffect(receiver), `${write.channel} local write`, describeOrigin(receiver));
  }

  for (const call of ir.calls) {
    const resolution = analysis.resolveCall(call.node);
    const name = callName(call.node, analysis);
    const args = callArguments(call.node);
    for (const effect of resolution.effects) {
      recordEffect(call.node, effect, `${call.kind.toLowerCase()} ${call.node.getText().slice(0, 120)}`, `${resolution.description}; ${describeOrigin(resolution.callee)}`);
    }
    for (const mutation of resolution.mutationReceivers) {
      if (!isProvenMutableLocal(mutation.receiver)) {
        diagnostics.push(diagnostic(
          call.node,
          'UNPROVEN_MUTATION_RECEIVER',
          `${mutation.label} is not a proven fresh local allocation or UI cell (${describeOrigin(mutation.receiver)})`,
          `${call.node.getText().slice(0, 120)} -> ${mutation.label} -> ${describeOrigin(mutation.receiver)}`,
        ));
      }
    }
    if (resolution.description.includes('Object.assign')) {
      for (const source of args.slice(1)) {
        if (!getterFreeObject(source)) diagnostics.push(diagnostic(source, 'UNPROVEN_ASSIGN_SOURCE', 'Object.assign sources must be direct owned getter-free object literals'));
      }
    }
    const defineProperty = name === 'defineProperty' || resolution.description.includes('defineProperty');
    const defineProperties = name === 'defineProperties' || resolution.description.includes('defineProperties');
    if (defineProperty || defineProperties) {
      const descriptor = defineProperties ? args[1] : args[2];
      const safe = descriptor !== undefined && (defineProperties
        ? descriptorMapIsDataOnly(descriptor)
        : descriptorIsDataOnly(descriptor));
      if (!safe) {
        diagnostics.push(diagnostic(call.node, 'ACCESSOR_DESCRIPTOR', 'only direct data-only descriptors are supported; accessors and unresolved descriptor maps are forbidden'));
      }
    }
    if (['call', 'apply', 'bind'].includes(name ?? '')) {
      const callee = ts.isCallExpression(call.node) || ts.isNewExpression(call.node) ? call.node.expression : call.node.tag;
      const receiver = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) ? analysis.originOf(callee.expression) : undefined;
      if (receiver === undefined || receiver.callables.some((entry) => !['function', 'react'].includes(entry.kind))) {
        diagnostics.push(diagnostic(call.node, 'UNRESOLVED_META_CALL', `${name} is allowed only on a directly analyzed local callable`, receiver === undefined ? undefined : describeOrigin(receiver)));
      }
    }
    if (name === 'matchMedia') {
      const query = args[0] === undefined ? undefined : analysis.staticString(args[0]);
      if (query === undefined || !approvedMediaQueries.has(query)) diagnostics.push(diagnostic(call.node, 'UNAPPROVED_MEDIA_QUERY', 'matchMedia requires an approved finite query'));
    }
    if (name === 'getElementById') {
      const id = args[0] === undefined ? undefined : analysis.staticString(args[0]);
      if (id !== 'root') diagnostics.push(diagnostic(call.node, 'UNAPPROVED_DOM_MOUNT', 'the browser facade may mount only into hard-coded #root'));
    }
  }

  for (const binding of ir.bindings) {
    for (const step of binding.projection) {
      const key = typeof step === 'object' ? step.property ?? (step.keyNode === undefined ? undefined : analysis.staticString(step.keyNode)) : undefined;
      if (key !== undefined && dangerousProjectionNames.has(String(key))) {
        diagnostics.push(diagnostic(binding.node, 'DANGEROUS_BINDING_PROJECTION', `binding projection ${String(key)} is outside the closed callable subset`));
      }
    }
  }

  for (const tree of trees) {
    const isFacade = relative('.', tree.fileName) === browserFacadePath;
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) diagnostics.push(diagnostic(node, 'DYNAMIC_IMPORT', 'dynamic import is forbidden'));
      if (ts.isIdentifier(node) && !isPropertyNameIdentifier(node)
        && (isActualGlobal(node, checker) || !hasSourceDeclaration(node))) {
        if (forbiddenGlobalIdentifiers.has(node.text)) {
          const effect = node.text === 'eval' || node.text === 'Function' || node.text === 'Proxy'
            ? 'HOST_DYNAMIC_CODE'
            : ['localStorage', 'sessionStorage', 'indexedDB', 'caches'].includes(node.text)
              ? 'HOST_STORAGE'
              : ['location', 'history'].includes(node.text)
                ? 'HOST_NAVIGATION'
                : ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator'].includes(node.text)
                  ? 'HOST_NETWORK'
                  : 'HOST_UNKNOWN';
          recordEffect(node, effect, `raw forbidden global ${node.text}`, `actual global symbol ${node.text}`);
        } else if (ambientNames.has(node.text) && containingCallee(node) === undefined) {
          recordEffect(node, rawAmbientEffect(node), `raw ambient authority ${outerAccess(node).getText()}`, `actual ambient global ${node.text}`);
        }
      }
      if (ts.isElementAccessExpression(node)) {
        const key = node.argumentExpression === undefined ? undefined : analysis.staticKey(node.argumentExpression);
        const receiver = analysis.originOf(node.expression);
        const result = analysis.originOf(node);
        if (key === undefined && (receiver.tags.has('Ambient') || result.tags.has('Callable')
          || expressionTypeIsUncertain(node, checker)
          || (ts.isReturnStatement(node.parent) && !isProvenMutableLocal(receiver)))) {
          diagnostics.push(diagnostic(node, 'UNKNOWN_COMPUTED_ACCESS', 'computed access must resolve to a finite key or proven local inert data', `${describeOrigin(receiver)} -> ${describeOrigin(result)}`));
        }
        if (key === 'constructor' && (result.tags.has('Callable') || result.tags.has('Unknown'))) diagnostics.push(diagnostic(node, 'DYNAMIC_CONSTRUCTOR_ACCESS', 'dynamic constructor access is forbidden', describeOrigin(result)));
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'constructor') {
        const receiver = analysis.originOf(node.expression);
        if (receiver.tags.has('Callable') || receiver.tags.has('Unknown') || receiver.tags.has('Ambient')) diagnostics.push(diagnostic(node, 'CONSTRUCTOR_ACCESS', 'callable or authority constructor access is forbidden', describeOrigin(receiver)));
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTag(node);
        if (privilegedTags.has(tag)) diagnostics.push(diagnostic(node, 'PRIVILEGED_JSX', `privileged JSX element ${tag} is forbidden`));
        for (const property of node.attributes.properties) {
          if (ts.isJsxAttribute(property) && property.name.getText() === 'dangerouslySetInnerHTML') diagnostics.push(diagnostic(property, 'UNSAFE_JSX_HTML', 'dangerouslySetInnerHTML is forbidden'));
        }
      }
      if (ts.isStringLiteralLike(node) && /(?:https?:|wss?:)?\/\//u.test(node.text)) diagnostics.push(diagnostic(node, 'ENDPOINT_LITERAL', 'product source endpoint literals are forbidden'));
      if (isFacade && ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          if (declaration.initializer !== undefined) {
            const value = analysis.originOf(declaration.initializer);
            if (value.tags.has('Ambient') || value.tags.has('OpaqueCapability')) diagnostics.push(diagnostic(declaration, 'FACADE_CAPABILITY_ESCAPE', 'browser facade cannot export raw or opaque host values', describeOrigin(value)));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }

  const unique = new Map();
  for (const item of diagnostics) unique.set(`${item.file}:${item.line}:${item.column}:${item.code}:${item.message}`, item);
  const sorted = [...unique.values()].sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line || left.column - right.column || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message));
  if (sorted.length > 0) throw new Error(`Closed-world source security gate found ${sorted.length} violation(s):\n${sorted.map(formatDiagnostic).join('\n')}`);
  return {
    sourceFileCount: trees.length,
    effectReport: formatEffectReport(report),
    effectTotals: Object.fromEntries(hostEffects.map((effect) => [effect, report.totals.get(effect) ?? 0])),
  };
}
