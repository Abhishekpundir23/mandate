import ts from 'typescript';

import {
  browserFacadeCalls,
  forbiddenCapabilityEffects,
  forbiddenConstructors,
  mutatingMethodEffects,
  objectMutationCalls,
  ownedConstructors,
  ownedGlobalResults,
  ownedResultMethods,
  pureGlobalCalls,
  pureStandardMethods,
  reactCallSummaries,
  uiMethods,
  zodPureMethods,
} from './security-call-summaries.mjs';

const ORIGIN = Object.freeze({
  CONSTANT: 'Constant',
  OWNED: 'Owned',
  BORROWED: 'BorrowedData',
  AMBIENT: 'Ambient',
  OPAQUE: 'OpaqueCapability',
  CALLABLE: 'Callable',
  UI_CELL: 'UiCell',
  ZOD: 'ZodSchema',
  UNKNOWN: 'Unknown',
});

const higherOrderMethods = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'some',
  'sort',
]);

function callableArgumentIsResolved(value) {
  return value !== undefined && value.callables.length > 0
    && value.callables.every((entry) => ['contract', 'function', 'react', 'ui'].includes(entry.kind));
}

function emptyOrigin() {
  return {
    tags: new Set(),
    allocations: new Set(),
    constants: new Set(),
    callables: [],
    provenance: new Set(),
    shape: new Map(),
    content: undefined,
    nullPrototype: false,
  };
}

function origin(tag, provenance, extras = {}) {
  const value = emptyOrigin();
  value.tags.add(tag);
  if (provenance !== undefined) value.provenance.add(provenance);
  Object.assign(value, extras);
  return value;
}

function callableKey(callable) {
  const receiver = callable.receiver === undefined ? '' : originSignature(callable.receiver);
  const closure = callable.closure === undefined
    ? ''
    : [...callable.closure.entries()]
      .map(([symbol, value]) => `${String(symbol.id ?? symbol.escapedName)}=${[...value.tags].sort().join('|')}`)
      .sort()
      .join(';');
  return `${callable.kind}:${callable.name ?? ''}:${callable.id ?? ''}:${receiver}:${closure}`;
}

function normalizeJoined(value) {
  const authorityTags = [ORIGIN.AMBIENT, ORIGIN.BORROWED, ORIGIN.OPAQUE, ORIGIN.UNKNOWN]
    .filter((tag) => value.tags.has(tag));
  if (value.tags.has(ORIGIN.OWNED) && authorityTags.length > 0) {
    value.tags.delete(ORIGIN.OWNED);
    value.tags.add(ORIGIN.UNKNOWN);
    value.provenance.add('mixed owned and non-owned alternatives');
  }
  if (value.tags.has(ORIGIN.UI_CELL) && authorityTags.length > 0) {
    value.tags.delete(ORIGIN.UI_CELL);
    value.tags.add(ORIGIN.UNKNOWN);
    value.provenance.add('mixed UI cell and non-owned alternatives');
  }
  if (value.tags.size === 0) value.tags.add(ORIGIN.UNKNOWN);
  return value;
}

export function joinOrigins(...values) {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return origin(ORIGIN.UNKNOWN, 'missing origin');
  const output = emptyOrigin();
  const callableKeys = new Set();
  for (const value of present) {
    for (const tag of value.tags) output.tags.add(tag);
    for (const allocation of value.allocations) output.allocations.add(allocation);
    for (const constant of value.constants) output.constants.add(constant);
    for (const item of value.callables) {
      const key = callableKey(item);
      if (!callableKeys.has(key)) {
        callableKeys.add(key);
        output.callables.push(item);
      }
    }
    for (const item of value.provenance) output.provenance.add(item);
    output.nullPrototype ||= value.nullPrototype;
    output.content = output.content === undefined
      ? value.content
      : joinOrigins(output.content, value.content);
    for (const [key, child] of value.shape) {
      output.shape.set(key, output.shape.has(key)
        ? joinOrigins(output.shape.get(key), child)
        : child);
    }
  }
  return normalizeJoined(output);
}

function withCallable(callable, provenance) {
  return origin(ORIGIN.CALLABLE, provenance, { callables: [callable] });
}

function withBrand(tag, provenance) {
  return origin(tag, provenance);
}

function freshOwned(node, provenance, extras = {}) {
  const id = `${node.getSourceFile().fileName}:${node.pos}`;
  return origin(ORIGIN.OWNED, provenance, {
    allocations: new Set([id]),
    ...extras,
  });
}

export function resolvedSymbol(node, checker) {
  if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)) {
    const shorthand = checker.getShorthandAssignmentValueSymbol(node.parent);
    if (shorthand !== undefined) return shorthand;
  }
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

export function isActualGlobal(node, checker) {
  const symbol = resolvedSymbol(node, checker);
  if (symbol === undefined) return true;
  const declarations = symbol.declarations ?? [];
  return declarations.length > 0 && declarations.every((declaration) => {
    const file = declaration.getSourceFile().fileName;
    return file.includes('/node_modules/typescript/lib/lib.') || file.includes('node_modules/@types/');
  });
}

export function unwrapExpression(node) {
  let current = node;
  while (current !== undefined && (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current))) {
    current = current.expression;
  }
  return current;
}

