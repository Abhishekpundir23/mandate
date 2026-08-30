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

function mutationEffect(receiver) {
  return receiver.tags.has('UiCell') ? 'HOST_UI_STATE' : 'HOST_LOCAL_MUTATION';
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

function hostTypeName(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  const name = symbol?.getName?.() ?? '';
  const declaredByHostLibrary = symbol?.declarations?.some((declaration) => {
    const file = declaration.getSourceFile().fileName;
    return /typescript[\\/]lib[\\/]lib\.dom(?:\.iterable)?\.d\.ts$/u.test(file)
      || /node_modules[\\/]@types[\\/].*\.d\.ts$/u.test(file);
  }) ?? false;
  if (declaredByHostLibrary
    && /^(?:Window|Document|Navigator|Location|History|MediaQueryList|.*Event|Storage|IDB.*|WebSocket|XMLHttpRequest|EventSource|Node|Element|HTMLElement|HTML.*Element|SVG.*Element)$/u.test(name)) {
    return name;
  }
  if (name === 'Root' && symbol?.declarations?.some((declaration) =>
    /react-dom[\\/]client/u.test(declaration.getSourceFile().fileName))) return 'ReactRoot';
  return undefined;
}

function outputTypeLeak(type, checker, seen = new Set()) {
  if (seen.has(type)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(type);
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) {
    return checker.typeToString(type);
  }
  if ((type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike
    | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Void
    | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) !== 0) return undefined;
  if (type.isUnionOrIntersection?.()) {
    for (const member of type.types) {
      const leak = outputTypeLeak(member, checker, nextSeen);
      if (leak !== undefined) return leak;
    }
    return undefined;
  }
  const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
  if (signatures.length > 0) {
    for (const signature of signatures) {
      const leak = outputTypeLeak(checker.getReturnTypeOfSignature(signature), checker, nextSeen);
      if (leak !== undefined) return leak;
    }
  }
  const constructSignatures = checker.getSignaturesOfType(type, ts.SignatureKind.Construct);
  if (constructSignatures.length > 0) {
    for (const signature of constructSignatures) {
      const leak = outputTypeLeak(checker.getReturnTypeOfSignature(signature), checker, nextSeen);
      if (leak !== undefined) return leak;
    }
  }
  if (signatures.length > 0 || constructSignatures.length > 0) {
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration === undefined) continue;
      const leak = outputTypeLeak(checker.getTypeOfSymbolAtLocation(property, declaration), checker, nextSeen);
      if (leak !== undefined) return `${property.getName()} -> ${leak}`;
    }
    return undefined;
  }
  const direct = hostTypeName(type);
  if (direct !== undefined) return direct;
  for (const argument of type.aliasTypeArguments ?? type.typeArguments ?? []) {
    const leak = outputTypeLeak(argument, checker, nextSeen);
    if (leak !== undefined) return leak;
  }
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) continue;
    if (property.declarations?.every((candidate) => candidate.name !== undefined
      && ts.isPrivateIdentifier(candidate.name))) continue;
    const leak = outputTypeLeak(checker.getTypeOfSymbolAtLocation(property, declaration), checker, nextSeen);
    if (leak !== undefined) return `${property.getName()} -> ${leak}`;
  }
  return undefined;
}

function facadeExports(tree, checker) {
  const moduleSymbol = checker.getSymbolAtLocation(tree);
  if (moduleSymbol === undefined) return [];
  return checker.getExportsOfModule(moduleSymbol).map((exported) => {
    const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exported)
      : exported;
    const declaration = exported.declarations?.[0] ?? symbol.declarations?.[0] ?? tree;
    let type;
    try {
      type = (symbol.flags & ts.SymbolFlags.Value) !== 0
        ? checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? declaration)
        : checker.getDeclaredTypeOfSymbol(symbol);
    } catch {
      type = checker.getTypeAtLocation(declaration);
    }
    return {
      declaration,
      exportedName: exported.getName(),
      symbol,
      type,
      valueDeclaration: symbol.valueDeclaration,
    };
  });
}

function primitiveOutputType(type, checker, seen = new Set()) {
  if (seen.has(type)) return true;
  seen.add(type);
  if ((type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike
    | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Void
    | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) !== 0) return true;
  if (type.isUnionOrIntersection?.()) return type.types.every((member) => primitiveOutputType(member, checker, new Set(seen)));
  return false;
}

function callablesRepresentedByShape(value, seen = new Set()) {
  if (seen.has(value)) return new Set();
  seen.add(value);
  const represented = new Set();
  for (const [key, child] of value.shape) {
    if (value.hiddenKeys.has(key)) continue;
    for (const callable of child.callables) represented.add(callable);
    for (const callable of callablesRepresentedByShape(child, seen)) represented.add(callable);
  }
  return represented;
}

function capabilityOutputOrigin(
  value,
  type,
  checker,
  analysis,
  seen = [],
  depth = 0,
  accountedCallables = new Set(),
) {
  if (depth > 10) return 'Unknown (facade runtime traversal depth exceeded)';
  if (value.surfaces.has('HostHandle') || value.surfaces.has('OpaqueHandle')
    || value.surfaces.has('Unknown')) return describeOrigin(value);
  if (primitiveOutputType(type, checker)) {
    const runtimeMatchesPrimitive = value.surfaces.size > 0
      && [...value.surfaces].every((surface) => surface === 'Scalar' || surface === 'Data');
    return runtimeMatchesPrimitive
      ? undefined
      : `Unknown (declared primitive has runtime surfaces ${[...value.surfaces].sort().join('|') || '<none>'})`;
  }
  if (seen.some(([seenValue, seenType]) => seenValue === value && seenType === type)) return undefined;
  const nextSeen = [...seen, [value, type]];

  const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
  const constructSignatures = checker.getSignaturesOfType(type, ts.SignatureKind.Construct);
  if (value.callables.some((callable) => !accountedCallables.has(callable))
    && signatures.length === 0 && constructSignatures.length === 0) {
    return 'Unknown (runtime callable hidden behind non-callable facade type)';
  }
  if (signatures.length > 0 && value.callables.length > 0) {
    const result = analysis.callableResultOf(value);
    for (const signature of signatures) {
      const leak = capabilityOutputOrigin(result, checker.getReturnTypeOfSignature(signature), checker, analysis, nextSeen, depth + 1);
      if (leak !== undefined) return leak;
    }
  }
  if (constructSignatures.length > 0 && value.callables.length > 0) {
    const instance = analysis.callableResultOf(value);
    for (const signature of constructSignatures) {
      const leak = capabilityOutputOrigin(instance, checker.getReturnTypeOfSignature(signature), checker, analysis, nextSeen, depth + 1);
      if (leak !== undefined) return leak;
    }
  }

  for (const [key, child] of value.shape) {
    if (value.hiddenKeys.has(key)) continue;
    const property = checker.getPropertyOfType(type, key);
    const declaration = property?.valueDeclaration ?? property?.declarations?.[0];
    const childType = property !== undefined && declaration !== undefined
      ? checker.getTypeOfSymbolAtLocation(property, declaration)
      : checker.getIndexTypeOfType(type, ts.IndexKind.String) ?? type;
    const leak = capabilityOutputOrigin(
      child,
      childType,
      checker,
      analysis,
      nextSeen,
      depth + 1,
      accountedCallables,
    );
    if (leak !== undefined) return `${key} -> ${leak}`;
  }
  if (value.content !== undefined) {
    const elementType = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      ?? checker.getIndexTypeOfType(type, ts.IndexKind.String)
      ?? type;
    const shapeCallables = new Set([
      ...accountedCallables,
      ...callablesRepresentedByShape(value),
    ]);
    return capabilityOutputOrigin(
      value.content,
      elementType,
      checker,
      analysis,
      nextSeen,
      depth + 1,
      shapeCallables,
    );
  }
  return undefined;
}