function staticNumber(node, constants, checker, seen) {
  const current = unwrapExpression(node);
  if (current === undefined) return undefined;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken) {
    const value = staticNumber(current.operand, constants, checker, seen);
    return value === undefined ? undefined : -value;
  }
  if (ts.isIdentifier(current)) {
    const symbol = resolvedSymbol(current, checker);
    if (symbol === undefined || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const stored = constants.get(symbol);
    return typeof stored === 'number' ? stored : undefined;
  }
  return undefined;
}

export function staticString(node, constants = new Map(), checker, seen = new Set()) {
  const current = unwrapExpression(node);
  if (current === undefined) return undefined;
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNoSubstitutionTemplateLiteral(current)) return current.text;
  if (ts.isIdentifier(current)) {
    const symbol = resolvedSymbol(current, checker);
    if (symbol === undefined || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const stored = constants.get(symbol);
    return typeof stored === 'string' ? stored : undefined;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(current.left, constants, checker, new Set(seen));
    const right = staticString(current.right, constants, checker, new Set(seen));
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const receiver = staticString(current.expression.expression, constants, checker, new Set(seen));
    if (receiver === undefined) return undefined;
    const method = current.expression.name.text;
    if (method === 'slice' || method === 'substring') {
      const start = current.arguments[0] === undefined
        ? 0
        : staticNumber(current.arguments[0], constants, checker, new Set(seen));
      const end = current.arguments[1] === undefined
        ? undefined
        : staticNumber(current.arguments[1], constants, checker, new Set(seen));
      return start === undefined ? undefined : receiver[method](start, end);
    }
    if (method === 'toLowerCase') return receiver.toLowerCase();
    if (method === 'toUpperCase') return receiver.toUpperCase();
    if (method === 'trim') return receiver.trim();
  }
  return undefined;
}

export function staticKey(node, constants = new Map(), checker) {
  return staticString(node, constants, checker)
    ?? staticNumber(node, constants, checker, new Set());
}

export function staticStrings(node, constants, checker) {
  const current = unwrapExpression(node);
  if (current === undefined) return new Set();
  const direct = staticString(current, constants, checker);
  if (direct !== undefined) return new Set([direct]);
  if (ts.isConditionalExpression(current)) {
    return new Set([
      ...staticStrings(current.whenTrue, constants, checker),
      ...staticStrings(current.whenFalse, constants, checker),
    ]);
  }
  return new Set();
}

function originSignature(value, depth = 0) {
  if (depth > 1) return [...value.tags].sort().join('|');
  const shape = [...value.shape.entries()]
    .map(([key, child]) => `${key}:${originSignature(child, depth + 1)}`)
    .sort()
    .join(',');
  return [
    [...value.tags].sort().join('|'),
    [...value.allocations].sort().join('|'),
    [...value.constants].sort().join('|'),
    value.callables.map((item) => `${item.kind}:${item.name ?? ''}:${item.id ?? ''}`).sort().join('|'),
    value.content === undefined ? '' : originSignature(value.content, depth + 1),
    shape,
    value.nullPrototype ? 'null-prototype' : '',
  ].join('::');
}

export function describeOrigin(value) {
  const tags = [...value.tags].sort().join('|');
  const trail = [...value.provenance].sort().slice(0, 6).join(' -> ');
  return `${tags || ORIGIN.UNKNOWN}${trail.length === 0 ? '' : ` (provenance: ${trail})`}`;
}

export function isProvenMutableLocal(value) {
  if (value.tags.size !== 1) return false;
  if (value.tags.has(ORIGIN.UI_CELL)) return true;
  return value.tags.has(ORIGIN.OWNED) && value.allocations.size > 0;
}

function typeText(node, checker) {
  try {
    return checker.typeToString(checker.getTypeAtLocation(node));
  } catch {
    return 'unknown';
  }
}

function isDomLikeType(node, checker) {
  const text = typeText(node, checker);
  return /(?:^|[^A-Za-z])(?:Element|HTMLElement|HTML[A-Za-z]+Element|Document|Window|Navigator|Location|History|MediaQueryList|Storage|IDB[A-Za-z]*|WebSocket|XMLHttpRequest|EventSource|Node)(?:$|[^A-Za-z])/u.test(text);
}

export function expressionTypeIsUncertain(node, checker) {
  const type = checker.getTypeAtLocation(node);
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter
    | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional | ts.TypeFlags.Substitution)) !== 0;
}

function typeIsCallable(node, checker) {
  try {
    return checker.getSignaturesOfType(checker.getTypeAtLocation(node), ts.SignatureKind.Call).length > 0;
  } catch {
    return false;
  }
}

function propertyText(node, constants, checker) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined) {
    return staticString(node.argumentExpression, constants, checker);
  }
  return undefined;
}

function actualStaticPath(node, constants, checker) {
  const current = unwrapExpression(node);
  if (current === undefined) return undefined;
  if (ts.isIdentifier(current)) {
    return isActualGlobal(current, checker) ? current.text : undefined;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const base = actualStaticPath(current.expression, constants, checker);
    const property = propertyText(current, constants, checker);
    return base === undefined || property === undefined ? undefined : `${base}.${property}`;
  }
  return undefined;
}