function exportedRuntimeOrigin(exported, analysis) {
  const declaration = exported.valueDeclaration;
  if (declaration === undefined) {
    return ts.isExportAssignment(exported.declaration)
      ? analysis.originOf(exported.declaration.expression)
      : undefined;
  }
  if (ts.isVariableDeclaration(declaration)) {
    return ts.isIdentifier(declaration.name)
      ? analysis.originOf(declaration.name)
      : declaration.initializer === undefined ? undefined : analysis.originOf(declaration.initializer);
  }
  if (ts.isBindingElement(declaration) && ts.isIdentifier(declaration.name)) {
    return analysis.originOf(declaration.name);
  }
  if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)
    || ts.isArrowFunction(declaration) || ts.isMethodDeclaration(declaration)
    || ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
    return analysis.declarationOriginOf(declaration);
  }
  return undefined;
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

  if (analysis.fixedPointExhausted) {
    recordEffect(
      trees[0],
      'HOST_UNKNOWN',
      'origin analysis fixed-point budget was exhausted',
      'FIXED_POINT_EXHAUSTED: unresolved program-wide origin propagation',
    );
  }

  const validateMutation = (node, receiver, keys, label) => {
    if (!isProvenMutableLocal(receiver)) {
      diagnostics.push(diagnostic(
        node,
        'UNPROVEN_MUTATION_RECEIVER',
        `${label} is not a proven fresh local allocation or UI cell (${describeOrigin(receiver)})`,
        `${node.getText().slice(0, 120)} -> ${label} -> ${describeOrigin(receiver)}`,
      ));
      return false;
    }
    if (!receiver.nullPrototype && keys?.has('__proto__')) {
      diagnostics.push(diagnostic(
        node,
        'PROTOTYPE_WRITE',
        `${label} writes __proto__ on a prototype-bearing target`,
        describeOrigin(receiver),
      ));
      return false;
    }
    if (!receiver.nullPrototype && keys !== undefined && keys.size === 0) {
      diagnostics.push(diagnostic(
        node,
        'UNKNOWN_PROTOTYPE_KEY',
        `${label} on a prototype-bearing local object requires a finite safe key`,
        describeOrigin(receiver),
      ));
      return false;
    }
    return true;
  };

  for (const unsupported of ir.unsupported) {
    diagnostics.push(diagnostic(unsupported.node, 'UNSUPPORTED_TARGET', `unsupported ${unsupported.channel} target is outside the closed production subset`));
  }

  for (const write of ir.writes) {
    const receiver = analysis.originOf(write.receiver);
    const keyDomain = analysis.mutationKeyDomainForWrite(write);
    const validationKeys = keyDomain.complete ? keyDomain.keys : new Set();
    if (!validateMutation(write.node, receiver, validationKeys, `${write.channel} write to ${write.receiver.getText()}`)) continue;
    if (write.channel !== 'delete'
      && !analysis.writeDispatchSafe(write.node, receiver, keyDomain.keys, keyDomain.complete)) {
      diagnostics.push(diagnostic(
        write.node,
        'UNPROVEN_SET_DISPATCH',
        `${write.channel} uses ordinary [[Set]] without a proven intrinsic/null prototype or definitely-present own data property`,
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
      const api = mutation.api;
      if (api === 'Object.assign') {
        const sourceRecords = mutation.assignSources ?? [];
        if (mutation.assignSourcesComplete !== true) {
          diagnostics.push(diagnostic(
            mutation.site ?? call.node,
            'UNPROVEN_ASSIGN_SOURCE',
            'Object.assign canonical source normalization is incomplete',
          ));
        }
        for (const source of sourceRecords) {
          const sourceNode = source.node ?? mutation.site ?? call.node;
          if (!source.directOwnedLiteral || !source.getterFree || !source.keysComplete) {
            diagnostics.push(diagnostic(
              sourceNode,
              'UNPROVEN_ASSIGN_SOURCE',
              'Object.assign sources must resolve to owned getter-free object literals with complete finite keys',
              describeOrigin(source.origin),
            ));
          } else if (source.keys.size > 0) {
            validateMutation(sourceNode, mutation.receiver, source.keys, mutation.label);
          }
        }
        if (mutation.dispatchSafe === false) {
          diagnostics.push(diagnostic(
            mutation.site ?? call.node,
            'UNPROVEN_SET_DISPATCH',
            'Object.assign pre-dispatch proof found neither an intrinsic/null prototype nor a definitely-present own data property',
            describeOrigin(mutation.receiver),
          ));
        }
        if ((mutation.assignSourceCount ?? 0) === 0) {
          validateMutation(mutation.site ?? call.node, mutation.receiver, undefined, mutation.label);
        }
        continue;
      }
      if (api === 'Object.defineProperties') {
        const keys = mutation.keysComplete === false ? new Set() : mutation.keys ?? new Set();
        validateMutation(mutation.site ?? call.node, mutation.receiver, keys, mutation.label);
        if (mutation.descriptorDataOnly !== true) {
          diagnostics.push(diagnostic(call.node, 'ACCESSOR_DESCRIPTOR', 'only direct data-only descriptor maps are supported; accessors and unresolved descriptor maps are forbidden'));
        }
        continue;
      }
      if (['Object.defineProperty', 'Reflect.defineProperty', 'Reflect.set', 'Reflect.deleteProperty'].includes(api ?? '')) {
        const keys = mutation.keysComplete === false
          ? new Set()
          : mutation.keys ?? (args[1] === undefined ? new Set() : analysis.staticKeys(args[1]));
        if (api === 'Reflect.set' && mutation.dispatchSafe === false) {
          diagnostics.push(diagnostic(
            call.node,
            'UNPROVEN_REFLECT_SET_TARGET',
            'Reflect.set dispatch target must be a proven fresh accessor-free ordinary data object',
            mutation.target === undefined ? undefined : describeOrigin(mutation.target),
          ));
        }
        validateMutation(call.node, mutation.receiver, keys, mutation.label);
        if (api === 'Object.defineProperty' || api === 'Reflect.defineProperty') {
          if (mutation.descriptorDataOnly !== true) {
            diagnostics.push(diagnostic(call.node, 'ACCESSOR_DESCRIPTOR', 'only direct data-only descriptors are supported; accessors and unresolved descriptors are forbidden'));
          }
        }
        continue;
      }
      validateMutation(call.node, mutation.receiver, undefined, mutation.label);
    }
    if (['call', 'apply', 'bind'].includes(name ?? '')) {
      const callee = ts.isCallExpression(call.node) || ts.isNewExpression(call.node) ? call.node.expression : call.node.tag;
      const receiver = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) ? analysis.originOf(callee.expression) : undefined;
      if (receiver === undefined || receiver.callables.length === 0
        || receiver.callables.some((entry) => !['bound', 'builtin', 'function', 'react', 'ui', 'zod'].includes(entry.kind))) {
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
        const value = analysis.originOf(binding.target);
        if (value.tags.has('Callable') || value.tags.has('Ambient') || value.tags.has('OpaqueCapability')
          || value.tags.has('Unknown') || value.tags.has('Escaped')) {
          diagnostics.push(diagnostic(
            binding.node,
            'DANGEROUS_BINDING_PROJECTION',
            `binding projection ${String(key)} resolves to capability-bearing or unresolved data`,
            describeOrigin(value),
          ));
        }
      }
    }
  }

  for (const tree of trees) {
    const isFacade = relative('.', tree.fileName) === browserFacadePath;
    if (isFacade) {
      for (const exported of facadeExports(tree, checker)) {
        const leak = outputTypeLeak(exported.type, checker);
        if (leak !== undefined) {
          diagnostics.push(diagnostic(
            exported.declaration,
            'FACADE_CAPABILITY_ESCAPE',
            `browser facade export ${exported.exportedName} exposes raw, generic, or unresolved output ${leak}`,
            checker.typeToString(exported.type),
          ));
        }
        const runtime = exportedRuntimeOrigin(exported, analysis);
        if (runtime !== undefined) {
          const runtimeLeak = capabilityOutputOrigin(runtime, exported.type, checker, analysis);
          if (runtimeLeak !== undefined) {
            diagnostics.push(diagnostic(
              exported.declaration,
              'FACADE_CAPABILITY_ESCAPE',
              `browser facade export ${exported.exportedName} exposes a runtime host, opaque, escaped, or unresolved output`,
              runtimeLeak,
            ));
          }
        }
        for (const property of checker.getPropertiesOfType(exported.type)) {
          for (const declaration of property.declarations ?? []) {
            const memberType = checker.getTypeOfSymbolAtLocation(property, declaration);
            const memberOrigin = ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
              ? analysis.originOf(declaration.initializer)
              : (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
                && declaration.body !== undefined
                ? analysis.declarationOriginOf(declaration)
                : ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)
                  ? analysis.declarationOriginOf(declaration)
                : ts.isGetAccessorDeclaration(declaration) && declaration.body !== undefined
                  ? analysis.functionResultOf(declaration)
                  : undefined;
            if (memberOrigin === undefined) continue;
            const memberLeak = capabilityOutputOrigin(
              memberOrigin,
              memberType,
              checker,
              analysis,
            );
            if (memberLeak !== undefined) {
              diagnostics.push(diagnostic(
                declaration,
                'FACADE_CAPABILITY_ESCAPE',
                `browser facade export ${exported.exportedName}.${property.getName()} exposes a merged runtime capability`,
                memberLeak,
              ));
            }
          }
        }
        const classDeclaration = exported.valueDeclaration;
        if (classDeclaration !== undefined && (ts.isClassDeclaration(classDeclaration) || ts.isClassExpression(classDeclaration))) {
          for (const member of classDeclaration.members) {
            if (!member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
            if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
              const memberType = checker.getTypeAtLocation(member);
              const memberLeak = capabilityOutputOrigin(analysis.originOf(member.initializer), memberType, checker, analysis);
              if (memberLeak !== undefined) {
                diagnostics.push(diagnostic(member, 'FACADE_CAPABILITY_ESCAPE', `browser facade export ${exported.exportedName}.${member.name.getText()} exposes a static runtime capability`, memberLeak));
              }
            }
            if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) && member.body !== undefined) {
              const memberType = checker.getTypeAtLocation(member);
              const memberOrigin = ts.isMethodDeclaration(member)
                ? analysis.declarationOriginOf(member)
                : analysis.functionResultOf(member);
              const memberLeak = capabilityOutputOrigin(memberOrigin, memberType, checker, analysis);
              if (memberLeak !== undefined) {
                diagnostics.push(diagnostic(member, 'FACADE_CAPABILITY_ESCAPE', `browser facade export ${exported.exportedName}.${member.name.getText()} exposes a static runtime capability`, memberLeak));
              }
            }
          }
        }
      }
    }
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
        if (key === undefined && !isProvenMutableLocal(receiver)
          && (receiver.tags.has('Ambient') || result.tags.has('Callable')
          || expressionTypeIsUncertain(node, checker)
          || (ts.isReturnStatement(node.parent) && !isProvenMutableLocal(receiver)))) {
          diagnostics.push(diagnostic(node, 'UNKNOWN_COMPUTED_ACCESS', 'computed access must resolve to a finite key or proven local inert data', `${describeOrigin(receiver)} -> ${describeOrigin(result)}`));
        }
        if (key === 'constructor' && (receiver.tags.has('BorrowedData') || receiver.tags.has('Ambient')
          || receiver.tags.has('OpaqueCapability') || receiver.tags.has('Escaped')
          || result.tags.has('Callable') || result.tags.has('Unknown'))) {
          diagnostics.push(diagnostic(node, 'DYNAMIC_CONSTRUCTOR_ACCESS', 'dynamic constructor access on borrowed, reflected, or unresolved data is forbidden', `${describeOrigin(receiver)} -> ${describeOrigin(result)}`));
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'constructor') {
        const receiver = analysis.originOf(node.expression);
        if (receiver.tags.has('Callable') || receiver.tags.has('Unknown') || receiver.tags.has('Ambient')
          || receiver.tags.has('BorrowedData') || receiver.tags.has('OpaqueCapability') || receiver.tags.has('Escaped')) {
          diagnostics.push(diagnostic(node, 'CONSTRUCTOR_ACCESS', 'borrowed, callable, reflected, escaped, or authority constructor access is forbidden', describeOrigin(receiver)));
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTag(node);
        if (analysis.isUnknownJsx(node)) {
          recordEffect(
            node,
            'HOST_UNKNOWN',
            `unresolved JSX component ${tag}`,
            'unresolved component invocation is an external callback and value-escape boundary',
          );
        }
        if (privilegedTags.has(tag)) diagnostics.push(diagnostic(node, 'PRIVILEGED_JSX', `privileged JSX element ${tag} is forbidden`));
        for (const property of node.attributes.properties) {
          if (ts.isJsxAttribute(property) && property.name.getText() === 'dangerouslySetInnerHTML') diagnostics.push(diagnostic(property, 'UNSAFE_JSX_HTML', 'dangerouslySetInnerHTML is forbidden'));
          if (ts.isJsxAttribute(property) && /^(?:on[A-Z]|ref$)/u.test(property.name.getText())
            && property.initializer !== undefined && ts.isJsxExpression(property.initializer)
            && property.initializer.expression !== undefined) {
            const callback = analysis.originOf(property.initializer.expression);
            if (analysis.requiresCallableResolution(property.initializer.expression, callback)
              && !analysis.isResolvedCallable(callback)) {
              recordEffect(
                property,
                'HOST_UNKNOWN',
                `unresolved intrinsic JSX callback ${property.name.getText()}`,
                describeOrigin(callback),
              );
            }
          }
          if (ts.isJsxSpreadAttribute(property)) {
            const spread = analysis.originOf(property.expression);
            const callbacks = [...spread.shape.entries()].filter(([key]) => /^(?:on[A-Z]|ref$)/u.test(key));
            if (callbacks.some(([, callback]) => !analysis.isResolvedCallable(callback))) {
              recordEffect(
                property,
                'HOST_UNKNOWN',
                'unresolved intrinsic JSX callback hidden in spread props',
                describeOrigin(spread),
              );
            }
            if (spread.shape.size === 0 && spread.surfaces.has('Unknown')) {
              recordEffect(
                property,
                'HOST_UNKNOWN',
                'unresolved intrinsic JSX spread can hide callback edges',
                describeOrigin(spread),
              );
            }
          }
        }
      }
      if (ts.isStringLiteralLike(node) && /(?:https?:|wss?:)?\/\//u.test(node.text)) diagnostics.push(diagnostic(node, 'ENDPOINT_LITERAL', 'product source endpoint literals are forbidden'));
      if (isFacade && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))) {
        const source = analysis.originOf(node.expression);
        if (source.tags.has('Ambient') || source.tags.has('OpaqueCapability')) {
          diagnostics.push(diagnostic(
            node,
            'FACADE_CAPABILITY_CAST',
            'browser facade casts cannot erase raw or opaque host authority',
            describeOrigin(source),
          ));
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
    sourceReceipts: trees.map((tree) => relative('.', tree.fileName)).sort(),
    effectReport: formatEffectReport(report),
    effectTotals: Object.fromEntries(hostEffects.map((effect) => [effect, report.totals.get(effect) ?? 0])),
  };
}