function importIdentity(node, checker) {
  const symbol = checker.getSymbolAtLocation(node);
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return undefined;
  if (ts.isImportSpecifier(declaration)) {
    const specifier = declaration.parent.parent.parent.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) return undefined;
    return `${specifier.text}:${declaration.propertyName?.text ?? declaration.name.text}`;
  }
  if (ts.isImportClause(declaration)) {
    const specifier = declaration.parent.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) return undefined;
    return `${specifier.text}:default`;
  }
  if (ts.isNamespaceImport(declaration)) {
    const specifier = declaration.parent.parent.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) return undefined;
    return `${specifier.text}:*`;
  }
  return undefined;
}

function isWithin(node, ancestor) {
  let current = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function isParameterBinding(node) {
  let current = node.parent;
  while (current !== undefined && !ts.isFunctionLike(current)) {
    if (ts.isParameter(current)) return true;
    current = current.parent;
  }
  return false;
}

function functionName(node) {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
  return `anonymous@${node.pos}`;
}

function collectReturns(node) {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return [node.body];
  const returns = [];
  const visit = (candidate) => {
    if (candidate !== node && ts.isFunctionLike(candidate)) return;
    if (ts.isReturnStatement(candidate) && candidate.expression !== undefined) {
      returns.push(candidate.expression);
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node.body);
  return returns;
}

function allocationProvenance(node, label) {
  const file = node.getSourceFile();
  const point = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${label} at ${file.fileName}:${point.line + 1}:${point.character + 1}`;
}

export function createOriginAnalysis({ checker, sourceFiles, ir }) {
  const env = new Map();
  const constants = new Map();
  const functions = new Map();
  const functionBySymbol = new Map();
  const functionBindings = new Map();
  const resolvingFunctions = new Set();
  const functionSummaryCache = new Map();
  let analysisEpoch = 0;

  const registerFunction = (node) => {
    const id = `${node.getSourceFile().fileName}:${node.pos}`;
    functions.set(id, node);
    if (node.name !== undefined && ts.isIdentifier(node.name)) {
      const symbol = resolvedSymbol(node.name, checker);
      if (symbol !== undefined) functionBySymbol.set(symbol, id);
    } else if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      const symbol = resolvedSymbol(node.parent.name, checker);
      if (symbol !== undefined) functionBySymbol.set(symbol, id);
    }
    return id;
  };

  for (const file of sourceFiles) {
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        registerFunction(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const [id, fn] of functions) {
    functionBindings.set(id, ir.bindings.filter((binding) => isWithin(binding.node, fn)));
  }

  const constantOrigin = (value, provenance) => origin(ORIGIN.CONSTANT, provenance, {
    constants: new Set([value === undefined ? '<undefined>' : value]),
  });

  const declaredOrigin = (node, provenance) => {
    if (typeIsCallable(node, checker)) {
      return withCallable({
        kind: isParameterBinding(node) ? 'contract' : 'unknown',
        name: node.getText(),
      }, provenance);
    }
    if (isDomLikeType(node, checker)) return origin(ORIGIN.AMBIENT, provenance);
    if (expressionTypeIsUncertain(node, checker)) return origin(ORIGIN.UNKNOWN, provenance);
    return origin(ORIGIN.BORROWED, provenance);
  };

  const project = (value, projection) => {
    let current = value;
    for (const step of projection) {
      if (step === '*') {
        const children = [...current.shape.values()];
        current = joinOrigins(current.content, ...children);
        continue;
      }
      const key = typeof step === 'number'
        ? String(step)
        : step.property ?? (step.keyNode === undefined
          ? undefined
          : staticString(step.keyNode, constants, checker));
      if (current.tags.has(ORIGIN.AMBIENT)) {
        current = origin(ORIGIN.AMBIENT, `projection ${key ?? '[computed]'} from ambient value`);
      } else if (key !== undefined && current.shape.has(key)) {
        current = current.shape.get(key);
      } else if (current.content !== undefined) {
        current = current.content;
      } else if (current.tags.has(ORIGIN.OWNED)) {
        current = origin(ORIGIN.BORROWED, `unmodelled field ${key ?? '[computed]'} of owned value`);
      } else {
        current = joinOrigins(current, origin(ORIGIN.BORROWED, `projected ${key ?? '[computed]'}`));
      }
    }
    return current;
  };

  let evaluate;
  let resolveCall;

  const functionCallable = (node, overrides) => {
    const id = `${node.getSourceFile().fileName}:${node.pos}`;
    return withCallable({
      kind: 'function',
      id,
      name: functionName(node),
      closure: overrides === undefined ? undefined : new Map(overrides),
    }, allocationProvenance(node, `local function ${functionName(node)}`));
  };

  const evaluateFunction = (entry, argumentsList, depth) => {
    const fn = functions.get(entry.id);
    if (fn === undefined || depth > 12) return origin(ORIGIN.UNKNOWN, `unresolved function ${entry.name}`);
    const recursionKey = `${entry.id}:${argumentsList.map(originSignature).join(',')}`;
    const cacheKey = `${analysisEpoch}:${callableKey(entry)}:${recursionKey}`;
    if (functionSummaryCache.has(cacheKey)) return functionSummaryCache.get(cacheKey);
    if (resolvingFunctions.has(recursionKey)) {
      return origin(ORIGIN.BORROWED, `recursive summary ${entry.name}`);
    }
    resolvingFunctions.add(recursionKey);
    try {
      const overrides = new Map(entry.closure ?? []);
      fn.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name)) return;
        const symbol = resolvedSymbol(parameter.name, checker);
        if (symbol === undefined) return;
        const passed = argumentsList[index];
        const fallback = parameter.initializer === undefined
          ? declaredOrigin(parameter.name, `parameter ${parameter.name.text}`)
          : evaluate(parameter.initializer, overrides, depth + 1);
        overrides.set(symbol, passed ?? fallback);
      });
      const bindings = functionBindings.get(entry.id) ?? [];
      for (let iteration = 0; iteration < 6; iteration += 1) {
        let changed = false;
        for (const binding of bindings) {
          if (!ts.isIdentifier(binding.target)) continue;
          const symbol = resolvedSymbol(binding.target, checker);
          if (symbol === undefined) continue;
          const source = binding.channel === 'parameter'
            ? overrides.get(symbol) ?? declaredOrigin(binding.target, `parameter ${binding.target.text}`)
            : binding.source === undefined
              ? constantOrigin(undefined, `uninitialised local ${binding.target.text}`)
              : project(evaluate(binding.source, overrides, depth + 1), binding.projection);
          const merged = overrides.has(symbol) ? joinOrigins(overrides.get(symbol), source) : source;
          if (originSignature(overrides.get(symbol) ?? emptyOrigin()) !== originSignature(merged)) changed = true;
          overrides.set(symbol, merged);
        }
        if (!changed) break;
      }
      const returns = collectReturns(fn).map((node) => evaluate(node, overrides, depth + 1));
      const result = returns.length === 0
        ? constantOrigin(undefined, `void return from ${entry.name}`)
        : joinOrigins(...returns);
      functionSummaryCache.set(cacheKey, result);
      return result;
    } finally {
      resolvingFunctions.delete(recursionKey);
    }
  };

  const propertyOrigin = (node, overrides, depth) => {
    const name = propertyText(node, constants, checker);
    const path = actualStaticPath(node, constants, checker);
    if (path !== undefined) {
      if (objectMutationCalls.has(path) || pureGlobalCalls.has(path) || ownedGlobalResults.has(path)
        || forbiddenCapabilityEffects.has(path) || browserFacadeCalls.has(path)) {
        return withCallable({ kind: 'builtin', name: path }, `global callable ${path}`);
      }
      if (/^(?:Object|Reflect|Array|JSON|Math|Number|String)\./u.test(path)) {
        return withCallable({ kind: 'unknown', name: path }, `unsummarized global callable ${path}`);
      }
    }
    const receiver = evaluate(node.expression, overrides, depth + 1);
    if (name !== undefined && receiver.shape.has(name)) return receiver.shape.get(name);
    if (name !== undefined && forbiddenCapabilityEffects.has(name)) {
      return withCallable({ kind: 'builtin', name }, `forbidden capability method ${name}`);
    }
    if (name !== undefined && browserFacadeCalls.has(name)) {
      return withCallable({ kind: 'builtin', name }, `browser capability method ${name}`);
    }
    if (receiver.tags.has(ORIGIN.ZOD) && name !== undefined && zodPureMethods.has(name)) {
      return withCallable({ kind: 'zod', name, receiver }, `Zod method ${name}`);
    }
    if (typeIsCallable(node, checker) && name === 'set' && node.expression.getText() === 'Reflect') {
      return withCallable({ kind: 'contract-reflect-set', name, receiver }, `typed local callable ${node.getText()}`);
    }
    if (name !== undefined && (mutatingMethodEffects.has(name)
      || pureStandardMethods.has(name)
      || uiMethods.has(name))) {
      return withCallable({ kind: 'method', name, receiver }, `method ${name} on ${describeOrigin(receiver)}`);
    }
    if (receiver.tags.has(ORIGIN.AMBIENT)) {
      return withCallable({ kind: 'ambient', name: name ?? '[computed]', receiver }, `ambient member ${name ?? '[computed]'}`);
    }
    if (receiver.tags.has(ORIGIN.OPAQUE) && name === 'render') {
      return withCallable({ kind: 'opaque-method', name, receiver }, 'opaque React root render');
    }
    if (receiver.tags.has(ORIGIN.UI_CELL) && name === 'current') return receiver;
    if (typeIsCallable(node, checker)) {
      const baseText = node.expression.getText();
      const signature = name === 'assign' && baseText === 'Object'
        ? 'contract-object-assign'
        : name === 'set' && baseText === 'Reflect'
          ? 'contract-reflect-set'
          : 'contract';
      return withCallable({ kind: signature, name: name ?? node.getText(), receiver }, `typed local callable ${node.getText()}`);
    }
    if (receiver.content !== undefined) return receiver.content;
    if (expressionTypeIsUncertain(node, checker)) return origin(ORIGIN.UNKNOWN, `uncertain property ${name ?? '[computed]'}`);
    if (receiver.tags.has(ORIGIN.UNKNOWN)) return origin(ORIGIN.UNKNOWN, `property ${name ?? '[computed]'} of unknown value`);
    return origin(ORIGIN.BORROWED, `data property ${name ?? '[computed]'}`);
  };

  const objectOrigin = (node, overrides, depth) => {
    const shape = new Map();
    const children = [];
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        children.push(evaluate(property.expression, overrides, depth + 1));
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const key = ts.isComputedPropertyName(property.name)
          ? staticString(property.name.expression, constants, checker)
          : property.name.getText().replace(/^['"]|['"]$/gu, '');
        const value = evaluate(property.initializer, overrides, depth + 1);
        if (key !== undefined) shape.set(key, value);
        children.push(value);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        const value = evaluate(property.name, overrides, depth + 1);
        shape.set(property.name.text, value);
        children.push(value);
        continue;
      }
      if (ts.isMethodDeclaration(property)) {
        const key = property.name.getText().replace(/^['"]|['"]$/gu, '');
        const value = functionCallable(property, overrides);
        shape.set(key, value);
        children.push(value);
      }
    }
    return freshOwned(node, allocationProvenance(node, 'fresh object allocation'), {
      shape,
      content: children.length === 0 ? undefined : joinOrigins(...children),
    });
  };

  const arrayOrigin = (node, overrides, depth) => {
    const shape = new Map();
    const children = [];
    node.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const value = evaluate(ts.isSpreadElement(element) ? element.expression : element, overrides, depth + 1);
      shape.set(String(index), value);
      children.push(value);
    });
    return freshOwned(node, allocationProvenance(node, 'fresh array allocation'), {
      shape,
      content: children.length === 0
        ? origin(ORIGIN.BORROWED, 'empty array element type')
        : joinOrigins(...children),
    });
  };

  evaluate = (input, overrides = new Map(), depth = 0) => {
    if ((ts.isAsExpression(input) || ts.isTypeAssertionExpression(input))
      && isDomLikeType(input, checker)) {
      return joinOrigins(
        evaluate(input.expression, overrides, depth + 1),
        origin(ORIGIN.AMBIENT, `capability-bearing cast ${typeText(input, checker)}`),
      );
    }
    const node = unwrapExpression(input);
    if (node === undefined || depth > 20) return origin(ORIGIN.UNKNOWN, 'analysis depth limit');
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
      || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
      || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) {
      return constantOrigin(node.text, allocationProvenance(node, 'literal'));
    }
    if (ts.isTemplateExpression(node)) {
      return constantOrigin(undefined, allocationProvenance(node, 'template value'));
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolvedSymbol(node, checker);
      if (symbol !== undefined && overrides.has(symbol)) return overrides.get(symbol);
      if (symbol !== undefined && env.has(symbol)) return env.get(symbol);
      const imported = importIdentity(node, checker);
      if (imported !== undefined) {
        const [moduleName, importedName] = imported.split(':');
        if (moduleName === 'react' && reactCallSummaries.has(importedName)) {
          return withCallable({ kind: 'react', name: importedName }, `React import ${importedName}`);
        }
        if (moduleName === 'react-dom/client' && importedName === 'createRoot') {
          return withCallable({ kind: 'builtin', name: 'createRoot' }, 'React DOM createRoot import');
        }
        if (moduleName === 'zod') return withBrand(ORIGIN.ZOD, `Zod import ${importedName}`);
        if (moduleName?.startsWith('.')) {
          return typeIsCallable(node, checker)
            ? withCallable({ kind: 'contract', name: node.text }, `imported local callable ${node.text}`)
            : origin(ORIGIN.BORROWED, `imported local data ${node.text}`);
        }
      }
      if (symbol !== undefined && functionBySymbol.has(symbol)) {
        return functionCallable(functions.get(functionBySymbol.get(symbol)), overrides);
      }
      if (isActualGlobal(node, checker)) {
        if (pureGlobalCalls.has(node.text) || ownedGlobalResults.has(node.text)) {
          return withCallable({ kind: 'builtin', name: node.text }, `standard callable ${node.text}`);
        }
        if (['Object', 'Reflect', 'Array', 'JSON', 'Math', 'Number', 'String'].includes(node.text)) {
          return constantOrigin(node.text, `standard namespace ${node.text}`);
        }
        if (['window', 'globalThis', 'self', 'document', 'navigator', 'location', 'history'].includes(node.text)) {
          return origin(ORIGIN.AMBIENT, `ambient global ${node.text}`);
        }
        if (forbiddenCapabilityEffects.has(node.text) || browserFacadeCalls.has(node.text)) {
          return withCallable({ kind: 'builtin', name: node.text }, `global callable ${node.text}`);
        }
        if (ownedConstructors.has(node.text) || forbiddenConstructors.has(node.text)) {
          return withCallable({ kind: 'constructor', name: node.text }, `global constructor ${node.text}`);
        }
      }
      return declaredOrigin(node, `declaration ${node.text}`);
    }
    if (ts.isObjectLiteralExpression(node)) return objectOrigin(node, overrides, depth);
    if (ts.isArrayLiteralExpression(node)) return arrayOrigin(node, overrides, depth);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return functionCallable(node, overrides);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return propertyOrigin(node, overrides, depth);
    }
    if (ts.isConditionalExpression(node)) {
      return joinOrigins(
        evaluate(node.whenTrue, overrides, depth + 1),
        evaluate(node.whenFalse, overrides, depth + 1),
      );
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) return evaluate(node.right, overrides, depth + 1);
      if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        const left = evaluate(node.left, overrides, depth + 1);
        const right = evaluate(node.right, overrides, depth + 1);
        if (left.tags.size === 1 && left.tags.has(ORIGIN.CONSTANT)
          && left.constants.size === 1 && left.constants.has('<undefined>')) return right;
        return joinOrigins(left, right);
      }
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.CommaToken].includes(node.operatorToken.kind)) {
        return joinOrigins(evaluate(node.left, overrides, depth + 1), evaluate(node.right, overrides, depth + 1));
      }
      return constantOrigin(undefined, allocationProvenance(node, 'computed primitive'));
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)
      || ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) {
      return constantOrigin(undefined, allocationProvenance(node, 'unary primitive'));
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
      return resolveCall(node, overrides, depth).origin;
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isSpreadElement(node)) {
      return node.expression === undefined
        ? constantOrigin(undefined, allocationProvenance(node, 'empty expression'))
        : evaluate(node.expression, overrides, depth + 1);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return freshOwned(node, allocationProvenance(node, 'React element'));
    }
    return expressionTypeIsUncertain(node, checker)
      ? origin(ORIGIN.UNKNOWN, `unsupported ${ts.SyntaxKind[node.kind]}`)
      : origin(ORIGIN.BORROWED, `typed expression ${ts.SyntaxKind[node.kind]}`);
  };

  const argsFor = (node, overrides, depth) => ts.isTaggedTemplateExpression(node)
    ? []
    : (node.arguments ?? []).map((argument) => evaluate(argument, overrides, depth + 1));

  resolveCall = (node, overrides = new Map(), depth = 0) => {
    const calleeNode = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
    const callee = evaluate(calleeNode, overrides, depth + 1);
    const argumentsList = argsFor(node, overrides, depth);
    const outcomes = [];
    const effects = new Set();
    const mutationReceivers = [];
    let known = callee.callables.length > 0;
    const descriptions = [];

    for (const entry of callee.callables) {
      descriptions.push(`${entry.kind}:${entry.name ?? entry.id}`);
      if (entry.kind === 'function') {
        outcomes.push(evaluateFunction(entry, argumentsList, depth + 1));
        continue;
      }
      if (entry.kind === 'react') {
        const summary = reactCallSummaries.get(entry.name);
        if (summary === 'REACT_USE_STATE' || summary === 'REACT_USE_REDUCER') {
          const setter = withCallable({ kind: 'ui', name: summary === 'REACT_USE_STATE' ? 'setState' : 'dispatch' }, 'React UI state dispatcher');
          outcomes.push(freshOwned(node, allocationProvenance(node, 'React hook tuple'), {
            shape: new Map([
              ['0', origin(ORIGIN.BORROWED, 'React state value')],
              ['1', setter],
            ]),
            content: joinOrigins(origin(ORIGIN.BORROWED, 'React state value'), setter),
          }));
        } else if (summary === 'REACT_USE_REF') {
          const typeArgument = node.typeArguments?.[0];
          const current = typeArgument !== undefined && isDomLikeType(typeArgument, checker)
            ? origin(ORIGIN.AMBIENT, `DOM-bearing React ref ${typeText(typeArgument, checker)}`)
            : argumentsList[0] ?? constantOrigin(undefined, 'empty React ref');
          outcomes.push(origin(ORIGIN.UI_CELL, 'React ref cell', {
            shape: new Map([['current', current]]),
            content: current,
          }));
        } else if (summary === 'REACT_USE_CALLBACK') {
          outcomes.push(argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing useCallback function'));
        } else if (summary === 'REACT_USE_MEMO') {
          const callback = argumentsList[0];
          if (callback?.callables.length > 0) {
            outcomes.push(joinOrigins(...callback.callables.map((item) => item.kind === 'function'
              ? evaluateFunction(item, [], depth + 1)
              : origin(ORIGIN.BORROWED, 'memo callback result'))));
          } else outcomes.push(origin(ORIGIN.BORROWED, 'memo result'));
        } else if (summary === 'REACT_FORWARD_REF') {
          outcomes.push(argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing forwardRef render'));
        } else if (summary === 'REACT_USE_ID') {
          outcomes.push(constantOrigin(undefined, 'React generated id'));
        } else {
          effects.add('HOST_UI_STATE');
          outcomes.push(constantOrigin(undefined, 'React effect registration'));
        }
        continue;
      }
      if (entry.kind === 'ui') {
        effects.add('HOST_UI_STATE');
        outcomes.push(constantOrigin(undefined, `UI callback ${entry.name}`));
        continue;
      }
      if (entry.kind === 'zod') {
        outcomes.push(entry.name === 'parse' || entry.name === 'safeParse'
          ? origin(ORIGIN.BORROWED, `validated result from Zod ${entry.name}`)
          : withBrand(ORIGIN.ZOD, `Zod method result ${entry.name}`));
        continue;
      }
      if (entry.kind === 'opaque-method' && entry.name === 'render') {
        effects.add('HOST_DOM_MOUNT');
        outcomes.push(constantOrigin(undefined, 'opaque React render'));
        continue;
      }
      if (entry.kind === 'ambient') {
        const ambientName = entry.name;
        const effect = browserFacadeCalls.get(ambientName)
          ?? forbiddenCapabilityEffects.get(ambientName)
          ?? (ambientName === 'submit' || ambientName === 'requestSubmit' ? 'HOST_FORM_SUBMIT' : 'HOST_UNKNOWN');
        effects.add(effect);
        outcomes.push(origin(ORIGIN.AMBIENT, `result of ambient call ${ambientName}`));
        continue;
      }
      if (entry.kind === 'method') {
        if (higherOrderMethods.has(entry.name)
          && !(entry.name === 'sort' && argumentsList[0] === undefined)
          && !callableArgumentIsResolved(argumentsList[0])) {
          effects.add('HOST_UNKNOWN');
        }
        if (mutatingMethodEffects.has(entry.name)) {
          effects.add(mutatingMethodEffects.get(entry.name));
          mutationReceivers.push({ receiver: entry.receiver, label: `.${entry.name}()` });
          outcomes.push(entry.receiver);
        } else if (uiMethods.has(entry.name)) {
          effects.add('HOST_UI_STATE');
          outcomes.push(constantOrigin(undefined, `UI method ${entry.name}`));
        } else if (ownedResultMethods.has(entry.name) || ['entries', 'keys', 'values'].includes(entry.name)) {
          outcomes.push(freshOwned(node, allocationProvenance(node, `${entry.name} result`), {
            content: entry.receiver.content ?? origin(ORIGIN.BORROWED, `${entry.name} element`),
          }));
        } else if (entry.name === 'at' || entry.name === 'find' || entry.name === 'get') {
          outcomes.push(entry.receiver.content ?? (entry.name === 'get'
            ? constantOrigin(undefined, 'empty owned collection lookup')
            : origin(ORIGIN.BORROWED, `${entry.name} result`)));
        } else {
          outcomes.push(origin(ORIGIN.BORROWED, `pure method result ${entry.name}`));
        }
        continue;
      }
      if (entry.kind === 'contract-object-assign' || entry.kind === 'contract-reflect-set') {
        effects.add('HOST_LOCAL_MUTATION');
        mutationReceivers.push({ receiver: argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing mutation target'), label: `${entry.name} target` });
        outcomes.push(entry.kind === 'contract-object-assign'
          ? argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing mutation target')
          : constantOrigin(true, 'Reflect.set result'));
        continue;
      }
      if (entry.kind === 'contract') {
        outcomes.push(origin(ORIGIN.BORROWED, `typed callback result ${entry.name}`));
        continue;
      }
      if (entry.kind === 'constructor') {
        if (forbiddenConstructors.has(entry.name)) {
          effects.add(forbiddenConstructors.get(entry.name));
          outcomes.push(origin(ORIGIN.AMBIENT, `forbidden constructor ${entry.name}`));
        } else if (ownedConstructors.has(entry.name)) {
          outcomes.push(freshOwned(node, allocationProvenance(node, `new ${entry.name}`), {
            content: argumentsList.length === 0 ? undefined : joinOrigins(...argumentsList),
          }));
        } else {
          effects.add('HOST_UNKNOWN');
          outcomes.push(origin(ORIGIN.UNKNOWN, `unknown constructor ${entry.name}`));
        }
        continue;
      }
      if (entry.kind === 'builtin') {
        const name = entry.name;
        if (objectMutationCalls.has(name)) {
          effects.add(objectMutationCalls.get(name));
          mutationReceivers.push({ receiver: argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing mutation target'), label: `${name} target` });
          outcomes.push(name === 'Object.assign'
            ? argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing Object.assign target')
            : constantOrigin(name.startsWith('Reflect.') ? true : undefined, `${name} result`));
        } else if (forbiddenCapabilityEffects.has(name)) {
          effects.add(forbiddenCapabilityEffects.get(name));
          outcomes.push(origin(ORIGIN.AMBIENT, `forbidden capability result ${name}`));
        } else if (browserFacadeCalls.has(name)) {
          if (['window.setInterval', 'globalThis.setInterval', 'setInterval'].includes(name)
            && !callableArgumentIsResolved(argumentsList[0])) effects.add('HOST_UNKNOWN');
          effects.add(browserFacadeCalls.get(name));
          outcomes.push(name === 'createRoot'
            ? origin(ORIGIN.OPAQUE, 'opaque React root')
            : name.includes('matchMedia') || name === 'document.getElementById'
              ? origin(ORIGIN.AMBIENT, `browser result ${name}`)
              : constantOrigin(undefined, `browser call ${name}`));
        } else if (name === 'Object.freeze') {
          outcomes.push(argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing Object.freeze value'));
        } else if (name === 'Object.getOwnPropertyDescriptor') {
          outcomes.push(origin(ORIGIN.BORROWED, 'property descriptor'));
        } else if (name === 'Object.getOwnPropertyDescriptors') {
          outcomes.push(freshOwned(node, allocationProvenance(node, 'descriptor table'), {
            content: origin(ORIGIN.BORROWED, 'property descriptor'),
          }));
        } else if (ownedGlobalResults.has(name)) {
          if (name === 'Object.create' && node.arguments?.[0]?.kind !== ts.SyntaxKind.NullKeyword) {
            effects.add('HOST_UNKNOWN');
          }
          outcomes.push(freshOwned(node, allocationProvenance(node, `${name} result`), {
            content: argumentsList[0]?.content ?? argumentsList[0] ?? origin(ORIGIN.BORROWED, `${name} content`),
            nullPrototype: name === 'Object.create' && node.arguments?.[0]?.kind === ts.SyntaxKind.NullKeyword,
          }));
        } else if (pureGlobalCalls.has(name)) {
          outcomes.push(['Object.entries', 'Object.keys', 'Object.values', 'Array.from'].includes(name)
            ? freshOwned(node, allocationProvenance(node, `${name} result`), {
              content: argumentsList[0]?.content ?? origin(ORIGIN.BORROWED, `${name} content`),
            })
            : origin(ORIGIN.BORROWED, `pure standard result ${name}`));
        } else {
          effects.add('HOST_UNKNOWN');
          outcomes.push(origin(ORIGIN.UNKNOWN, `unknown builtin ${name}`));
        }
        continue;
      }
      effects.add('HOST_UNKNOWN');
      outcomes.push(origin(ORIGIN.UNKNOWN, `unknown callable ${entry.name}`));
    }

    if (callee.tags.has(ORIGIN.UNKNOWN) || callee.callables.length === 0) {
      known = false;
      effects.add('HOST_UNKNOWN');
      outcomes.push(origin(ORIGIN.UNKNOWN, `unresolved ${ts.isNewExpression(node) ? 'constructor' : ts.isTaggedTemplateExpression(node) ? 'tag' : 'call'}`));
    }
    return {
      known,
      origin: joinOrigins(...outcomes),
      effects,
      mutationReceivers,
      description: descriptions.sort().join('|') || 'unresolved',
      callee,
    };
  };

  const seedBinding = (binding) => {
    if (!ts.isIdentifier(binding.target)) return;
    const symbol = resolvedSymbol(binding.target, checker);
    if (symbol === undefined) return;
    if (binding.channel === 'parameter') {
      const parameter = binding.target.parent;
      const value = ts.isParameter(parameter) && parameter.initializer !== undefined
        ? evaluate(parameter.initializer)
        : declaredOrigin(binding.target, `parameter ${binding.target.text}`);
      env.set(symbol, joinOrigins(env.get(symbol), value));
      return;
    }
    if (binding.source === undefined) {
      const declaration = binding.target.parent;
      const value = declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
        || declaration.getSourceFile().isDeclarationFile
        ? declaredOrigin(binding.target, `ambient declaration ${binding.target.text}`)
        : constantOrigin(undefined, `uninitialised ${binding.target.text}`);
      env.set(symbol, joinOrigins(env.get(symbol), value));
    }
  };
  ir.bindings.forEach(seedBinding);

  for (const [symbol, id] of functionBySymbol) {
    env.set(symbol, functionCallable(functions.get(id), undefined));
  }

  for (let iteration = 0; iteration < 24; iteration += 1) {
    analysisEpoch += 1;
    let changed = false;
    for (const binding of ir.bindings) {
      if (!ts.isIdentifier(binding.target) || binding.channel === 'parameter') continue;
      const symbol = resolvedSymbol(binding.target, checker);
      if (symbol === undefined || binding.source === undefined) continue;
      const value = project(evaluate(binding.source), binding.projection);
      const merged = env.has(symbol) ? joinOrigins(env.get(symbol), value) : value;
      if (originSignature(env.get(symbol) ?? emptyOrigin()) !== originSignature(merged)) changed = true;
      env.set(symbol, merged);
      if ((binding.target.parent.parent.flags & ts.NodeFlags.Const) !== 0) {
        const text = staticString(binding.source, constants, checker);
        const number = staticNumber(binding.source, constants, checker, new Set());
        if (text !== undefined) constants.set(symbol, text);
        else if (number !== undefined) constants.set(symbol, number);
      }
    }
    if (!changed) break;
  }

  const observedArguments = new Map();
  for (const call of ir.calls) {
    if (!ts.isCallExpression(call.node) || !ts.isIdentifier(call.node.expression)) continue;
    const symbol = resolvedSymbol(call.node.expression, checker);
    const functionId = symbol === undefined ? undefined : functionBySymbol.get(symbol);
    if (functionId === undefined) continue;
    const fn = functions.get(functionId);
    if (isWithin(call.node, fn)) continue;
    fn.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) return;
      const parameterSymbol = resolvedSymbol(parameter.name, checker);
      if (parameterSymbol === undefined) return;
      const passed = call.node.arguments[index];
      const value = passed === undefined
        ? parameter.initializer === undefined
          ? undefined
          : evaluate(parameter.initializer)
        : evaluate(passed);
      if (value === undefined) return;
      observedArguments.set(parameterSymbol, observedArguments.has(parameterSymbol)
        ? joinOrigins(observedArguments.get(parameterSymbol), value)
        : value);
    });
  }
  for (const [symbol, value] of observedArguments) env.set(symbol, value);

  return {
    ORIGIN,
    constants,
    env,
    originOf: (node) => evaluate(node),
    resolveCall: (node) => resolveCall(node),
    staticString: (node) => staticString(node, constants, checker),
    staticKey: (node) => staticKey(node, constants, checker),
    staticStrings: (node) => staticStrings(node, constants, checker),
  };
}
