import { createHash } from 'node:crypto';

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
  pureLocalContractMethods,
  pureStandardMethods,
  reactCallSummaries,
  uiMethods,
  zodPureMethods,
} from './security-call-summaries.mjs';

const ORIGIN = Object.freeze({
  BOTTOM: 'Bottom',
  CONSTANT: 'Constant',
  OWNED: 'Owned',
  BORROWED: 'BorrowedData',
  AMBIENT: 'Ambient',
  OPAQUE: 'OpaqueCapability',
  ESCAPED: 'Escaped',
  CALLABLE: 'Callable',
  UI_CELL: 'UiCell',
  LOCAL_CAPABILITY: 'LocalCapabilityDefinition',
  ZOD: 'ZodSchema',
  UNKNOWN: 'Unknown',
});

const SURFACE = Object.freeze({
  SCALAR: 'Scalar',
  DATA: 'Data',
  AGGREGATE: 'Aggregate',
  CALLABLE: 'Callable',
  HOST: 'HostHandle',
  OPAQUE: 'OpaqueHandle',
  UNKNOWN: 'Unknown',
});

// The abstract state must be finite even when application state recursively
// embeds prior state (for example, append-only stores). Expressions already
// fail closed after depth 20, so signatures retain at least that much
// path-sensitive structure. Joins widen sooner: beyond this boundary a value
// is data only when its entire transitive tail is capability-free; otherwise
// it becomes Unknown. This bounds the lattice without dropping a descendant
// Ambient/Opaque/Escaped/Unknown signal.
const ORIGIN_JOIN_DEPTH_LIMIT = 4;
const ORIGIN_SIGNATURE_DEPTH_LIMIT = 20;
const ORIGIN_LARGE_ARGUMENT_LIMIT = 24;

const symbolIdentity = new WeakMap();
const sentinelIdentity = new Map();
const originIdentity = new WeakMap();
let nextSymbolIdentity = 1;
let nextOriginIdentity = 1;

function stableSymbolKey(symbol) {
  const identities = typeof symbol === 'symbol' ? sentinelIdentity : symbolIdentity;
  if (!identities.has(symbol)) {
    identities.set(symbol, nextSymbolIdentity);
    nextSymbolIdentity += 1;
  }
  return `${typeof symbol === 'symbol' ? 'sentinel' : 'ts-symbol'}:${identities.get(symbol)}`;
}

function stablePropertyKey(key) {
  return typeof key === 'symbol' ? stableSymbolKey(key) : `property:${String(key)}`;
}

function descriptorPropertyKey(key) {
  return typeof key === 'symbol' ? key : String(key);
}

function stableOriginKey(value) {
  if (!originIdentity.has(value)) {
    originIdentity.set(value, nextOriginIdentity);
    nextOriginIdentity += 1;
  }
  return `origin:${originIdentity.get(value)}`;
}

function defaultSurface(tag) {
  if (tag === ORIGIN.CONSTANT) return SURFACE.SCALAR;
  if (tag === ORIGIN.OWNED || tag === ORIGIN.UI_CELL || tag === ORIGIN.ZOD) return SURFACE.AGGREGATE;
  if (tag === ORIGIN.CALLABLE) return SURFACE.CALLABLE;
  if (tag === ORIGIN.AMBIENT) return SURFACE.HOST;
  if (tag === ORIGIN.OPAQUE) return SURFACE.OPAQUE;
  if (tag === ORIGIN.UNKNOWN || tag === ORIGIN.ESCAPED) return SURFACE.UNKNOWN;
  return SURFACE.DATA;
}

const higherOrderMethods = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'sort',
]);

function callableArgumentIsResolved(value) {
  return value !== undefined && value.callables.length > 0
    && value.callables.every((entry) => ['bound', 'function', 'react', 'ui'].includes(entry.kind));
}

function callableArgumentRequiresResolution(node, value, checker) {
  return value !== undefined && (value.callables.length > 0
    || typeIsCallable(node, checker)
    || expressionTypeIsUncertain(node, checker));
}

function emptyOrigin() {
  return {
    tags: new Set(),
    allocations: new Set(),
    constants: new Set(),
    callables: [],
    provenance: new Set(),
    shape: new Map(),
    // Keys installed as own data properties by the allocation itself. This
    // immutable proof set is deliberately separate from `shape`, which grows
    // as transfer functions model later writes and must never retroactively
    // authorize Reflect.set dispatch for an earlier/replayed call.
    initialDataKeys: new Set(),
    definedDataKeys: new Set(),
    accessorKeys: new Set(),
    nonWritableKeys: new Set(),
    // May-domain: if a key appears here, at least one reachable descriptor
    // state is non-enumerable (or has unresolved enumerability). Object
    // spread may treat a definitely-present key as a must-copy only when the
    // key is absent from this set.
    nonEnumerableKeys: new Set(),
    invalidatedDataKeys: new Set(),
    content: undefined,
    // Absence is a control-flow fact, not a provenance tag. Keeping it
    // separate prevents a guarded Map.get()/find()/at() result from becoming
    // Constant|Owned (and therefore Unknown) merely because it may be absent.
    mayBeAbsent: false,
    mayBeNonExtensible: false,
    finiteKeysComplete: false,
    shapeKeysComplete: false,
    // Positional iteration/call semantics are distinct from enumerable own
    // object shape. A sparse array has no own key for a hole, but array
    // iteration and Function#apply still observe an explicit undefined value
    // at that position.
    sequence: undefined,
    sequenceComplete: false,
    // Canonical Object.assign source evidence follows the value through
    // aliases, meta-calls, binds, and analyzed parameters. The map key is the
    // stable allocation site; the boolean fields are must-facts for that
    // syntactic source alternative.
    assignSourceEvidence: new Map(),
    assignSourceEvidenceComplete: false,
    nullPrototype: false,
    intrinsicPrototype: false,
    ordinaryData: false,
    surfaces: new Set(),
    hiddenKeys: new Set(),
  };
}

function origin(tag, provenance, extras = {}) {
  const value = emptyOrigin();
  value.tags.add(tag);
  value.surfaces.add(defaultSurface(tag));
  if (provenance !== undefined) value.provenance.add(provenance);
  Object.assign(value, extras);
  return value;
}

function snapshotOrigin(value, seen = new WeakMap()) {
  if (seen.has(value)) return seen.get(value);
  const snapshot = emptyOrigin();
  seen.set(value, snapshot);
  snapshot.tags = new Set(value.tags);
  snapshot.provenance = new Set(value.provenance);
  snapshot.allocations = new Set(value.allocations);
  snapshot.constants = new Set(value.constants);
  snapshot.surfaces = new Set(value.surfaces);
  snapshot.callables = [...value.callables];
  snapshot.mayBeAbsent = value.mayBeAbsent;
  snapshot.mayBeNonExtensible = value.mayBeNonExtensible;
  snapshot.finiteKeysComplete = value.finiteKeysComplete;
  snapshot.shapeKeysComplete = value.shapeKeysComplete;
  snapshot.sequenceComplete = value.sequenceComplete;
  snapshot.assignSourceEvidenceComplete = value.assignSourceEvidenceComplete;
  snapshot.nullPrototype = value.nullPrototype;
  snapshot.intrinsicPrototype = value.intrinsicPrototype;
  snapshot.ordinaryData = value.ordinaryData;
  snapshot.hiddenKeys = new Set(value.hiddenKeys);
  snapshot.initialDataKeys = new Set(value.initialDataKeys);
  snapshot.definedDataKeys = new Set(value.definedDataKeys);
  snapshot.accessorKeys = new Set(value.accessorKeys);
  snapshot.nonWritableKeys = new Set(value.nonWritableKeys);
  snapshot.nonEnumerableKeys = new Set(value.nonEnumerableKeys);
  snapshot.invalidatedDataKeys = new Set(value.invalidatedDataKeys);
  snapshot.assignSourceEvidence = new Map(value.assignSourceEvidence);
  snapshot.content = value.content === undefined ? undefined : snapshotOrigin(value.content, seen);
  snapshot.sequence = value.sequence === undefined
    ? undefined
    : value.sequence.map((child) => snapshotOrigin(child, seen));
  snapshot.shape = new Map([...value.shape.entries()].map(([key, child]) => [
    key,
    snapshotOrigin(child, seen),
  ]));
  return snapshot;
}

function withAbsence(value, provenance) {
  const result = snapshotOrigin(value);
  result.mayBeAbsent = true;
  if (provenance !== undefined) result.provenance.add(provenance);
  return result;
}

function withoutAbsence(value, provenance) {
  if (!value.mayBeAbsent) return value;
  const result = snapshotOrigin(value);
  result.mayBeAbsent = false;
  if (provenance !== undefined) result.provenance.add(provenance);
  return result;
}

function signatureState() {
  return {
    origins: new WeakMap(),
    visitingOrigins: new WeakSet(),
    callables: new WeakMap(),
    visitingCallables: new WeakSet(),
  };
}

function depthCached(cache, value, depth) {
  return cache.get(value)?.get(depth);
}

function setDepthCached(cache, value, depth, result) {
  let byDepth = cache.get(value);
  if (byDepth === undefined) {
    byDepth = new Map();
    cache.set(value, byDepth);
  }
  byDepth.set(depth, result);
}

function structuralDigest(parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    const text = `${typeof part}:${String(part)}`;
    hash.update(String(text.length));
    hash.update(':');
    hash.update(text);
    hash.update(';');
  }
  return hash.digest('hex');
}

function transitiveSecurityFacts(root) {
  const tags = new Set();
  const surfaces = new Set();
  const callableKinds = new Set();
  const seenOrigins = new WeakSet();
  const seenCallables = new WeakSet();
  let callableCount = 0;
  let originCount = 0;
  const visitCallable = (callable) => {
    if (seenCallables.has(callable)) return;
    seenCallables.add(callable);
    callableCount += 1;
    callableKinds.add(`${callable.kind}:${callable.name ?? ''}:${callable.receiverLabel ?? ''}`);
    if (callable.receiver !== undefined) visitOrigin(callable.receiver);
    if (callable.boundThis !== undefined) visitOrigin(callable.boundThis);
    for (const value of callable.closure?.values() ?? []) visitOrigin(value);
    for (const value of callable.boundArguments ?? []) visitOrigin(value);
    for (const target of callable.targets ?? []) visitCallable(target);
  };
  const visitOrigin = (value) => {
    if (seenOrigins.has(value)) return;
    seenOrigins.add(value);
    originCount += 1;
    for (const tag of value.tags) tags.add(tag);
    for (const surface of value.surfaces) surfaces.add(surface);
    for (const callable of value.callables) visitCallable(callable);
    if (value.content !== undefined) visitOrigin(value.content);
    for (const child of value.sequence ?? []) visitOrigin(child);
    for (const child of value.shape.values()) visitOrigin(child);
  };
  visitOrigin(root);
  return { callableCount, callableKinds, originCount, surfaces, tags };
}

function abstractLargeArgument(value, provenance) {
  const facts = transitiveSecurityFacts(value);
  if (facts.originCount + facts.callableCount <= ORIGIN_LARGE_ARGUMENT_LIMIT) return value;
  if (value.shape.size > 0 && value.shape.size <= 32
    && (value.sequence?.length ?? 0) <= 32) {
    // Preserve a finite public record/tuple surface (especially analyzed
    // methods returned beside large data) while bounding each oversized
    // child and the aggregate content tail. A security-bearing child widens
    // to Unknown, never to safe data, so facade traversal still fails closed.
    const compact = emptyOrigin();
    compact.tags = new Set(value.tags);
    compact.allocations = new Set(value.allocations);
    compact.constants = new Set(value.constants);
    compact.callables = [...value.callables];
    compact.provenance = new Set(value.provenance);
    compact.mayBeAbsent = value.mayBeAbsent;
    compact.mayBeNonExtensible = value.mayBeNonExtensible;
    compact.finiteKeysComplete = value.finiteKeysComplete;
    compact.shapeKeysComplete = value.shapeKeysComplete;
    compact.sequenceComplete = value.sequenceComplete;
    compact.assignSourceEvidenceComplete = value.assignSourceEvidenceComplete;
    compact.nullPrototype = value.nullPrototype;
    compact.intrinsicPrototype = value.intrinsicPrototype;
    compact.ordinaryData = value.ordinaryData;
    compact.surfaces = new Set(value.surfaces);
    compact.hiddenKeys = new Set(value.hiddenKeys);
    compact.initialDataKeys = new Set(value.initialDataKeys);
    compact.definedDataKeys = new Set(value.definedDataKeys);
    compact.accessorKeys = new Set(value.accessorKeys);
    compact.nonWritableKeys = new Set(value.nonWritableKeys);
    compact.nonEnumerableKeys = new Set(value.nonEnumerableKeys);
    compact.invalidatedDataKeys = new Set(value.invalidatedDataKeys);
    compact.assignSourceEvidence = new Map(value.assignSourceEvidence);
    compact.shape = new Map([...value.shape.entries()].map(([key, child]) => {
      const childFacts = transitiveSecurityFacts(child);
      return [key, child.callables.length > 0
        || childFacts.originCount + childFacts.callableCount <= ORIGIN_LARGE_ARGUMENT_LIMIT
        ? child
        : widenedSecurityTail(child)];
    }));
    compact.sequence = value.sequence?.map((child) => {
      const childFacts = transitiveSecurityFacts(child);
      return child.callables.length > 0
        || childFacts.originCount + childFacts.callableCount <= ORIGIN_LARGE_ARGUMENT_LIMIT
        ? child
        : widenedSecurityTail(child);
    });
    compact.content = value.content === undefined ? undefined : widenedSecurityTail(value.content);
    compact.provenance.add(`${provenance}: finite surface retained with bounded transitive content`);
    return normalizeJoined(compact);
  }
  const carriesAuthority = [ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN, ORIGIN.UI_CELL]
    .some((tag) => facts.tags.has(tag))
    || [SURFACE.HOST, SURFACE.OPAQUE, SURFACE.UNKNOWN].some((surface) => facts.surfaces.has(surface))
    || facts.callableCount > 0;
  return carriesAuthority
    ? origin(ORIGIN.UNKNOWN, `${provenance}: large security-bearing argument widened closed`)
    : origin(ORIGIN.BORROWED, `${provenance}: large capability-free data argument abstracted`);
}

function transitiveSecurityDigest(value) {
  const facts = transitiveSecurityFacts(value);
  return structuralDigest([
    'transitive-security-tail',
    ...[...facts.tags].sort(),
    'surfaces',
    ...[...facts.surfaces].sort(),
    'callables',
    ...[...facts.callableKinds].sort(),
  ]);
}

function widenedSecurityTail(...values) {
  const facts = values.map(transitiveSecurityFacts);
  const tags = new Set(facts.flatMap((item) => [...item.tags]));
  const surfaces = new Set(facts.flatMap((item) => [...item.surfaces]));
  const hasAuthority = [ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN, ORIGIN.UI_CELL]
    .some((tag) => tags.has(tag))
    || [SURFACE.HOST, SURFACE.OPAQUE, SURFACE.UNKNOWN].some((surface) => surfaces.has(surface))
    || facts.some((item) => item.callableKinds.size > 0);
  const widened = hasAuthority
    ? origin(ORIGIN.UNKNOWN, 'security-bearing structure widened at finite join boundary')
    : origin(ORIGIN.BORROWED, 'capability-free structure widened at finite join boundary');
  widened.mayBeAbsent = values.some((value) => value.mayBeAbsent);
  widened.mayBeNonExtensible = values.some((value) => value.mayBeNonExtensible);
  widened.shapeKeysComplete = values.every((value) => value.shapeKeysComplete);
  return widened;
}

function callableKey(callable, state = signatureState(), depth = 0) {
  const cached = depthCached(state.callables, callable, depth);
  if (cached !== undefined) return cached;
  if (state.visitingCallables.has(callable)) {
    return structuralDigest(['callable-cycle', callable.kind, callable.name ?? '', callable.id ?? '']);
  }
  if (depth >= ORIGIN_SIGNATURE_DEPTH_LIMIT) {
    const key = structuralDigest([
      'callable-security-tail',
      callable.kind,
      callable.name ?? '',
      callable.receiverLabel ?? '',
      callable.id ?? '',
      callable.receiver === undefined ? '' : transitiveSecurityDigest(callable.receiver),
      callable.boundThis === undefined ? '' : transitiveSecurityDigest(callable.boundThis),
      ...(callable.closure === undefined
        ? []
        : [...callable.closure.values()].map(transitiveSecurityDigest).sort()),
      ...(callable.boundArguments ?? []).map(transitiveSecurityDigest).sort(),
    ]);
    setDepthCached(state.callables, callable, depth, key);
    return key;
  }
  state.visitingCallables.add(callable);
  const receiver = callable.receiver === undefined ? '' : originSignature(callable.receiver, state, depth + 1);
  const closure = callable.closure === undefined
    ? []
    : [...callable.closure.entries()]
      .map(([symbol, value]) => `${stableSymbolKey(symbol)}=${originSignature(value, state, depth + 1)}`)
      .sort();
  const targets = (callable.targets ?? []).map((target) => callableKey(target, state, depth + 1)).sort();
  const boundArguments = (callable.boundArguments ?? [])
    .map((value) => originSignature(value, state, depth + 1));
  const boundThis = callable.boundThis === undefined ? '' : originSignature(callable.boundThis, state, depth + 1);
  const key = structuralDigest([
    'callable',
    callable.kind,
    callable.name ?? '',
    callable.receiverLabel ?? '',
    callable.id ?? '',
    receiver,
    ...closure,
    'targets',
    ...targets,
    'bound-arguments',
    ...boundArguments,
    'bound-this',
    boundThis,
  ]);
  state.visitingCallables.delete(callable);
  setDepthCached(state.callables, callable, depth, key);
  return key;
}

function normalizeJoined(value) {
  const authorityTags = [ORIGIN.AMBIENT, ORIGIN.BORROWED, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN]
    .filter((tag) => value.tags.has(tag));
  if (value.tags.has(ORIGIN.OWNED) && authorityTags.length > 0) {
    value.tags.delete(ORIGIN.OWNED);
    value.tags.add(ORIGIN.UNKNOWN);
    value.surfaces.add(SURFACE.UNKNOWN);
    value.provenance.add('mixed owned and non-owned alternatives');
  }
  if (value.tags.has(ORIGIN.UI_CELL) && authorityTags.length > 0) {
    value.tags.delete(ORIGIN.UI_CELL);
    value.tags.add(ORIGIN.UNKNOWN);
    value.surfaces.add(SURFACE.UNKNOWN);
    value.provenance.add('mixed UI cell and non-owned alternatives');
  }
  if (value.tags.size === 0) value.tags.add(ORIGIN.UNKNOWN);
  return value;
}

function normalizedTagUnion(left, right) {
  const tags = new Set([...left.tags, ...right.tags]);
  const authorityTags = [ORIGIN.AMBIENT, ORIGIN.BORROWED, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN]
    .filter((tag) => tags.has(tag));
  if (tags.has(ORIGIN.OWNED) && authorityTags.length > 0) {
    tags.delete(ORIGIN.OWNED);
    tags.add(ORIGIN.UNKNOWN);
  }
  if (tags.has(ORIGIN.UI_CELL) && authorityTags.length > 0) {
    tags.delete(ORIGIN.UI_CELL);
    tags.add(ORIGIN.UNKNOWN);
  }
  if (tags.size === 0) tags.add(ORIGIN.UNKNOWN);
  return tags;
}

function setEquals(left, right) {
  return left.size === right.size && [...right].every((value) => left.has(value));
}

function setContains(left, right) {
  return [...right].every((value) => left.has(value));
}

function originSubsumes(left, right, seen = new WeakMap(), depth = 0) {
  if (left === right) return true;
  // Returning false forces mergeOriginPair to materialize the finite,
  // conservative tail instead of retaining either unbounded operand.
  if (depth >= ORIGIN_JOIN_DEPTH_LIMIT) return false;
  let rightSet = seen.get(left);
  if (rightSet?.has(right)) return true;
  if (rightSet === undefined) {
    rightSet = new WeakSet();
    seen.set(left, rightSet);
  }
  rightSet.add(right);

  if (!setEquals(left.tags, normalizedTagUnion(left, right))) return false;
  if (!setContains(left.allocations, right.allocations)
    || !setContains(left.constants, right.constants)
    || !setContains(left.surfaces, right.surfaces)) return false;
  if (!left.mayBeAbsent && right.mayBeAbsent) return false;
  if (!left.mayBeNonExtensible && right.mayBeNonExtensible) return false;
  if (left.finiteKeysComplete && !right.finiteKeysComplete) return false;
  if (left.shapeKeysComplete && !right.shapeKeysComplete) return false;
  if (left.sequenceComplete && !right.sequenceComplete) return false;
  if (left.assignSourceEvidenceComplete && !right.assignSourceEvidenceComplete) return false;
  if (left.nullPrototype && !right.nullPrototype) return false;
  if (left.intrinsicPrototype && !right.intrinsicPrototype) return false;
  if (left.ordinaryData && !right.ordinaryData) return false;
  if (![...left.initialDataKeys].every((key) => right.initialDataKeys.has(key))) return false;
  if (![...left.definedDataKeys].every((key) => right.definedDataKeys.has(key))) return false;
  if (!setContains(left.accessorKeys, right.accessorKeys)) return false;
  if (!setContains(left.nonWritableKeys, right.nonWritableKeys)) return false;
  if (!setContains(left.nonEnumerableKeys, right.nonEnumerableKeys)) return false;
  if (!setContains(left.invalidatedDataKeys, right.invalidatedDataKeys)) return false;
  if (![...left.hiddenKeys].every((key) => right.hiddenKeys.has(key))) return false;
  for (const [key, rightEvidence] of right.assignSourceEvidence) {
    const leftEvidence = left.assignSourceEvidence.get(key);
    if (leftEvidence === undefined
      || (leftEvidence.directOwnedLiteral && !rightEvidence.directOwnedLiteral)
      || (leftEvidence.getterFree && !rightEvidence.getterFree)
      || (leftEvidence.keysComplete && !rightEvidence.keysComplete)) return false;
  }

  const leftCallableKeys = new Set(left.callables.map((item) => callableKey(item)));
  if (!right.callables.every((item) => leftCallableKeys.has(callableKey(item)))) return false;
  if (right.content !== undefined
    && (left.content === undefined || !originSubsumes(left.content, right.content, seen, depth + 1))) return false;
  if (left.sequenceComplete && right.sequenceComplete) {
    if (left.sequence === undefined || right.sequence === undefined
      || left.sequence.length !== right.sequence.length) return false;
    for (let index = 0; index < right.sequence.length; index += 1) {
      if (!originSubsumes(left.sequence[index], right.sequence[index], seen, depth + 1)) return false;
    }
  }
  for (const [key, child] of right.shape) {
    const leftChild = left.shape.get(key);
    if (leftChild === undefined || !originSubsumes(leftChild, child, seen, depth + 1)) return false;
  }
  return true;
}

function mergeOriginPair(left, right, depth = 0) {
  const mergeBottomMayFacts = (bottom, retained) => {
    if (!bottom.mayBeAbsent && !bottom.mayBeNonExtensible) return retained;
    const output = snapshotOrigin(retained);
    output.mayBeAbsent ||= bottom.mayBeAbsent;
    output.mayBeNonExtensible ||= bottom.mayBeNonExtensible;
    for (const item of bottom.provenance) output.provenance.add(item);
    return output;
  };
  if (left.tags.size === 1 && left.tags.has(ORIGIN.BOTTOM)) {
    return mergeBottomMayFacts(left, right);
  }
  if (right.tags.size === 1 && right.tags.has(ORIGIN.BOTTOM)) {
    return mergeBottomMayFacts(right, left);
  }
  if (depth >= ORIGIN_JOIN_DEPTH_LIMIT) return widenedSecurityTail(left, right);
  if (left === right) return left;
  if (originSubsumes(left, right, new WeakMap(), depth)) return left;
  if (originSubsumes(right, left, new WeakMap(), depth)) return right;
  const output = emptyOrigin();
  output.mayBeAbsent = left.mayBeAbsent || right.mayBeAbsent;
  output.mayBeNonExtensible = left.mayBeNonExtensible || right.mayBeNonExtensible;
  output.finiteKeysComplete = left.finiteKeysComplete && right.finiteKeysComplete;
  output.shapeKeysComplete = left.shapeKeysComplete && right.shapeKeysComplete;
  output.sequenceComplete = left.sequenceComplete && right.sequenceComplete
    && left.sequence !== undefined && right.sequence !== undefined
    && left.sequence.length === right.sequence.length;
  output.assignSourceEvidenceComplete = left.assignSourceEvidenceComplete
    && right.assignSourceEvidenceComplete;
  output.nullPrototype = left.nullPrototype && right.nullPrototype;
  output.intrinsicPrototype = left.intrinsicPrototype && right.intrinsicPrototype;
  output.ordinaryData = left.ordinaryData && right.ordinaryData;
  output.initialDataKeys = new Set([...left.initialDataKeys]
    .filter((key) => right.initialDataKeys.has(key)));
  output.definedDataKeys = new Set([...left.definedDataKeys]
    .filter((key) => right.definedDataKeys.has(key)));
  output.accessorKeys = new Set([...left.accessorKeys, ...right.accessorKeys]);
  output.nonWritableKeys = new Set([...left.nonWritableKeys, ...right.nonWritableKeys]);
  output.nonEnumerableKeys = new Set([
    ...left.nonEnumerableKeys,
    ...right.nonEnumerableKeys,
  ]);
  output.invalidatedDataKeys = new Set([
    ...left.invalidatedDataKeys,
    ...right.invalidatedDataKeys,
  ]);
  output.hiddenKeys = new Set([...left.hiddenKeys].filter((key) => right.hiddenKeys.has(key)));
  output.assignSourceEvidence = new Map(left.assignSourceEvidence);
  for (const [key, evidence] of right.assignSourceEvidence) {
    const existing = output.assignSourceEvidence.get(key);
    output.assignSourceEvidence.set(key, existing === undefined ? evidence : {
      ...existing,
      directOwnedLiteral: existing.directOwnedLiteral && evidence.directOwnedLiteral,
      getterFree: existing.getterFree && evidence.getterFree,
      keysComplete: existing.keysComplete && evidence.keysComplete,
    });
  }
  const callableKeys = new Set();
  for (const value of [left, right]) {
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
    for (const item of value.surfaces) output.surfaces.add(item);
  }
  output.content = left.content === undefined
    ? right.content === undefined
      ? undefined
      : depth + 1 >= ORIGIN_JOIN_DEPTH_LIMIT
        ? widenedSecurityTail(right.content)
        : right.content
    : right.content === undefined
      ? depth + 1 >= ORIGIN_JOIN_DEPTH_LIMIT
        ? widenedSecurityTail(left.content)
        : left.content
      : mergeOriginPair(left.content, right.content, depth + 1);
  output.sequence = output.sequenceComplete
    ? left.sequence.map((child, index) => mergeOriginPair(child, right.sequence[index], depth + 1))
    : undefined;
  output.shape = new Map(left.shape);
  for (const [key, child] of right.shape) {
    output.shape.set(key, output.shape.has(key)
      ? mergeOriginPair(output.shape.get(key), child, depth + 1)
      : depth + 1 >= ORIGIN_JOIN_DEPTH_LIMIT
        ? widenedSecurityTail(child)
        : child);
  }
  return normalizeJoined(output);
}

export function joinOrigins(...values) {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return origin(ORIGIN.UNKNOWN, 'missing origin');
  return present.slice(1).reduce((output, value) => mergeOriginPair(output, value), present[0]);
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
  if (ts.isIdentifier(current)) {
    const symbol = resolvedSymbol(current, checker);
    const declaration = symbol?.declarations?.find((candidate) =>
      ts.isVariableDeclaration(candidate) && candidate.initializer !== undefined);
    if (declaration !== undefined && ts.isVariableDeclaration(declaration)
      && declaration.initializer !== undefined) {
      const values = staticStrings(declaration.initializer, constants, checker);
      if (values.size > 0) return values;
    }
  }
  const values = new Set();
  const collectType = (type) => {
    if (type.isUnion()) {
      type.types.forEach(collectType);
      return;
    }
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) values.add(type.value);
  };
  collectType(checker.getTypeAtLocation(current));
  if (values.size > 0) return values;
  return new Set();
}

export function staticKeys(node, constants, checker) {
  const values = new Set(staticStrings(node, constants, checker));
  const directNumber = staticNumber(node, constants, checker, new Set());
  if (directNumber !== undefined) values.add(directNumber);
  const collectType = (type) => {
    if (type.isUnion()) {
      type.types.forEach(collectType);
      return;
    }
    if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) values.add(type.value);
  };
  collectType(checker.getTypeAtLocation(unwrapExpression(node) ?? node));
  return values;
}

function finiteKeyDomain(node, checker) {
  const values = new Set();
  const visit = (type) => {
    if (type.isUnion?.()) {
      return type.types.length > 0 && type.types.every(visit);
    }
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
      values.add(type.value);
      return true;
    }
    if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      values.add(type.value);
      return true;
    }
    if ((type.flags & ts.TypeFlags.Never) !== 0) return true;
    return false;
  };
  try {
    const complete = visit(checker.getTypeAtLocation(unwrapExpression(node) ?? node));
    return { complete: complete && values.size > 0, values };
  } catch {
    return { complete: false, values };
  }
}

function staticKeyDomain(node, constants, checker) {
  const direct = staticKey(node, constants, checker);
  if (direct !== undefined) return { complete: true, keys: new Set([direct]) };
  const finite = finiteKeyDomain(node, checker);
  return {
    complete: finite.complete,
    keys: new Set([...staticKeys(node, constants, checker), ...finite.values]),
  };
}

function originSignature(value, state = signatureState(), depth = 0) {
  const cached = depthCached(state.origins, value, depth);
  if (cached !== undefined) return cached;
  if (state.visitingOrigins.has(value)) {
    return structuralDigest([
      'origin-cycle',
      ...[...value.tags].sort(),
      'allocations',
      ...[...value.allocations].sort(),
    ]);
  }
  if (depth >= ORIGIN_SIGNATURE_DEPTH_LIMIT) {
    const signature = transitiveSecurityDigest(value);
    setDepthCached(state.origins, value, depth, signature);
    return signature;
  }
  state.visitingOrigins.add(value);
  const shape = [...value.shape.entries()]
    .map(([key, child]) => `${stablePropertyKey(key)}:${originSignature(child, state, depth + 1)}`)
    .sort();
  const signature = structuralDigest([
    'origin',
    ...[...value.tags].sort(),
    'allocations',
    ...[...value.allocations].sort(),
    'constants',
    ...[...value.constants].sort(),
    'surfaces',
    ...[...value.surfaces].sort(),
    'callables',
    ...value.callables.map((item) => callableKey(item, state, depth + 1)).sort(),
    'content',
    value.content === undefined ? '' : originSignature(value.content, state, depth + 1),
    'shape',
    ...shape,
    'initial-data-keys',
    ...[...value.initialDataKeys].map(stablePropertyKey).sort(),
    'defined-data-keys',
    ...[...value.definedDataKeys].map(stablePropertyKey).sort(),
    'accessor-keys',
    ...[...value.accessorKeys].map(stablePropertyKey).sort(),
    'non-writable-keys',
    ...[...value.nonWritableKeys].map(stablePropertyKey).sort(),
    'non-enumerable-keys',
    ...[...value.nonEnumerableKeys].map(stablePropertyKey).sort(),
    'invalidated-data-keys',
    ...[...value.invalidatedDataKeys].map(stablePropertyKey).sort(),
    'presence',
    value.mayBeAbsent ? 'maybe-absent' : 'present',
    value.mayBeNonExtensible ? 'maybe-nonextensible' : 'extensible',
    'finite-keys',
    value.finiteKeysComplete ? 'complete' : 'open',
    'shape-keys',
    value.shapeKeysComplete ? 'complete' : 'open',
    'sequence',
    value.sequenceComplete ? 'complete' : 'open',
    ...(value.sequenceComplete && value.sequence !== undefined
      ? value.sequence.map((child) => originSignature(child, state, depth + 1))
      : []),
    'assign-source-evidence',
    value.assignSourceEvidenceComplete ? 'complete' : 'open',
    ...[...value.assignSourceEvidence.entries()]
      .map(([key, evidence]) => [
        key,
        evidence.directOwnedLiteral ? 'direct' : 'indirect',
        evidence.getterFree ? 'getter-free' : 'getter-possible',
        evidence.keysComplete ? 'keys-complete' : 'keys-open',
      ].join(':'))
      .sort(),
    'prototype',
    value.nullPrototype ? 'null-prototype' : '',
    value.intrinsicPrototype ? 'intrinsic-prototype' : '',
    'ordinary-data',
    value.ordinaryData ? 'ordinary-data' : '',
    'hidden',
    ...[...value.hiddenKeys].map(stablePropertyKey).sort(),
  ]);
  state.visitingOrigins.delete(value);
  setDepthCached(state.origins, value, depth, signature);
  return signature;
}

export function describeOrigin(value) {
  const tags = [...value.tags].sort().join('|');
  const trail = [...value.provenance].sort().slice(0, 6).join(' -> ');
  return `${tags || ORIGIN.UNKNOWN}${value.mayBeAbsent ? '|MaybeAbsent' : ''}${trail.length === 0 ? '' : ` (provenance: ${trail})`}`;
}

export function isProvenMutableLocal(value) {
  if (value.mayBeAbsent) return false;
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

function isDomLikeTsType(type, checker, seen = new Set()) {
  const visit = (type) => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection?.()) return type.types.some(visit);
    const symbol = type.aliasSymbol ?? type.getSymbol?.();
    const name = symbol?.getName?.() ?? '';
    const declarations = symbol?.declarations ?? [];
    const hostDeclaration = declarations.some((declaration) =>
      /typescript[\\/]lib[\\/]lib\.dom(?:\.iterable)?\.d\.ts$/u.test(declaration.getSourceFile().fileName));
    const reactHostEvent = /(?:Synthetic)?Event$/u.test(name) && declarations.some((declaration) =>
      /node_modules[\\/]@types[\\/]react[\\/]/u.test(declaration.getSourceFile().fileName));
    if ((hostDeclaration || reactHostEvent)
      && /^(?:Window|Document|Navigator|Location|History|MediaQueryList|.*Event|Storage|IDB.*|WebSocket|XMLHttpRequest|EventSource|Node|Element|HTMLElement|HTML.*Element|SVG.*Element)$/u.test(name)) {
      return true;
    }
    const constraint = checker.getBaseConstraintOfType?.(type);
    return constraint !== undefined && constraint !== type && visit(constraint);
  };
  return visit(type);
}

function typedHostReceiverRoot(node, checker) {
  const roots = new Set();
  const seen = new Set();
  const visit = (type) => {
    if (seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection?.()) {
      type.types.forEach(visit);
      return;
    }
    const symbol = type.aliasSymbol ?? type.getSymbol?.();
    const root = new Map([
      ['Window', 'window'],
      ['Document', 'document'],
      ['Navigator', 'navigator'],
      ['Location', 'location'],
      ['History', 'history'],
    ]).get(symbol?.getName?.());
    if (root !== undefined) roots.add(root);
    const constraint = checker.getBaseConstraintOfType?.(type);
    if (constraint !== undefined && constraint !== type) visit(constraint);
  };
  try {
    visit(checker.getTypeAtLocation(node));
  } catch {
    return undefined;
  }
  return roots.size === 1 ? [...roots][0] : undefined;
}

function isDomLikeType(node, checker) {
  try {
    return isDomLikeTsType(checker.getTypeAtLocation(node), checker);
  } catch {
    return false;
  }
}

function isPrimitiveLikeType(node, checker) {
  const type = checker.getTypeAtLocation(node);
  const primitiveFlags = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike
    | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Void
    | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never;
  if ((type.flags & primitiveFlags) !== 0) return true;
  return type.isUnionOrIntersection?.()
    ? type.types.every((member) => (member.flags & primitiveFlags) !== 0)
    : false;
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

function isStandardReceiverType(node, checker) {
  const standardNames = new Set(['Array', 'ReadonlyArray', 'Map', 'ReadonlyMap', 'Set', 'ReadonlySet', 'WeakMap', 'WeakSet', 'String', 'RegExp']);
  const isStandard = (type) => {
    if (type.isUnionOrIntersection?.()) {
      const members = type.types.filter((member) =>
        (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) === 0);
      return members.length > 0 && members.every(isStandard);
    }
    if ((type.flags & ts.TypeFlags.StringLike) !== 0) return true;
    if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
    const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
    return name !== undefined && standardNames.has(name);
  };
  try {
    return isStandard(checker.getTypeAtLocation(node));
  } catch {
    return false;
  }
}

function isZodLikeType(node, checker) {
  const seen = new Set();
  const visit = (type) => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection?.() && type.types.some(visit)) return true;
    const symbol = type.aliasSymbol ?? type.getSymbol?.();
    if (symbol?.declarations?.some((declaration) => /node_modules[\\/]zod[\\/]/u.test(declaration.getSourceFile().fileName))) {
      return true;
    }
    return [...(type.aliasTypeArguments ?? type.typeArguments ?? [])].some(visit);
  };
  try {
    return visit(checker.getTypeAtLocation(node));
  } catch {
    return false;
  }
}

function typeBrandFromDeclaration(node, checker, names, pathPattern) {
  const type = checker.getTypeAtLocation(node);
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  return symbol !== undefined && names.has(symbol.getName())
    && (symbol.declarations?.some((declaration) => pathPattern.test(declaration.getSourceFile().fileName)) ?? false);
}

function isReactUiCallbackType(node, checker) {
  return typeBrandFromDeclaration(
    node,
    checker,
    new Set(['Dispatch', 'DispatchWithoutAction']),
    /node_modules[\\/]@types[\\/]react[\\/]/u,
  );
}

function isCapabilityValidationType(node, checker) {
  return typeBrandFromDeclaration(
    node,
    checker,
    new Set(['CapabilityValidationPort']),
    /src[\\/]domain[\\/]types\.ts$/u,
  );
}

function isLocalCapabilityDefinitionType(node, checker) {
  const expectedProperties = new Set(['argumentsSchema', 'deriveResource', 'effect', 'facts', 'reduce']);
  const expectedMethodArities = new Map([
    ['deriveResource', 1],
    ['facts', 1],
    ['reduce', 2],
  ]);
  const seen = new Set();
  const visit = (type) => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection?.()) return type.types.some(visit);
    const symbol = type.aliasSymbol ?? type.getSymbol?.();
    if (symbol?.getName?.() !== 'CapabilityDefinition'
      || !(symbol.declarations?.some((declaration) =>
        /src[\\/]sandbox[\\/]capabilities\.ts$/u.test(declaration.getSourceFile().fileName)) ?? false)) return false;
    const properties = checker.getPropertiesOfType(type);
    if (properties.length !== expectedProperties.size
      || properties.some((property) => !expectedProperties.has(property.getName()))) return false;
    for (const [method, arity] of expectedMethodArities) {
      const property = properties.find((candidate) => candidate.getName() === method);
      const declaration = property?.valueDeclaration ?? property?.declarations?.[0];
      if (property === undefined || declaration === undefined) return false;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
      if (signatures.length !== 1 || signatures[0].getParameters().length !== arity) return false;
    }
    return true;
  };
  try {
    return visit(checker.getTypeAtLocation(node));
  } catch {
    return false;
  }
}

const exactLocalContractShapes = new Map([
  ['client', { method: 'fetch', parameterTypes: [], returnType: 'string' }],
  ['window', { method: 'focus', parameterTypes: [], returnType: 'void' }],
  ['document', { method: 'getElementById', parameterTypes: ['string'], returnType: 'string' }],
]);

function exactInlineSingleMethod(receiver, memberName, checker) {
  const symbol = resolvedSymbol(receiver, checker);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1 || !ts.isParameter(declarations[0])
    || !ts.isIdentifier(declarations[0].name) || declarations[0].name.text !== receiver.text
    || declarations[0].questionToken !== undefined || declarations[0].dotDotDotToken !== undefined
    || declarations[0].type === undefined || !ts.isTypeLiteralNode(declarations[0].type)
    || declarations[0].type.members.length !== 1) return undefined;
  const member = declarations[0].type.members[0];
  const memberText = member.name !== undefined && (ts.isIdentifier(member.name)
    || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name))
    ? member.name.text
    : undefined;
  if (memberText !== memberName || member.questionToken !== undefined) return undefined;
  try {
    const receiverType = checker.getTypeAtLocation(receiver);
    const properties = checker.getPropertiesOfType(receiverType);
    if (properties.length !== 1 || properties[0].getName() !== memberName
      || checker.getSignaturesOfType(receiverType, ts.SignatureKind.Call).length !== 0
      || checker.getSignaturesOfType(receiverType, ts.SignatureKind.Construct).length !== 0
      || checker.getIndexInfosOfType(receiverType).length !== 0) return undefined;
    const propertyDeclaration = properties[0].valueDeclaration ?? properties[0].declarations?.[0];
    if (propertyDeclaration === undefined) return undefined;
    const propertyType = checker.getTypeOfSymbolAtLocation(properties[0], propertyDeclaration);
    const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
    if (propertyType.isUnionOrIntersection?.()
      || checker.getPropertiesOfType(propertyType).length !== 0
      || checker.getIndexInfosOfType(propertyType).length !== 0
      || checker.getSignaturesOfType(propertyType, ts.SignatureKind.Construct).length !== 0
      || signatures.length !== 1 || signatures[0].thisParameter !== undefined) return undefined;
    return signatures[0];
  } catch {
    return undefined;
  }
}

function signatureParameterType(signature, index, checker) {
  const parameter = signature.getParameters()[index];
  const declaration = parameter?.valueDeclaration ?? parameter?.declarations?.[0];
  if (parameter === undefined || declaration === undefined
    || parameter.flags & ts.SymbolFlags.Optional
    || ('questionToken' in declaration && declaration.questionToken !== undefined)
    || ('dotDotDotToken' in declaration && declaration.dotDotDotToken !== undefined)) return undefined;
  return checker.getTypeOfSymbolAtLocation(parameter, declaration);
}

function exactPrimitiveType(type, expected) {
  const expectedFlags = new Map([
    ['string', ts.TypeFlags.String],
    ['void', ts.TypeFlags.Void],
    ['boolean', ts.TypeFlags.Boolean],
  ]);
  return type.flags === expectedFlags.get(expected);
}

function scalarType(type) {
  const scalarFlags = ts.TypeFlags.String | ts.TypeFlags.StringLiteral
    | ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral
    | ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
    | ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral
    | ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol
    | ts.TypeFlags.Null | ts.TypeFlags.Undefined;
  return (type.flags & scalarFlags) !== 0 && (type.flags & ~scalarFlags) === 0;
}

function sameSafeType(left, right, checker) {
  return left === right || (scalarType(left) && scalarType(right)
    && left.flags === right.flags && checker.typeToString(left) === checker.typeToString(right));
}

function exactLocalContractReceiver(node, memberName, checker) {
  const receiver = unwrapExpression(node);
  if (receiver === undefined || !ts.isIdentifier(receiver)) return undefined;
  const expected = exactLocalContractShapes.get(receiver.text);
  if (expected === undefined || expected.method !== memberName) return undefined;
  const symbol = resolvedSymbol(receiver, checker);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1 || !ts.isParameter(declarations[0])
    || !ts.isIdentifier(declarations[0].name) || declarations[0].name.text !== receiver.text) {
    return undefined;
  }
  try {
    const signature = exactInlineSingleMethod(receiver, memberName, checker);
    if (signature === undefined || (signature.typeParameters?.length ?? 0) !== 0
      || signature.getParameters().length !== expected.parameterTypes.length) return undefined;
    const parameterTypes = signature.getParameters().map((_, index) =>
      signatureParameterType(signature, index, checker));
    if (parameterTypes.some((type, index) => type === undefined
      || !exactPrimitiveType(type, expected.parameterTypes[index]))) return undefined;
    const returnType = checker.getReturnTypeOfSignature(signature);
    if (!exactPrimitiveType(returnType, expected.returnType)) return undefined;
    return receiver.text;
  } catch {
    return undefined;
  }
}

function exactReflectContract(memberName, signature, checker) {
  if ((signature.typeParameters?.length ?? 0) !== 0) return false;
  const expectedCount = memberName === 'get' ? 2 : memberName === 'set' ? 3 : -1;
  if (signature.getParameters().length !== expectedCount) return false;
  const targetType = signatureParameterType(signature, 0, checker);
  const keyType = signatureParameterType(signature, 1, checker);
  if (targetType === undefined || keyType === undefined || !keyType.isStringLiteral?.()
    || targetType.isUnionOrIntersection?.()
    || checker.getSignaturesOfType(targetType, ts.SignatureKind.Call).length !== 0
    || checker.getSignaturesOfType(targetType, ts.SignatureKind.Construct).length !== 0
    || checker.getIndexInfosOfType(targetType).length !== 0) return false;
  const properties = checker.getPropertiesOfType(targetType);
  if (properties.length !== 1 || properties[0].getName() !== keyType.value
    || properties[0].flags & ts.SymbolFlags.Optional) return false;
  const propertyDeclaration = properties[0].valueDeclaration ?? properties[0].declarations?.[0];
  if (propertyDeclaration === undefined) return false;
  const propertyType = checker.getTypeOfSymbolAtLocation(properties[0], propertyDeclaration);
  if (!scalarType(propertyType)) return false;
  if (memberName === 'get') {
    return sameSafeType(checker.getReturnTypeOfSignature(signature), propertyType, checker);
  }
  const valueType = signatureParameterType(signature, 2, checker);
  const returnType = checker.getReturnTypeOfSignature(signature);
  return valueType !== undefined && sameSafeType(valueType, propertyType, checker)
    && (returnType.flags === ts.TypeFlags.Boolean || returnType.flags === ts.TypeFlags.BooleanLiteral);
}

function exactObjectAssignContract(signature, checker) {
  const typeParameters = signature.typeParameters ?? [];
  if (typeParameters.length !== 1 || signature.getParameters().length !== 2) return false;
  const targetType = signatureParameterType(signature, 0, checker);
  const sourceType = signatureParameterType(signature, 1, checker);
  const resultType = checker.getReturnTypeOfSignature(signature);
  const parameter = typeParameters[0];
  const constraint = parameter.getConstraint?.() ?? checker.getBaseConstraintOfType(parameter);
  if (targetType !== parameter || resultType !== parameter || constraint === undefined
    || constraint.flags !== ts.TypeFlags.NonPrimitive || sourceType === undefined) return false;
  const alias = sourceType.aliasSymbol;
  const aliasArguments = sourceType.aliasTypeArguments ?? [];
  return alias?.getName?.() === 'Partial' && aliasArguments.length === 1 && aliasArguments[0] === parameter
    && (alias.declarations?.every((declaration) => /typescript[\\/]lib[\\/]lib\.[^/]+\.d\.ts$/u
      .test(declaration.getSourceFile().fileName)) ?? false);
}

function exactShadowNamespaceParameter(node, namespaceName, memberName, checker) {
  const receiver = unwrapExpression(node);
  if (receiver === undefined || !ts.isIdentifier(receiver) || receiver.text !== namespaceName) return false;
  try {
    const signature = exactInlineSingleMethod(receiver, memberName, checker);
    if (signature === undefined) return false;
    return namespaceName === 'Object' && memberName === 'assign'
      ? exactObjectAssignContract(signature, checker)
      : namespaceName === 'Reflect' && ['get', 'set'].includes(memberName)
        ? exactReflectContract(memberName, signature, checker)
        : false;
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

function nonNullishInequalitySymbol(condition, checker) {
  const current = unwrapExpression(condition);
  if (current === undefined || !ts.isBinaryExpression(current)
    || ![ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
      .includes(current.operatorToken.kind)) return undefined;
  const nullishKind = (candidate) => {
    const value = unwrapExpression(candidate);
    if (value?.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (value === undefined || !ts.isIdentifier(value) || value.text !== 'undefined') return undefined;
    const symbol = resolvedSymbol(value, checker);
    const declarations = symbol?.declarations ?? [];
    return symbol === undefined || declarations.length === 0
      || declarations.every((declaration) => /typescript[\\/]lib[\\/]lib\./u
        .test(declaration.getSourceFile().fileName))
      ? 'undefined'
      : undefined;
  };
  const leftNullish = nullishKind(current.left);
  const rightNullish = nullishKind(current.right);
  const comparedKind = leftNullish ?? rightNullish;
  // Strict `value !== null` does not exclude undefined. Loose `!= null`
  // excludes both nullish values; comparisons against undefined do too.
  if (comparedKind === 'null'
    && current.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) return undefined;
  const candidate = leftNullish !== undefined
    ? unwrapExpression(current.right)
    : rightNullish !== undefined
      ? unwrapExpression(current.left)
      : undefined;
  return candidate !== undefined && ts.isIdentifier(candidate)
    ? resolvedSymbol(candidate, checker)
    : undefined;
}

function isNarrowedPresentAt(node, symbol, checker) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isIfStatement(current) && isWithin(node, current.thenStatement)
      && nonNullishInequalitySymbol(current.expression, checker) === symbol) return true;
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

function isParameterChannel(channel) {
  return channel === 'parameter' || channel.startsWith('parameter:');
}

function isEmitlessDeclaration(node) {
  let current = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
    current = current.parent;
  }
  return node.getSourceFile().isDeclarationFile;
}

function functionName(node) {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
  return `anonymous@${node.pos}`;
}

function collectReturns(node) {
  if (node.body === undefined) return [];
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

function nearestContainingFunction(node) {
  let current = node;
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function identifierIsRuntimeInitialized(node, checker, useSite) {
  const symbol = resolvedSymbol(node, checker);
  if (symbol === undefined) return node.text === 'undefined';
  return (symbol.declarations ?? []).some((declaration) => {
    if (isEmitlessDeclaration(declaration)) return false;
    if (ts.isParameter(declaration) || ts.isImportSpecifier(declaration)
      || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)
      || ts.isFunctionDeclaration(declaration)) return true;
    if (ts.isVariableDeclaration(declaration)) {
      return declaration.getSourceFile() !== useSite.getSourceFile()
        || declaration.pos < useSite.pos;
    }
    return declaration.pos < useSite.pos;
  });
}

function isTriviallyNonThrowingExpression(input, checker, useSite) {
  const node = unwrapExpression(input);
  if (node === undefined) return false;
  if (ts.isIdentifier(node)) return identifierIsRuntimeInitialized(node, checker, useSite);
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
    || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword
    || node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every((element) => !ts.isSpreadElement(element)
      && (ts.isOmittedExpression(element)
        || isTriviallyNonThrowingExpression(element, checker, useSite)));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => {
      if (ts.isSpreadAssignment(property)) return false;
      if (property.name !== undefined && ts.isComputedPropertyName(property.name)
        && !isTriviallyNonThrowingExpression(property.name.expression, checker, useSite)) return false;
      if (ts.isPropertyAssignment(property)) {
        return isTriviallyNonThrowingExpression(property.initializer, checker, useSite);
      }
      return ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)
        || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property);
    });
  }
  return false;
}

function isPotentiallySkipped(node, checker) {
  let current = node;
  const owner = nearestContainingFunction(node);
  while (current.parent !== undefined && current.parent !== owner) {
    const parent = current.parent;
    if (ts.isBlock(parent) && ts.isTryStatement(parent.parent)
      && parent.parent.tryBlock === parent) {
      const statementIndex = parent.statements.indexOf(current);
      // A caught abrupt completion can leave the try and continue at the
      // later write without executing this descriptor establishment.  Only a
      // direct first statement is a must fact; nested blocks are deliberately
      // not treated as transparent because they can hide throws/branches.
      if (statementIndex !== 0 || current.parent !== parent
        || current !== node.parent) return true;
      if ((ts.isCallExpression(node) || ts.isNewExpression(node))
        && [...(node.arguments ?? [])].some((argument) =>
          !isTriviallyNonThrowingExpression(argument, checker, node))) return true;
    }
    // A break can leave a labelled statement and reach the later write while
    // bypassing any descriptor establishment nested inside the label.
    if (ts.isLabeledStatement(parent)) return true;
    if (ts.isIfStatement(parent) && (parent.thenStatement === current || parent.elseStatement === current)) return true;
    if (ts.isConditionalExpression(parent)
      && (parent.whenTrue === current || parent.whenFalse === current)) return true;
    if ((ts.isBinaryExpression(parent)
      && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
      ]
        .includes(parent.operatorToken.kind)) && parent.right === current) return true;
    if (ts.isIterationStatement(parent, false) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)
      || ts.isCatchClause(parent)) return true;
    current = parent;
  }
  return false;
}

export function createOriginAnalysis({ checker, sourceFiles, ir }) {
  const env = new Map();
  // Allocation-indexed may facts survive re-evaluation of the same literal
  // site. Function bodies and lexical initializers are analyzed repeatedly at
  // the fixed point; a descriptor mutation must not disappear merely because
  // a later projection materializes a fresh Origin object for that allocation.
  const allocationNonEnumerableKeys = new Map();
  const constants = new Map();
  const functions = new Map();
  const functionBySymbol = new Map();
  const classes = new Map();
  const classBySymbol = new Map();
  const functionBindings = new Map();
  const functionCalls = new Map();
  const functionAllCalls = new Map();
  const functionWrites = new Map();
  const referencedSymbols = new WeakMap();
  const externalParameterOrigins = new Map();
  const externallyCallableFunctionIds = new Set();
  const externallyInvokedCallbackIds = new Set();
  const facadeExportSymbols = new Set();
  const deferredBoundarySites = [];
  const deferredInvocationRecords = new Map();
  let unresolvedDeferredInvocation = false;
  const unresolvedDeferredReasons = new Set();
  const failDeferredInvocation = (reason) => {
    unresolvedDeferredInvocation = true;
    unresolvedDeferredReasons.add(reason);
  };
  const hostEventCallbackInput = origin(ORIGIN.AMBIENT, 'host event-listener callback input');
  const resolvingFunctions = new Set();
  const resolvingFunctionIds = new Set();
  const functionSummaryCache = new Map();
  const functionSummaryMutations = new Map();
  const functionSummaryOwner = new Map();
  const functionSummaryKeysById = new Map();
  const functionObservedOverrides = new Map();
  const functionObservedResults = new Map();
  const resolvingLexicalSymbols = new Set();
  const contextualNodeOrigins = new WeakMap();
  const contextualCallResolutions = new WeakMap();
  const contextualWriteDispatchProofs = new WeakMap();
  const irCallNodes = new WeakSet(ir.calls.map((call) => call.node));
  const directDependentFunctionsBySymbol = new Map();
  const callerFunctionsById = new Map();
  const functionSummaryCacheLimit = 2_048;
  const browserFacadeFileSuffix = '/src/platform/browser-capabilities.tsx';
  const isBrowserFacadeFile = (file) => file.fileName.replaceAll('\\', '/')
    .endsWith(browserFacadeFileSuffix);
  const recordDeferredInvocation = (site, callable, argumentsList, kind) => {
    if (!callableArgumentIsResolved(callable)) {
      failDeferredInvocation(`unresolved registration ${kind} at ${site.getSourceFile().fileName}:${site.pos}`);
      return;
    }
    const siteKey = `${site.getSourceFile().fileName}:${site.pos}:${kind}`;
    const records = deferredInvocationRecords.get(siteKey) ?? [];
    const semanticKey = structuralDigest([
      kind,
      ...callable.callables.map((entry) => callableKey(entry)).sort(),
      'arguments',
      ...argumentsList.map((value) => originSignature(value)),
    ]);
    if (!records.some((record) => record.semanticKey === semanticKey)) {
      if (records.length >= 32) {
        failDeferredInvocation(`registration alternatives exceeded for ${siteKey}`);
      } else {
        records.push({ argumentsList, callable, kind, semanticKey, site });
        deferredInvocationRecords.set(siteKey, records);
      }
    }
  };
  const recordContextualOrigin = (node, value) => {
    const previous = contextualNodeOrigins.get(node);
    const snapshot = snapshotOrigin(value);
    contextualNodeOrigins.set(node, previous === undefined ? snapshot : joinOrigins(previous, snapshot));
  };
  const recordWriteDispatchProof = (node, safe) => {
    const previous = contextualWriteDispatchProofs.get(node);
    contextualWriteDispatchProofs.set(node, previous === undefined ? safe : previous && safe);
  };
  const mergeContextualCallResolution = (previous, next) => {
    const stabilized = {
      ...next,
      origin: snapshotOrigin(next.origin),
      callee: snapshotOrigin(next.callee),
      mutationReceivers: next.mutationReceivers.map((mutation) => ({
        ...mutation,
        receiver: snapshotOrigin(mutation.receiver),
        target: mutation.target === undefined ? undefined : snapshotOrigin(mutation.target),
        keys: new Set(mutation.keys ?? []),
        assignSources: (mutation.assignSources ?? []).map((source) => ({
          ...source,
          origin: snapshotOrigin(source.origin),
          keys: new Set(source.keys ?? []),
        })),
      })),
    };
    if (previous === undefined) return stabilized;
    const mutations = new Map();
    for (const mutation of [...previous.mutationReceivers, ...stabilized.mutationReceivers]) {
      const site = mutation.site;
      const siteKey = site === undefined
        ? mutation.label
        : `${site.getSourceFile().fileName}:${site.pos}`;
      const key = `${mutation.api ?? ''}:${siteKey}`;
      const existing = mutations.get(key);
      if (existing === undefined) {
        mutations.set(key, mutation);
        continue;
      }
      const assignSources = new Map();
      for (const source of [...(existing.assignSources ?? []), ...(mutation.assignSources ?? [])]) {
        const sourceSite = source.node === undefined
          ? '<unknown>'
          : `${source.node.getSourceFile().fileName}:${source.node.pos}`;
        const sourceKey = `${source.sourceIndex}:${sourceSite}`;
        const previousSource = assignSources.get(sourceKey);
        assignSources.set(sourceKey, previousSource === undefined ? source : {
          ...previousSource,
          origin: joinOrigins(previousSource.origin, source.origin),
          keys: new Set([...(previousSource.keys ?? []), ...(source.keys ?? [])]),
          keysComplete: previousSource.keysComplete && source.keysComplete,
          getterFree: previousSource.getterFree && source.getterFree,
          directOwnedLiteral: previousSource.directOwnedLiteral && source.directOwnedLiteral,
        });
      }
      mutations.set(key, {
        ...existing,
        receiver: joinOrigins(existing.receiver, mutation.receiver),
        target: existing.target === undefined
          ? mutation.target
          : mutation.target === undefined
            ? existing.target
            : joinOrigins(existing.target, mutation.target),
        keys: new Set([...(existing.keys ?? []), ...(mutation.keys ?? [])]),
        keysComplete: existing.keysComplete !== false && mutation.keysComplete !== false,
        dispatchSafe: existing.dispatchSafe !== false && mutation.dispatchSafe !== false,
        descriptorDataOnly: existing.descriptorDataOnly === undefined
          ? mutation.descriptorDataOnly
          : mutation.descriptorDataOnly === undefined
            ? existing.descriptorDataOnly
            : existing.descriptorDataOnly && mutation.descriptorDataOnly,
        assignSourceCount: existing.assignSourceCount === mutation.assignSourceCount
          ? existing.assignSourceCount
          : Math.max(existing.assignSourceCount ?? 0, mutation.assignSourceCount ?? 0),
        assignSourcesComplete: existing.assignSourcesComplete !== false
          && mutation.assignSourcesComplete !== false
          && existing.assignSourceCount === mutation.assignSourceCount,
        assignSources: [...assignSources.values()],
      });
    }
    return {
      known: previous.known && stabilized.known,
      origin: joinOrigins(previous.origin, stabilized.origin),
      effects: new Set([...previous.effects, ...stabilized.effects]),
      mutationReceivers: [...mutations.values()],
      description: [...new Set([...previous.description.split('|'), ...stabilized.description.split('|')])]
        .sort()
        .join('|'),
      callee: joinOrigins(previous.callee, stabilized.callee),
    };
  };
  const deleteFunctionSummary = (key) => {
    functionSummaryCache.delete(key);
    functionSummaryMutations.delete(key);
    const owner = functionSummaryOwner.get(key);
    functionSummaryOwner.delete(key);
    if (owner !== undefined) functionSummaryKeysById.get(owner)?.delete(key);
  };
  const cacheFunctionSummary = (key, value, functionId, mutations = []) => {
    if (!functionSummaryCache.has(key) && functionSummaryCache.size >= functionSummaryCacheLimit) {
      deleteFunctionSummary(functionSummaryCache.keys().next().value);
    }
    functionSummaryCache.set(key, value);
    functionSummaryMutations.set(key, mutations);
    functionSummaryOwner.set(key, functionId);
    const keys = functionSummaryKeysById.get(functionId) ?? new Set();
    keys.add(key);
    functionSummaryKeysById.set(functionId, keys);
  };
  const invalidateFunctionSummaries = () => {
    functionSummaryCache.clear();
    functionSummaryMutations.clear();
    functionSummaryOwner.clear();
    functionSummaryKeysById.clear();
  };
  const invalidateFunctionSummariesForSymbol = (symbol) => {
    const pending = [...(directDependentFunctionsBySymbol.get(symbol) ?? [])];
    const visited = new Set();
    while (pending.length > 0) {
      const functionId = pending.pop();
      if (functionId === undefined || visited.has(functionId)) continue;
      visited.add(functionId);
      for (const key of [...(functionSummaryKeysById.get(functionId) ?? [])]) deleteFunctionSummary(key);
      pending.push(...(callerFunctionsById.get(functionId) ?? []));
    }
  };
  const recordFunctionResult = (functionId, value) => {
    const snapshot = snapshotOrigin(value);
    const previous = functionObservedResults.get(functionId);
    functionObservedResults.set(functionId, previous === undefined
      ? snapshot
      : joinOrigins(previous, snapshot));
  };
  const THIS_ORIGIN = Symbol('this-origin');
  const privateMemberKeys = new WeakMap();
  const privateMemberFallbackKeys = new WeakMap();
  const classMemberShapeKey = (name) => {
    if (ts.isPrivateIdentifier(name)) {
      const symbol = resolvedSymbol(name, checker);
      const keys = symbol === undefined ? privateMemberFallbackKeys : privateMemberKeys;
      const identity = symbol ?? name;
      if (!keys.has(identity)) keys.set(identity, Symbol(`private:${name.text}`));
      return keys.get(identity);
    }
    if (ts.isComputedPropertyName(name)) {
      const key = staticKey(name.expression, constants, checker);
      return key === undefined
        ? `[[unresolved-computed:${name.getSourceFile().fileName}:${name.pos}]]`
        : String(key);
    }
    return name.getText().replace(/^['"]|['"]$/gu, '');
  };
  const unresolvedClassMemberKey = (key) => typeof key === 'string'
    && key.startsWith('[[unresolved-computed:');

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

  const registerClass = (node) => {
    const id = `${node.getSourceFile().fileName}:${node.pos}`;
    classes.set(id, node);
    if (node.name !== undefined) {
      const symbol = resolvedSymbol(node.name, checker);
      if (symbol !== undefined) classBySymbol.set(symbol, id);
    }
  };

  for (const file of sourceFiles) {
    const visit = (node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
        && node.body !== undefined) {
        registerFunction(node);
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) registerClass(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const [id, fn] of functions) {
    functionBindings.set(id, ir.bindings.filter((binding) => nearestContainingFunction(binding.node) === fn));
    const calls = ir.calls.filter((call) => nearestContainingFunction(call.node) === fn);
    functionCalls.set(id, calls);
    functionAllCalls.set(id, calls);
    functionWrites.set(id, ir.writes.filter((write) => nearestContainingFunction(write.node) === fn));
  }

  const componentFunctionId = (input, seen = new Set()) => {
    const node = unwrapExpression(input);
    if (node === undefined) return undefined;
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) {
      const id = `${node.getSourceFile().fileName}:${node.pos}`;
      return functions.has(id) ? id : undefined;
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolvedSymbol(node, checker);
      if (symbol === undefined || seen.has(symbol)) return undefined;
      if (functionBySymbol.has(symbol)) return functionBySymbol.get(symbol);
      seen.add(symbol);
      const declaration = symbol.declarations?.find((candidate) =>
        ts.isVariableDeclaration(candidate) && candidate.initializer !== undefined);
      return declaration !== undefined && ts.isVariableDeclaration(declaration)
        ? componentFunctionId(declaration.initializer, seen)
        : undefined;
    }
    if (ts.isCallExpression(node)) {
      const identity = importIdentity(node.expression, checker);
      if (identity === 'react:forwardRef' || identity === 'react:memo') {
        return node.arguments[0] === undefined ? undefined : componentFunctionId(node.arguments[0], seen);
      }
    }
    return undefined;
  };

  const jsxSitesByFunction = new Map();
  const unknownJsxSites = [];
  for (const file of sourceFiles) {
    const visitJsxSites = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const symbol = resolvedSymbol(node.tagName, checker);
        const id = symbol === undefined
          ? undefined
          : functionBySymbol.get(symbol) ?? componentFunctionId(node.tagName);
        const frameworkIdentity = importIdentity(node.tagName, checker);
        if (id !== undefined) {
          const sites = jsxSitesByFunction.get(id) ?? [];
          sites.push(node);
          jsxSitesByFunction.set(id, sites);
        } else if (!(ts.isIdentifier(node.tagName)
          && /^[a-z]/u.test(node.tagName.text))
          && !['react:Fragment', 'react:StrictMode'].includes(frameworkIdentity ?? '')) {
          unknownJsxSites.push(node);
        }
      }
      ts.forEachChild(node, visitJsxSites);
    };
    visitJsxSites(file);
  }

  const closedJsxCallbackSymbols = new Set();
  const closedJsxValueSymbols = new Set();
  const jsxCallbackEdges = [];
  const jsxValueEdges = [];
  for (const [id, sites] of jsxSitesByFunction) {
    const parameterBindings = (functionBindings.get(id) ?? []).filter((binding) =>
      isParameterChannel(binding.channel) && ts.isIdentifier(binding.target)
      && binding.projection.length === 1 && binding.projection[0]?.property !== undefined
      && typeIsCallable(binding.target, checker));
    for (const binding of parameterBindings) {
      const property = binding.projection[0].property;
      const expressions = [];
      let closed = sites.length > 0;
      for (const site of sites) {
        if (site.attributes.properties.some(ts.isJsxSpreadAttribute)) {
          closed = false;
          break;
        }
        const attribute = site.attributes.properties.find((candidate) =>
          ts.isJsxAttribute(candidate) && candidate.name.getText() === property);
        if (attribute === undefined || !ts.isJsxAttribute(attribute)
          || attribute.initializer === undefined || !ts.isJsxExpression(attribute.initializer)
          || attribute.initializer.expression === undefined) {
          closed = false;
          break;
        }
        expressions.push(attribute.initializer.expression);
      }
      if (!closed) continue;
      const symbol = resolvedSymbol(binding.target, checker);
      if (symbol === undefined) continue;
      closedJsxCallbackSymbols.add(symbol);
      expressions.forEach((expression) => jsxCallbackEdges.push({
        symbol,
        expression,
        property,
        target: binding.target,
      }));
    }
    const valueBindings = (functionBindings.get(id) ?? []).filter((binding) =>
      isParameterChannel(binding.channel) && ts.isIdentifier(binding.target)
      && !typeIsCallable(binding.target, checker));
    for (const binding of valueBindings) {
      const symbol = resolvedSymbol(binding.target, checker);
      if (symbol === undefined) continue;
      closedJsxValueSymbols.add(symbol);
      jsxValueEdges.push({ symbol, sites, projection: binding.projection, target: binding.target });
    }
  }

  const symbolsReferencedDirectlyBy = (fn) => {
    if (referencedSymbols.has(fn)) return referencedSymbols.get(fn);
    const symbols = new Set();
    const visit = (node) => {
      if (node !== fn && ts.isFunctionLike(node)) return;
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol(node, checker);
        if (symbol !== undefined) symbols.add(symbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
    referencedSymbols.set(fn, symbols);
    return symbols;
  };

  const functionIdFromExpression = (input, seen = new Set()) => {
    const node = unwrapExpression(input);
    if (node === undefined) return undefined;
    if (ts.isFunctionLike(node) && node.body !== undefined) {
      const id = `${node.getSourceFile().fileName}:${node.pos}`;
      return functions.has(id) ? id : undefined;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = resolvedSymbol(node, checker);
    if (symbol === undefined || seen.has(symbol)) return undefined;
    if (functionBySymbol.has(symbol)) return functionBySymbol.get(symbol);
    seen.add(symbol);
    const declaration = symbol.declarations?.find((candidate) =>
      ts.isVariableDeclaration(candidate) && candidate.initializer !== undefined);
    return declaration !== undefined && ts.isVariableDeclaration(declaration)
      && declaration.initializer !== undefined
      ? functionIdFromExpression(declaration.initializer, seen)
      : undefined;
  };

  const bindingSourcesBySymbol = new Map();
  const bindingDefinitionsBySymbol = new Map();
  for (const binding of ir.bindings) {
    if (!ts.isIdentifier(binding.target) || binding.source === undefined) continue;
    const symbol = resolvedSymbol(binding.target, checker);
    if (symbol === undefined) continue;
    const sources = bindingSourcesBySymbol.get(symbol) ?? [];
    sources.push(binding.source);
    bindingSourcesBySymbol.set(symbol, sources);
    const definitions = bindingDefinitionsBySymbol.get(symbol) ?? [];
    definitions.push(binding);
    bindingDefinitionsBySymbol.set(symbol, definitions);
  }

  const functionTargetsForSymbol = (rootSymbol) => {
    const targets = new Set();
    const seenSymbols = new Set();
    const visitExpression = (input) => {
      const node = unwrapExpression(input);
      if (node === undefined) return;
      if (ts.isFunctionLike(node)) {
        const id = `${node.getSourceFile().fileName}:${node.pos}`;
        if (functions.has(id)) targets.add(id);
        return;
      }
      if (ts.isIdentifier(node)) {
        const symbol = resolvedSymbol(node, checker);
        if (symbol !== undefined) visitSymbol(symbol);
      }
      ts.forEachChild(node, visitExpression);
    };
    const visitSymbol = (symbol) => {
      if (seenSymbols.has(symbol)) return;
      seenSymbols.add(symbol);
      const directId = functionBySymbol.get(symbol);
      if (directId !== undefined) targets.add(directId);
      for (const source of bindingSourcesBySymbol.get(symbol) ?? []) visitExpression(source);
    };
    visitSymbol(rootSymbol);
    return targets;
  };

  for (const [id, fn] of functions) {
    const localSymbols = new Set((functionBindings.get(id) ?? [])
      .map((binding) => ts.isIdentifier(binding.target)
        ? resolvedSymbol(binding.target, checker)
        : undefined)
      .filter((symbol) => symbol !== undefined));
    for (const symbol of symbolsReferencedDirectlyBy(fn)) {
      if (localSymbols.has(symbol)) continue;
      const dependents = directDependentFunctionsBySymbol.get(symbol) ?? new Set();
      dependents.add(id);
      directDependentFunctionsBySymbol.set(symbol, dependents);
      for (const targetId of functionTargetsForSymbol(symbol)) {
        const callers = callerFunctionsById.get(targetId) ?? new Set();
        callers.add(id);
        callerFunctionsById.set(targetId, callers);
      }
    }
  }

  for (const file of sourceFiles) {
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (moduleSymbol === undefined) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(exported)
        : exported;
      if (isBrowserFacadeFile(file)) facadeExportSymbols.add(symbol);
      const directId = functionBySymbol.get(symbol);
      if (directId !== undefined) externallyCallableFunctionIds.add(directId);
      for (const id of functionTargetsForSymbol(symbol)) externallyCallableFunctionIds.add(id);
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          const id = functionIdFromExpression(declaration.initializer);
          if (id !== undefined) externallyCallableFunctionIds.add(id);
        }
      }
    }
  }

  const parameterContaining = (node, fn) => {
    let current = node;
    while (current !== undefined && current !== fn) {
      if (ts.isParameter(current)) return current;
      current = current.parent;
    }
    return undefined;
  };

  const runtimeParameterIndex = (fn, parameter) => {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === 'this') return -1;
    const declaredIndex = fn.parameters.indexOf(parameter);
    return fn.parameters.slice(0, declaredIndex)
      .filter((candidate) => !(ts.isIdentifier(candidate.name) && candidate.name.text === 'this')).length;
  };

  const directArgumentEdges = [];
  for (const call of ir.calls) {
    const callNode = call.node;
    const calleeNode = ts.isTaggedTemplateExpression(callNode) ? callNode.tag : callNode.expression;
    const metaName = ts.isCallExpression(callNode)
      && (ts.isPropertyAccessExpression(calleeNode) || ts.isElementAccessExpression(calleeNode))
      ? propertyText(calleeNode, constants, checker)
      : undefined;
    const targetNode = ['call', 'apply'].includes(metaName ?? '')
      && (ts.isPropertyAccessExpression(calleeNode) || ts.isElementAccessExpression(calleeNode))
      ? calleeNode.expression
      : calleeNode;
    const functionId = functionIdFromExpression(targetNode) ?? componentFunctionId(targetNode);
    const fn = functionId === undefined ? undefined : functions.get(functionId);
    if (fn === undefined || isWithin(callNode, fn)) continue;
    for (const binding of functionBindings.get(functionId) ?? []) {
      if (!isParameterChannel(binding.channel) || !ts.isIdentifier(binding.target)) continue;
      const parameter = parameterContaining(binding.target, fn);
      const parameterIndex = parameter === undefined ? -1 : runtimeParameterIndex(fn, parameter);
      const symbol = resolvedSymbol(binding.target, checker);
      if (parameterIndex < 0 || symbol === undefined) continue;
      directArgumentEdges.push({
        binding,
        callNode,
        metaName,
        parameter,
        parameterIndex,
        symbol,
      });
    }
  }

  const markExternalCallback = (input, provenance) => {
    const id = functionIdFromExpression(input);
    const fn = id === undefined ? undefined : functions.get(id);
    if (fn === undefined) return;
    externallyInvokedCallbackIds.add(id);
    for (const parameter of fn.parameters) {
      if (!ts.isIdentifier(parameter.name)) continue;
      const symbol = resolvedSymbol(parameter.name, checker);
      if (symbol === undefined) continue;
      const boundary = isDomLikeType(input.parent, checker) || isDomLikeType(parameter.name, checker)
        ? origin(ORIGIN.AMBIENT, provenance)
        : declaredOriginPlaceholder(parameter.name, provenance);
      externalParameterOrigins.set(symbol, externalParameterOrigins.has(symbol)
        ? joinOrigins(externalParameterOrigins.get(symbol), boundary)
        : boundary);
    }
  };

  function declaredOriginPlaceholder(node, provenance) {
    if (isDomLikeType(node, checker)) return origin(ORIGIN.AMBIENT, provenance);
    if (typeIsCallable(node, checker)) return withCallable({ kind: 'external-contract', name: node.getText() }, provenance);
    return origin(ORIGIN.BORROWED, provenance);
  }

  for (const file of sourceFiles) {
    const visitBoundary = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined
        && /(?:RefCallback|EventHandler|MouseEventHandler|KeyboardEventHandler)/u.test(typeText(node.name, checker))) {
        markExternalCallback(node.initializer, `external callback contract ${typeText(node.name, checker)}`);
        deferredBoundarySites.push({ expression: node.initializer, kind: 'typed-callback' });
      }
      if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)
        && node.initializer.expression !== undefined
        && (/^on[A-Z]/u.test(node.name.getText()) || node.name.getText() === 'ref')) {
        markExternalCallback(node.initializer.expression, `JSX callback edge ${node.name.getText()}`);
        deferredBoundarySites.push({
          expression: node.initializer.expression,
          kind: `jsx:${node.name.getText()}`,
        });
      }
      if (ts.isJsxSpreadAttribute(node)) {
        deferredBoundarySites.push({ expression: node.expression, kind: 'jsx-spread' });
      }
      if (ts.isCallExpression(node)
        && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        && propertyText(node.expression, constants, checker) === 'addEventListener'
        && node.arguments[1] !== undefined) {
        markExternalCallback(node.arguments[1], 'host event-listener callback edge');
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        const name = callee !== undefined && ts.isIdentifier(callee)
          ? callee.text
          : callee !== undefined
            && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
            ? propertyText(callee, constants, checker)
            : undefined;
        if (['setInterval', 'setTimeout'].includes(name ?? '') && node.arguments[0] !== undefined) {
          markExternalCallback(node.arguments[0], `host ${name} callback edge`);
        }
        const imported = callee === undefined ? undefined : importIdentity(callee, checker);
        if (imported === 'react:useEffect' && node.arguments[0] !== undefined) {
          markExternalCallback(node.arguments[0], 'React effect callback edge');
        }
      }
      ts.forEachChild(node, visitBoundary);
    };
    visitBoundary(file);
  }

  const constantOrigin = (value, provenance) => origin(ORIGIN.CONSTANT, provenance, {
    constants: new Set([value === undefined ? '<undefined>' : value]),
    finiteKeysComplete: typeof value === 'string' || typeof value === 'number',
  });

  const declaredOrigin = (node, provenance) => {
    if (isZodLikeType(node, checker)) return withBrand(ORIGIN.ZOD, provenance);
    if (isReactUiCallbackType(node, checker)) {
      return withCallable({ kind: 'ui', name: 'React dispatch' }, provenance);
    }
    if (isCapabilityValidationType(node, checker)) {
      return withCallable({ kind: 'domain-validator', name: 'CapabilityValidationPort' }, provenance);
    }
    if (typeIsCallable(node, checker)) {
      return withCallable({
        kind: isParameterBinding(node) ? 'external-contract' : 'unknown',
        name: node.getText(),
      }, provenance);
    }
    if (isDomLikeType(node, checker)) return origin(ORIGIN.AMBIENT, provenance);
    if (expressionTypeIsUncertain(node, checker)) return origin(ORIGIN.UNKNOWN, provenance);
    const finiteDomain = finiteKeyDomain(node, checker);
    return origin(ORIGIN.BORROWED, provenance, finiteDomain.complete ? {
      constants: finiteDomain.values,
      finiteKeysComplete: true,
    } : {});
  };

  const project = (value, projection, allocationNode, overrides = new Map(), depth = 0) => {
    let current = value;
    for (const step of projection) {
      if (step === '@element') {
        current = current.content ?? (current.tags.has(ORIGIN.AMBIENT) || current.tags.has(ORIGIN.OPAQUE)
          ? current
          : joinOrigins(...current.shape.values()));
        continue;
      }
      if (step === '@key') {
        current = constantOrigin('<iteration-key>', 'for-in iteration key');
        continue;
      }
      if (typeof step === 'object' && step.rest !== undefined) {
        if (!current.tags.has(ORIGIN.OWNED) || current.tags.size !== 1) {
          current = joinOrigins(current, origin(ORIGIN.UNKNOWN, `${step.rest} rest from non-owned value`));
          continue;
        }
        const entries = [...current.shape.entries()].filter(([key]) => step.rest === 'object'
          ? !(step.excluded ?? []).map(String).includes(key)
          : Number.isInteger(Number(key)) && Number(key) >= (step.from ?? 0));
        const shape = new Map(entries.map(([key, child], index) => [
          step.rest === 'array' ? String(index) : key,
          child,
        ]));
        const children = [...shape.values()];
        current = freshOwned(allocationNode, allocationProvenance(allocationNode, `${step.rest} rest allocation`), {
          shape,
          initialDataKeys: new Set(shape.keys()),
          content: children.length === 0 ? undefined : joinOrigins(...children),
          intrinsicPrototype: true,
        });
        continue;
      }
      const key = typeof step === 'number'
        ? String(step)
        : step.index !== undefined
          ? String(step.index)
          : step.property ?? (step.keyNode === undefined
          ? undefined
          : staticString(step.keyNode, constants, checker));
      const namespace = [...current.constants].find((value) => ['Object', 'Reflect', 'Array', 'JSON', 'Math', 'Number', 'String'].includes(value));
      const namespacePath = namespace === undefined || key === undefined ? undefined : `${namespace}.${key}`;
      if (namespacePath !== undefined && (objectMutationCalls.has(namespacePath)
        || pureGlobalCalls.has(namespacePath) || ownedGlobalResults.has(namespacePath)
        || forbiddenCapabilityEffects.has(namespacePath) || browserFacadeCalls.has(namespacePath))) {
        current = withCallable({ kind: 'builtin', name: namespacePath }, `namespace projection ${namespacePath}`);
      } else if (current.tags.has(ORIGIN.AMBIENT)) {
        current = origin(ORIGIN.AMBIENT, `projection ${key ?? '[computed]'} from ambient value`, isPrimitiveLikeType(allocationNode, checker)
          ? { surfaces: new Set([SURFACE.SCALAR]) }
          : {});
      } else if (key !== undefined && current.shape.has(key)) {
        current = current.shape.get(key);
      } else if (current.content !== undefined) {
        current = current.content;
      } else if (current.tags.has(ORIGIN.OWNED)) {
        current = origin(ORIGIN.BORROWED, `unmodelled field ${key ?? '[computed]'} of owned value`);
      } else {
        current = joinOrigins(current, origin(ORIGIN.BORROWED, `projected ${key ?? '[computed]'}`));
      }
      if (typeof step === 'object' && step.fallback !== undefined) {
        current = joinOrigins(current, evaluate(step.fallback, overrides, depth + 1));
      }
    }
    return current;
  };

  let evaluate;
  let resolveCall;

  const functionCallable = (node, overrides) => {
    const id = `${node.getSourceFile().fileName}:${node.pos}`;
    const referenced = symbolsReferencedDirectlyBy(node);
    const closure = overrides === undefined
      ? undefined
      : new Map([...overrides].filter(([symbol]) => symbol === THIS_ORIGIN || referenced.has(symbol)));
    return withCallable({
      kind: 'function',
      id,
      name: functionName(node),
      closure,
    }, allocationProvenance(node, `local function ${functionName(node)}`));
  };

  const instantiateClass = (entry, argumentsList, node, depth) => {
    const declaration = classes.get(entry.id);
    if (declaration === undefined) return origin(ORIGIN.UNKNOWN, `unresolved class ${entry.name}`);
    const instance = freshOwned(node, allocationProvenance(node, `new ${entry.name}`));
    const extendsType = declaration.heritageClauses
      ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (extendsType !== undefined) {
      const baseSymbol = resolvedSymbol(extendsType.expression, checker);
      const baseId = baseSymbol === undefined ? undefined : classBySymbol.get(baseSymbol);
      if (baseId === undefined || depth > 12) {
        instance.tags.delete(ORIGIN.OWNED);
        instance.tags.add(ORIGIN.UNKNOWN);
        instance.surfaces.add(SURFACE.UNKNOWN);
        instance.provenance.add(`unresolved base class ${extendsType.expression.getText()}`);
      } else {
        const base = instantiateClass({
          kind: 'local-class',
          id: baseId,
          name: extendsType.expression.getText(),
        }, argumentsList, node, depth + 1);
        for (const [key, value] of base.shape) instance.shape.set(key, value);
        for (const key of base.initialDataKeys) instance.initialDataKeys.add(key);
        for (const key of base.definedDataKeys) instance.definedDataKeys.add(key);
        for (const key of base.nonWritableKeys) instance.nonWritableKeys.add(key);
        for (const key of base.nonEnumerableKeys) instance.nonEnumerableKeys.add(key);
        for (const key of base.invalidatedDataKeys) instance.invalidatedDataKeys.add(key);
        for (const key of base.hiddenKeys) instance.hiddenKeys.add(key);
        instance.content = base.content;
      }
    }
    const classOverrides = new Map([[THIS_ORIGIN, instance]]);
    const constructor = declaration.members.find(ts.isConstructorDeclaration);
    constructor?.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name) || parameter.modifiers === undefined) return;
      instance.shape.set(parameter.name.text, argumentsList[index]
        ?? declaredOrigin(parameter.name, `constructor parameter ${parameter.name.text}`));
      instance.initialDataKeys.add(parameter.name.text);
    });
    for (const member of declaration.members) {
      if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
      if (ts.isPropertyDeclaration(member) && member.name !== undefined) {
        const key = classMemberShapeKey(member.name);
        if (ts.isPrivateIdentifier(member.name)) instance.hiddenKeys.add(key);
        const value = member.initializer === undefined
          ? declaredOrigin(member.name, `class field ${stablePropertyKey(key)}`)
          : evaluate(member.initializer, classOverrides, depth + 1);
        instance.shape.set(key, unresolvedClassMemberKey(key)
          ? joinOrigins(value, origin(ORIGIN.UNKNOWN, 'unresolved computed public class field'))
          : value);
        if (!unresolvedClassMemberKey(key)) instance.initialDataKeys.add(key);
      }
      if (ts.isMethodDeclaration(member) && member.body !== undefined) {
        const key = classMemberShapeKey(member.name);
        if (ts.isPrivateIdentifier(member.name)) instance.hiddenKeys.add(key);
        const value = functionCallable(member, classOverrides);
        instance.shape.set(key, unresolvedClassMemberKey(key)
          ? joinOrigins(value, origin(ORIGIN.UNKNOWN, 'unresolved computed public class method'))
          : value);
      }
      if (ts.isGetAccessorDeclaration(member) && member.body !== undefined) {
        const key = classMemberShapeKey(member.name);
        if (ts.isPrivateIdentifier(member.name)) instance.hiddenKeys.add(key);
        const value = evaluateFunction({
          kind: 'function',
          id: `${member.getSourceFile().fileName}:${member.pos}`,
          name: functionName(member),
          closure: classOverrides,
        }, [], depth + 1);
        instance.shape.set(key, unresolvedClassMemberKey(key)
          ? joinOrigins(value, origin(ORIGIN.UNKNOWN, 'unresolved computed public class accessor'))
          : value);
      }
    }
    const children = [...instance.shape.entries()]
      .filter(([key]) => !instance.hiddenKeys.has(key))
      .map(([, value]) => value);
    instance.content = children.length === 0
      ? instance.content
      : instance.content === undefined
        ? joinOrigins(...children)
        : joinOrigins(instance.content, ...children);
    return instance;
  };

  const evaluateFunction = (entry, argumentsList, depth, mutationCollector = [], forceReplay = false) => {
    const fn = functions.get(entry.id);
    if (fn === undefined || depth > 12) return origin(ORIGIN.UNKNOWN, `unresolved function ${entry.name}`);
    const returnNodes = collectReturns(fn);
    if (resolvingFunctionIds.has(entry.id)) {
      return collectReturns(fn).length === 0
        ? constantOrigin(undefined, `recursive void summary ${entry.name}`)
        : origin(ORIGIN.UNKNOWN, `recursive value summary ${entry.name}`);
    }
    const recursionKey = `${entry.id}:${argumentsList.map((value) => originSignature(value)).join(',')}`;
    const localSymbols = new Set((functionBindings.get(entry.id) ?? [])
      .map((binding) => ts.isIdentifier(binding.target) ? resolvedSymbol(binding.target, checker) : undefined)
      .filter((symbol) => symbol !== undefined));
    const dependencies = [...symbolsReferencedDirectlyBy(fn)]
      .filter((symbol) => !localSymbols.has(symbol) && env.has(symbol))
      .map((symbol) => `${stableSymbolKey(symbol)}=${originSignature(env.get(symbol))}`)
      .sort();
    const hasOriginChangingOperations = (functionWrites.get(entry.id)?.length ?? 0) > 0
      || (functionCalls.get(entry.id)?.length ?? 0) > 0;
    const cacheKey = structuralDigest([
      'function-summary',
      callableKey(entry),
      recursionKey,
      ...(hasOriginChangingOperations
        ? [
          'mutation-identities',
          ...argumentsList.map(stableOriginKey),
          ...(entry.closure === undefined ? [] : [...entry.closure.values()].map(stableOriginKey)),
        ]
        : []),
      ...dependencies,
    ]);
    if (!forceReplay && functionSummaryCache.has(cacheKey)) {
      mutationCollector.push(...(functionSummaryMutations.get(cacheKey) ?? []));
      return functionSummaryCache.get(cacheKey);
    }
    if (resolvingFunctions.has(recursionKey)) {
      return origin(ORIGIN.BORROWED, `recursive summary ${entry.name}`);
    }
    resolvingFunctions.add(recursionKey);
    resolvingFunctionIds.add(entry.id);
    const mutationStart = mutationCollector.length;
    try {
      const overrides = new Map(entry.closure ?? []);
      const recordObservedOverrides = () => {
        const observedOverrides = functionObservedOverrides.get(entry.id) ?? new Map();
        for (const [symbol, value] of overrides) {
          const previous = observedOverrides.get(symbol);
          const merged = previous === undefined ? value : joinOrigins(previous, value);
          observedOverrides.set(symbol, previous !== undefined
            && originSignature(previous) === originSignature(merged)
            ? previous
            : merged);
        }
        functionObservedOverrides.set(entry.id, observedOverrides);
      };
      const bindings = functionBindings.get(entry.id) ?? [];
      for (const binding of bindings) {
        if (!isParameterChannel(binding.channel) || !ts.isIdentifier(binding.target)) continue;
        const parameter = parameterContaining(binding.target, fn);
        const parameterIndex = parameter === undefined ? -1 : runtimeParameterIndex(fn, parameter);
        const symbol = resolvedSymbol(binding.target, checker);
        if (parameter === undefined || parameterIndex < 0 || symbol === undefined) continue;
        const passed = parameter.dotDotDotToken === undefined
          ? argumentsList[parameterIndex] === undefined
            ? undefined
            : abstractLargeArgument(argumentsList[parameterIndex], `parameter ${binding.target.text}`)
          : freshOwned(fn, allocationProvenance(fn, `rest arguments for ${entry.name}`), {
            shape: new Map(argumentsList.slice(parameterIndex).map((value, index) => [String(index), value])),
            content: argumentsList.length <= parameterIndex
              ? origin(ORIGIN.BORROWED, `empty rest arguments for ${entry.name}`)
              : joinOrigins(...argumentsList.slice(parameterIndex)),
          });
        const boundaryValue = env.get(symbol);
        const fallback = parameter.initializer === undefined
          ? boundaryValue ?? declaredOrigin(binding.target, `parameter ${binding.target.text}`)
          : evaluate(parameter.initializer, overrides, depth + 1);
        // Parameter symbols in `env` have already been projected onto the
        // binding target by a closed JSX/callback boundary. Projecting that
        // target value a second time loses its exact callable/UI-cell brand
        // (and can mix in sibling object content). Runtime arguments, by
        // contrast, still start at the parameter declaration and therefore
        // need the binding projection exactly once.
        const projectedFallback = () => project(
          passed ?? fallback,
          binding.projection,
          binding.target,
          overrides,
          depth + 1,
        );
        const unobservedBoundary = boundaryValue?.tags.size === 1
          && boundaryValue.tags.has(ORIGIN.BOTTOM);
        overrides.set(symbol, passed !== undefined
          ? unobservedBoundary || boundaryValue === undefined
            ? projectedFallback()
            : joinOrigins(boundaryValue, projectedFallback())
          : parameter.initializer !== undefined
            ? unobservedBoundary || boundaryValue === undefined
              ? projectedFallback()
              : joinOrigins(boundaryValue, projectedFallback())
            : boundaryValue ?? projectedFallback());
      }
      const functionIterationBudget = Math.max(8, bindings.length + 1);
      const convergeBindings = () => {
        for (let iteration = 0; iteration < functionIterationBudget; iteration += 1) {
          const beforeIteration = structuralDigest([...overrides.entries()]
            .map(([symbol, value]) => `${stableSymbolKey(symbol)}=${originSignature(value)}`)
            .sort());
          for (const binding of bindings) {
            if (!ts.isIdentifier(binding.target)) continue;
            const symbol = resolvedSymbol(binding.target, checker);
            if (symbol === undefined) continue;
            const source = isParameterChannel(binding.channel)
              ? overrides.get(symbol) ?? declaredOrigin(binding.target, `parameter ${binding.target.text}`)
              : binding.source === undefined
                ? binding.channel === 'catch'
                  ? origin(ORIGIN.UNKNOWN, `unknown thrown value bound to ${binding.target.text}`)
                  : constantOrigin(undefined, `uninitialised local ${binding.target.text}`)
                : project(
                  evaluate(binding.source, overrides, depth + 1),
                  binding.projection,
                  binding.target,
                  overrides,
                  depth + 1,
                );
            const previous = overrides.get(symbol);
            // A function-valued declaration is a lexical closure snapshot,
            // not a control-flow alternative. Re-evaluating it after earlier
            // locals converge must refresh the captured frame; joining the
            // first incomplete snapshot permanently retained a callable that
            // had lost preceding local allocations. Assignments still join
            // below because they represent genuine runtime alternatives.
            const refreshesLexicalClosure = binding.channel === 'declaration'
              && source.callables.length > 0;
            const merged = previous === undefined || refreshesLexicalClosure
              ? source
              : joinOrigins(previous, source);
            const previousSignature = originSignature(previous ?? emptyOrigin());
            const mergedSignature = originSignature(merged);
            overrides.set(symbol, previous !== undefined && previousSignature === mergedSignature ? previous : merged);
          }
          const afterIteration = structuralDigest([...overrides.entries()]
            .map(([symbol, value]) => `${stableSymbolKey(symbol)}=${originSignature(value)}`)
            .sort());
          if (beforeIteration === afterIteration) return true;
        }
        return false;
      };
      if (!convergeBindings()) {
        const widened = origin(ORIGIN.UNKNOWN, `function fixed point exceeded for ${entry.name}`);
        recordObservedOverrides();
        recordFunctionResult(entry.id, widened);
        cacheFunctionSummary(cacheKey, widened, entry.id, mutationCollector.slice(mutationStart));
        return widened;
      }

      // A binding target declared outside this function is a captured slot
      // write, not a function-local declaration. Publish its conservative
      // joined value back to the owning lexical frame/global environment so
      // callers and facade-export traversal observe interprocedural capture
      // (including JSX, alias, call/apply, and host-callback invocations).
      const capturedBindingSymbols = new Set(bindings
        .filter((binding) => !isParameterChannel(binding.channel) && ts.isIdentifier(binding.target))
        .map((binding) => resolvedSymbol(binding.target, checker))
        .filter((symbol) => symbol !== undefined
          && !(symbol.declarations ?? []).some((declaration) => isWithin(declaration, fn))));
      for (const symbol of capturedBindingSymbols) {
        const value = overrides.get(symbol);
        if (value === undefined) continue;
        if (entry.closure?.has(symbol)) {
          entry.closure.set(symbol, joinOrigins(entry.closure.get(symbol), value));
        }
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        const owner = declaration === undefined ? undefined : nearestContainingFunction(declaration);
        if (owner !== undefined) {
          const ownerId = `${owner.getSourceFile().fileName}:${owner.pos}`;
          const observed = functionObservedOverrides.get(ownerId) ?? new Map();
          observed.set(symbol, joinOrigins(observed.get(symbol), value));
          functionObservedOverrides.set(ownerId, observed);
        } else if (env.has(symbol)) {
          const previous = env.get(symbol);
          const merged = joinOrigins(previous, value);
          if (originSignature(previous) !== originSignature(merged)) {
            env.set(symbol, merged);
            invalidateFunctionSummariesForSymbol(symbol);
          }
        }
      }

      // Binding convergence computes the receiver/value graph. Replay each
      // origin-changing operation once, in runtime source order, then converge
      // projections again so reads after a mutation observe the transferred
      // origin. Replaying mutations inside the lattice fixed point repeatedly
      // grew the same cyclic graphs and made convergence depend on iteration
      // count rather than program semantics.
      const mutationOperations = [
        ...(functionWrites.get(entry.id) ?? []).map((write) => ({
          kind: 'write',
          position: write.node.pos,
          write,
        })),
        ...(functionCalls.get(entry.id) ?? []).map((call) => ({
          kind: 'call',
          position: call.node.pos,
          call,
        })),
      ].sort((left, right) => left.position - right.position);
      let orderedDescriptorRefreshFailed = false;
      for (const operation of mutationOperations) {
        if (operation.kind === 'write') {
          const { write } = operation;
          const receiver = evaluate(write.receiver, overrides, depth + 1);
          recordContextualOrigin(write.receiver, receiver);
          const written = write.source === undefined
            ? constantOrigin(undefined, `delete ${write.receiver.getText()}`)
            : project(
              evaluate(write.source, overrides, depth + 1),
              write.projection,
              write.node,
              overrides,
              depth + 1,
            );
          const keyDomain = mutationKeyDomainForWrite(write);
          const { keys } = keyDomain;
          // Bottom is a provisional no-value state while an earlier ordered
          // collection mutation is still being replayed. It cannot witness a
          // runtime dispatch; a permanently Bottom receiver still fails the
          // scanner fallback, while a later reachable state records a proof.
          if (!(receiver.tags.size === 1 && receiver.tags.has(ORIGIN.BOTTOM))) {
            recordWriteDispatchProof(
              write.node,
              write.channel === 'delete'
                || ordinarySetDispatchSafe(receiver, keys, keyDomain.complete),
            );
          }
          invalidateSequence(receiver, `function-local ${write.channel} write`);
          if (write.channel === 'delete') {
            const invalidated = !keyDomain.complete || keys.size === 0
              ? new Set([...receiver.initialDataKeys, ...receiver.definedDataKeys])
              : keys;
            for (const key of invalidated) {
              const normalized = descriptorPropertyKey(key);
              receiver.definedDataKeys.delete(normalized);
              receiver.accessorKeys.delete(normalized);
              receiver.nonWritableKeys.delete(normalized);
              receiver.invalidatedDataKeys.add(normalized);
              receiver.shape.delete(normalized);
            }
          } else {
            for (const key of keys) mergeShapeValue(receiver, key, written);
            mergeContent(receiver, written, `function-local ${write.channel} write transfer`);
          }
          mutationCollector.push({
            receiver,
            target: receiver,
            keys,
            keysComplete: keys.size > 0 || receiver.nullPrototype,
            dispatchSafe: true,
            label: `function-local ${write.channel} write`,
            api: 'direct-write',
            argumentsList: [],
          });
        } else {
          const { call } = operation;
          const resolution = resolveCall(call.node, overrides, depth + 1);
          mutationCollector.push(...resolution.mutationReceivers);
          if (resolution.mutationReceivers.some((mutation) => [
            'Object.defineProperty',
            'Object.defineProperties',
            'Reflect.defineProperty',
          ].includes(mutation.api ?? '')) && !convergeBindings()) {
            orderedDescriptorRefreshFailed = true;
            break;
          }
        }
      }
      if (orderedDescriptorRefreshFailed
        || (mutationOperations.length > 0 && !convergeBindings())) {
        const widened = origin(ORIGIN.UNKNOWN, `function fixed point exceeded for ${entry.name}`);
        recordObservedOverrides();
        recordFunctionResult(entry.id, widened);
        cacheFunctionSummary(cacheKey, widened, entry.id, mutationCollector.slice(mutationStart));
        return widened;
      }
      recordObservedOverrides();
      const returns = returnNodes.map((node) => evaluate(node, overrides, depth + 1));
      const rawResult = returns.length === 0
        ? constantOrigin(undefined, `void return from ${entry.name}`)
        : joinOrigins(...returns);
      const result = abstractLargeArgument(rawResult, `return from ${entry.name}`);
      recordFunctionResult(entry.id, result);
      cacheFunctionSummary(cacheKey, result, entry.id, mutationCollector.slice(mutationStart));
      return result;
    } finally {
      resolvingFunctions.delete(recursionKey);
      resolvingFunctionIds.delete(entry.id);
    }
  };

  const propertyOrigin = (node, overrides, depth) => {
    const name = ts.isPropertyAccessExpression(node) && ts.isPrivateIdentifier(node.name)
      ? classMemberShapeKey(node.name)
      : propertyText(node, constants, checker);
    const path = actualStaticPath(node, constants, checker);
    if (path !== undefined) {
      if (objectMutationCalls.has(path) || pureGlobalCalls.has(path) || ownedGlobalResults.has(path)
        || forbiddenCapabilityEffects.has(path) || browserFacadeCalls.has(path)) {
        return withCallable({ kind: 'builtin', name: path }, `global callable ${path}`);
      }
      if (/^(?:Object|Reflect|Array|JSON|Math|Number|String)\./u.test(path)
        && !['call', 'apply', 'bind'].includes(name ?? '')) {
        return withCallable({ kind: 'unknown', name: path }, `unsummarized global callable ${path}`);
      }
    }
    const receiver = evaluate(node.expression, overrides, depth + 1);
    if (receiver.tags.has(ORIGIN.UI_CELL) && name === 'current') {
      return receiver.shape.get('current') ?? receiver.content
        ?? origin(ORIGIN.UNKNOWN, 'React ref current value is unresolved');
    }
    if (name !== undefined && receiver.shape.has(name)) return receiver.shape.get(name);
    if (receiver.tags.has(ORIGIN.AMBIENT)) {
      const typedPath = name === undefined ? undefined : (() => {
        const root = typedHostReceiverRoot(node.expression, checker);
        return root === undefined ? undefined : `${root}.${name}`;
      })();
      const ambientName = [path, typedPath, name]
        .find((candidate) => candidate !== undefined
          && (forbiddenCapabilityEffects.has(candidate) || browserFacadeCalls.has(candidate)))
        ?? name ?? '[computed]';
      const ambient = origin(ORIGIN.AMBIENT, `projection ${ambientName} from ambient value`, isPrimitiveLikeType(node, checker)
        ? { surfaces: new Set([SURFACE.SCALAR]) }
        : {});
      return typeIsCallable(node, checker) || forbiddenCapabilityEffects.has(ambientName)
        || browserFacadeCalls.has(ambientName)
        ? joinOrigins(ambient, withCallable({ kind: 'ambient', name: ambientName, receiver }, `ambient member ${ambientName}`))
        : ambient;
    }
    if (receiver.tags.has(ORIGIN.OPAQUE)) {
      if (name === 'render') {
        return joinOrigins(
          origin(ORIGIN.OPAQUE, 'opaque React root member'),
          withCallable({ kind: 'opaque-method', name, receiver }, 'opaque React root render'),
        );
      }
      const opaque = origin(ORIGIN.OPAQUE, `projection ${name ?? '[computed]'} from opaque reflection/capability value`);
      return typeIsCallable(node, checker)
        ? joinOrigins(opaque, withCallable({ kind: 'opaque-member', name: name ?? '[computed]', receiver }, 'opaque callable projection'))
        : opaque;
    }
    if ((receiver.tags.has(ORIGIN.ZOD) || isZodLikeType(node.expression, checker))
      && name !== undefined && zodPureMethods.has(name)) {
      return withCallable({ kind: 'zod', name, receiver }, `Zod method ${name}`);
    }
    if (isCapabilityValidationType(node, checker)) {
      return withCallable({ kind: 'domain-validator', name: 'CapabilityValidationPort', receiver }, 'summarized local capability validator');
    }
    if (name !== undefined && ['call', 'apply', 'bind'].includes(name)) {
      return withCallable({ kind: 'meta', name, receiver }, `meta-call ${name} on ${describeOrigin(receiver)}`);
    }
    if (name !== undefined && (receiver.tags.has(ORIGIN.OWNED)
      || receiver.tags.has(ORIGIN.CONSTANT)
      || isStandardReceiverType(node.expression, checker)
      || (uiMethods.has(name) && isDomLikeType(node.expression, checker)))
      && (mutatingMethodEffects.has(name)
      || pureStandardMethods.has(name)
      || uiMethods.has(name))) {
      return withCallable({ kind: 'method', name, receiver }, `method ${name} on ${describeOrigin(receiver)}`);
    }
    if (typeIsCallable(node, checker)) {
      const exactReceiverLabel = name === undefined
        ? undefined
        : exactLocalContractReceiver(node.expression, name, checker);
      const exactObjectParameter = name === 'assign'
        && exactShadowNamespaceParameter(node.expression, 'Object', 'assign', checker);
      if (exactObjectParameter) {
        return withCallable({
          kind: 'contract-object-assign',
          name,
          receiver,
          receiverLabel: 'Object',
        }, 'receiver-branded local Object.assign contract');
      }
      const exactReflectParameter = name === 'get'
        ? exactShadowNamespaceParameter(node.expression, 'Reflect', 'get', checker)
        : name === 'set'
          ? exactShadowNamespaceParameter(node.expression, 'Reflect', 'set', checker)
          : false;
      if (exactReflectParameter) {
        return withCallable({
          kind: name === 'get' ? 'contract-reflect-get' : 'contract-reflect-set',
          name,
          receiver,
          receiverLabel: 'Reflect',
        }, `receiver-branded local Reflect.${name} contract`);
      }
      return withCallable({
        kind: 'contract-method',
        name: name ?? node.getText(),
        receiver,
        receiverLabel: isLocalCapabilityDefinitionType(node.expression, checker)
          ? 'CapabilityDefinition'
          : exactReceiverLabel,
      }, `typed local callable ${node.getText()}`);
    }
    if (isDomLikeType(node, checker)) {
      return origin(ORIGIN.AMBIENT, `capability-bearing projection ${name ?? '[computed]'} with type ${typeText(node, checker)}`);
    }
    if (receiver.content !== undefined) return receiver.content;
    if (expressionTypeIsUncertain(node, checker)) return origin(ORIGIN.UNKNOWN, `uncertain property ${name ?? '[computed]'}`);
    if (receiver.tags.has(ORIGIN.UNKNOWN)) return origin(ORIGIN.UNKNOWN, `property ${name ?? '[computed]'} of unknown value`);
    return origin(ORIGIN.BORROWED, `data property ${name ?? '[computed]'}`);
  };

  const objectOrigin = (node, overrides, depth) => {
    const shape = new Map();
    const children = [];
    const initialDataKeys = new Set();
    const accessorKeys = new Set();
    let shapeKeysComplete = true;
    let literalPrototype = 'default';
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = evaluate(property.expression, overrides, depth + 1);
        shapeKeysComplete &&= spread.shapeKeysComplete;
        for (const [key, child] of spread.shape) {
          if (!spread.hiddenKeys.has(key)) {
            const definitelyPresent = (spread.initialDataKeys.has(key)
              || spread.definedDataKeys.has(key))
              && !spread.invalidatedDataKeys.has(key)
              && !spread.nonEnumerableKeys.has(key);
            shape.set(key, shape.has(key) && !definitelyPresent
              ? joinOrigins(shape.get(key), child)
              : child);
            // Shape is a may-domain: joins retain keys present on only one
            // branch so projections remain conservative. Object spread may
            // copy that value, but it establishes an own-data must fact only
            // when the source key is definitely present on every alternative.
            // Preserve the canonical key identity (including symbols) rather
            // than promoting/stringifying every may-shape entry.
            if (definitelyPresent) {
              initialDataKeys.add(key);
            }
          }
        }
        children.push(spread.content ?? spread);
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const keyDomain = ts.isComputedPropertyName(property.name)
          ? staticKeyDomain(property.name.expression, constants, checker)
          : {
            complete: true,
            keys: new Set([property.name.getText().replace(/^['"]|['"]$/gu, '')]),
          };
        const value = evaluate(property.initializer, overrides, depth + 1);
        shapeKeysComplete &&= keyDomain.complete;
        const key = keyDomain.keys.size === 1 ? [...keyDomain.keys][0] : undefined;
        const prototypeSetter = key === '__proto__' && !ts.isComputedPropertyName(property.name);
        if (prototypeSetter) {
          literalPrototype = property.initializer.kind === ts.SyntaxKind.NullKeyword
            ? 'null'
            : 'custom';
        } else {
          for (const possibleKey of keyDomain.keys) shape.set(descriptorPropertyKey(possibleKey), value);
          if (keyDomain.complete && keyDomain.keys.size === 1 && key !== undefined) {
            initialDataKeys.add(descriptorPropertyKey(key));
          }
        }
        children.push(value);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        const value = evaluate(property.name, overrides, depth + 1);
        shape.set(property.name.text, value);
        initialDataKeys.add(property.name.text);
        children.push(value);
        continue;
      }
      if (ts.isMethodDeclaration(property)) {
        const keyDomain = ts.isComputedPropertyName(property.name)
          ? staticKeyDomain(property.name.expression, constants, checker)
          : {
            complete: true,
            keys: new Set([property.name.getText().replace(/^['"]|['"]$/gu, '')]),
          };
        const value = functionCallable(property, overrides);
        shapeKeysComplete &&= keyDomain.complete;
        for (const key of keyDomain.keys) shape.set(descriptorPropertyKey(key), value);
        if (keyDomain.complete && keyDomain.keys.size === 1) {
          initialDataKeys.add(descriptorPropertyKey([...keyDomain.keys][0]));
        }
        children.push(value);
        continue;
      }
      if (ts.isGetAccessorDeclaration(property) && property.body !== undefined) {
        const keyDomain = ts.isComputedPropertyName(property.name)
          ? staticKeyDomain(property.name.expression, constants, checker)
          : {
            complete: true,
            keys: new Set([property.name.getText().replace(/^['"]|['"]$/gu, '')]),
          };
        const value = evaluateFunction({
          kind: 'function',
          id: `${property.getSourceFile().fileName}:${property.pos}`,
          name: functionName(property),
          closure: overrides,
        }, [], depth + 1);
        shapeKeysComplete &&= keyDomain.complete;
        for (const key of keyDomain.keys) {
          shape.set(descriptorPropertyKey(key), value);
          accessorKeys.add(descriptorPropertyKey(key));
        }
        children.push(value);
      }
      if (ts.isSetAccessorDeclaration(property)) {
        const keyDomain = ts.isComputedPropertyName(property.name)
          ? staticKeyDomain(property.name.expression, constants, checker)
          : {
            complete: true,
            keys: new Set([property.name.getText().replace(/^['"]|['"]$/gu, '')]),
          };
        shapeKeysComplete &&= keyDomain.complete;
        for (const key of keyDomain.keys) accessorKeys.add(descriptorPropertyKey(key));
      }
    }
    const directAssignSource = shapeKeysComplete && !node.properties.some((property) =>
      ts.isSpreadAssignment(property) || ts.isGetAccessorDeclaration(property)
      || ts.isSetAccessorDeclaration(property));
    const assignEvidenceKey = `${node.getSourceFile().fileName}:${node.pos}`;
    const result = freshOwned(node, allocationProvenance(node, 'fresh object allocation'), {
      shape,
      initialDataKeys,
      accessorKeys,
      shapeKeysComplete,
      content: children.length === 0 ? undefined : joinOrigins(...children),
      nullPrototype: literalPrototype === 'null',
      intrinsicPrototype: literalPrototype === 'default',
      ordinaryData: !node.properties.some((property) =>
        ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)),
      assignSourceEvidenceComplete: true,
      assignSourceEvidence: new Map([[assignEvidenceKey, {
        directOwnedLiteral: directAssignSource,
        getterFree: directAssignSource,
        keysComplete: directAssignSource,
        node,
      }]]),
    });
    for (const allocation of result.allocations) {
      for (const key of allocationNonEnumerableKeys.get(allocation) ?? []) {
        result.nonEnumerableKeys.add(key);
      }
    }
    const capabilityMethods = ['deriveResource', 'facts', 'reduce'];
    const exactCapabilityShape = shape.size === 5
      && ['argumentsSchema', 'deriveResource', 'effect', 'facts', 'reduce']
        .every((key) => shape.has(key))
      && capabilityMethods.every((key) => callableArgumentIsResolved(shape.get(key)));
    if (!exactCapabilityShape) return result;
    const facts = transitiveSecurityFacts(result);
    const carriesUnresolvedAuthority = [ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN, ORIGIN.UI_CELL]
      .some((tag) => facts.tags.has(tag))
      || [SURFACE.HOST, SURFACE.OPAQUE, SURFACE.UNKNOWN]
        .some((surface) => facts.surfaces.has(surface));
    return carriesUnresolvedAuthority
      ? result
      : joinOrigins(result, withBrand(ORIGIN.LOCAL_CAPABILITY, 'structurally proven local capability allocation'));
  };

  const arrayOrigin = (node, overrides, depth) => {
    const shape = new Map();
    const children = [];
    const initialDataKeys = new Set();
    const sequence = [];
    let sequenceComplete = true;
    let shapeKeysComplete = true;
    node.elements.forEach((element) => {
      if (ts.isOmittedExpression(element)) {
        const missing = constantOrigin(undefined, allocationProvenance(element, 'sparse array hole'));
        if (sequenceComplete) sequence.push(missing);
        children.push(missing);
        return;
      }
      if (ts.isSpreadElement(element)) {
        const spread = evaluate(element.expression, overrides, depth + 1);
        const expanded = positionalSequence(spread, 'array spread');
        if (!expanded.complete) {
          sequenceComplete = false;
          shapeKeysComplete = false;
          children.push(spread.content ?? spread);
          return;
        }
        for (const child of expanded.values) {
          if (sequenceComplete) {
            const key = String(sequence.length);
            sequence.push(child);
            // Array iteration materializes a source hole as an own undefined
            // element in the newly spread array.
            shape.set(key, child);
            initialDataKeys.add(key);
          }
          children.push(child);
        }
        return;
      }
      const value = evaluate(element, overrides, depth + 1);
      if (sequenceComplete) {
        const key = String(sequence.length);
        sequence.push(value);
        shape.set(key, value);
        initialDataKeys.add(key);
      } else {
        shapeKeysComplete = false;
      }
      children.push(value);
    });
    return freshOwned(node, allocationProvenance(node, 'fresh array allocation'), {
      shape,
      shapeKeysComplete,
      initialDataKeys,
      sequence,
      sequenceComplete,
      intrinsicPrototype: true,
      content: children.length === 0
        ? origin(ORIGIN.BORROWED, 'empty array element type')
        : joinOrigins(...children),
      ordinaryData: true,
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
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      return overrides.get(THIS_ORIGIN) ?? origin(ORIGIN.BORROWED, 'unresolved this receiver');
    }
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
      || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
      || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) {
      const literalValue = node.kind === ts.SyntaxKind.TrueKeyword
        ? true
        : node.kind === ts.SyntaxKind.FalseKeyword
          ? false
          : node.kind === ts.SyntaxKind.NullKeyword
            ? null
            : node.kind === ts.SyntaxKind.UndefinedKeyword
              ? undefined
              : node.text;
      return constantOrigin(literalValue, allocationProvenance(node, 'literal'));
    }
    if (ts.isTemplateExpression(node)) {
      return constantOrigin(undefined, allocationProvenance(node, 'template value'));
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolvedSymbol(node, checker);
      const symbolDeclarations = symbol?.declarations ?? [];
      const unshadowedUndefined = node.text === 'undefined'
        && (symbol === undefined || symbolDeclarations.length === 0
          || symbolDeclarations.every((declaration) => /typescript[\\/]lib[\\/]lib\./u
            .test(declaration.getSourceFile().fileName)));
      if (unshadowedUndefined) {
        return constantOrigin(undefined, 'global undefined');
      }
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
      }
      if (symbol !== undefined && overrides.has(symbol)) {
        const value = overrides.get(symbol);
        return isNarrowedPresentAt(node, symbol, checker)
          ? withoutAbsence(value, `non-nullish guard for ${node.text}`)
          : value;
      }
      if (symbol !== undefined && env.has(symbol)) {
        const value = env.get(symbol);
        return isNarrowedPresentAt(node, symbol, checker)
          ? withoutAbsence(value, `non-nullish guard for ${node.text}`)
          : value;
      }
      if (symbol !== undefined && functionBySymbol.has(symbol)) {
        return functionCallable(functions.get(functionBySymbol.get(symbol)), overrides);
      }
      if (symbol !== undefined && classBySymbol.has(symbol)) {
        const id = classBySymbol.get(symbol);
        return withCallable({ kind: 'local-class', id, name: node.text }, `local class ${node.text}`);
      }
      const lexicalDefinitions = symbol === undefined ? undefined : bindingDefinitionsBySymbol.get(symbol);
      if (symbol !== undefined && lexicalDefinitions !== undefined && lexicalDefinitions.length > 0) {
        if (resolvingLexicalSymbols.has(symbol)) {
          return origin(ORIGIN.UNKNOWN, `recursive lexical binding ${node.text}`);
        }
        resolvingLexicalSymbols.add(symbol);
        try {
          // A nested closure may be queried before its parent summary has
          // materialized every captured symbol. Resolve that missing capture
          // from the same closed-world binding IR (including projections and
          // all reassignment alternatives) instead of inventing BorrowedData.
          // Ambient/unknown assignment sources therefore remain ambient/
          // unknown, while a fresh local declaration retains its allocation.
          return joinOrigins(...lexicalDefinitions.map((binding) => project(
            evaluate(binding.source, overrides, depth + 1),
            binding.projection,
            binding.target,
            overrides,
            depth + 1,
          )));
        } finally {
          resolvingLexicalSymbols.delete(symbol);
        }
      }
      if (imported?.startsWith('.')) {
        return typeIsCallable(node, checker)
          ? withCallable({ kind: 'contract', name: node.text }, `unresolved imported local callable ${node.text}`)
          : origin(ORIGIN.BORROWED, `unresolved imported local data ${node.text}`);
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
        return left.mayBeAbsent
          ? joinOrigins(withoutAbsence(left, 'present coalescing branch'), right)
          : left;
      }
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.CommaToken].includes(node.operatorToken.kind)) {
        return joinOrigins(evaluate(node.left, overrides, depth + 1), evaluate(node.right, overrides, depth + 1));
      }
      const finiteKey = staticKey(node, constants, checker);
      if (finiteKey !== undefined) {
        return constantOrigin(finiteKey, allocationProvenance(node, 'computed finite primitive'));
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

  const argsFor = (node, overrides, depth) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const substitutions = ts.isTemplateExpression(node.template)
        ? node.template.templateSpans.map((span) => evaluate(span.expression, overrides, depth + 1))
        : [];
      const taggedArguments = [origin(ORIGIN.BORROWED, 'frozen template strings argument'), ...substitutions];
      taggedArguments.sequenceComplete = true;
      return taggedArguments;
    }
    const values = [];
    let sequenceComplete = true;
    for (const argument of node.arguments ?? []) {
      if (ts.isSpreadElement(argument)) {
        const spread = evaluate(argument.expression, overrides, depth + 1);
        const expanded = positionalSequence(spread, 'spread call argument');
        sequenceComplete &&= expanded.complete;
        values.push(...expanded.values);
      } else {
        values.push(evaluate(argument, overrides, depth + 1));
      }
    }
    values.sequenceComplete = sequenceComplete;
    return values;
  };

  const escapeOwned = (value, provenance, seen = new Set()) => {
    if (seen.has(value)) return;
    seen.add(value);
    const sequenceChildren = value.sequence ?? [];
    if (value.sequenceComplete || value.sequence !== undefined) {
      value.sequenceComplete = false;
      value.sequence = undefined;
      value.provenance.add(`${provenance}: positional sequence escaped`);
    }
    if (value.tags.has(ORIGIN.OWNED)) {
      value.tags.delete(ORIGIN.OWNED);
      value.tags.add(ORIGIN.ESCAPED);
      value.surfaces.add(SURFACE.UNKNOWN);
      value.provenance.add(provenance);
    }
    if (value.content !== undefined) escapeOwned(value.content, provenance, seen);
    for (const child of sequenceChildren) escapeOwned(child, provenance, seen);
    for (const child of value.shape.values()) escapeOwned(child, provenance, seen);
  };

  const invalidateSequence = (value, provenance) => {
    if (!value.sequenceComplete && value.sequence === undefined) return;
    value.sequenceComplete = false;
    value.sequence = undefined;
    value.provenance.add(`${provenance}: positional sequence invalidated by mutation`);
  };

  const mergeContent = (receiver, value, provenance) => {
    receiver.content = receiver.content === undefined ? value : joinOrigins(receiver.content, value);
    receiver.provenance.add(provenance);
  };

  const mergeShapeValue = (receiver, key, value) => {
    const normalized = descriptorPropertyKey(key);
    receiver.shape.set(normalized, receiver.shape.has(normalized)
      ? joinOrigins(receiver.shape.get(normalized), value)
      : value);
  };

  const finiteKeysFromOrigin = (value) => new Set([...(value?.constants ?? [])]
    .filter((key) => key !== '<undefined>' && (typeof key === 'string' || typeof key === 'number')));

  const hasDefinitelyPresentOwnDataKey = (value, key) => {
    const normalized = descriptorPropertyKey(key);
    return (value.initialDataKeys.has(normalized) || value.definedDataKeys.has(normalized))
      && !value.invalidatedDataKeys.has(normalized);
  };

  const hasInitialOwnDataKey = (value, key) => value.initialDataKeys
    .has(descriptorPropertyKey(key));

  const initialOrdinarySetDispatchSafe = (value, keys, keysComplete = keys?.size > 0) => {
    if (!isProvenMutableLocal(value)) return false;
    if (value.mayBeNonExtensible) return false;
    if (value.tags.has(ORIGIN.UI_CELL)) return true;
    if (keys === undefined || keys.size === 0) {
      return value.nullPrototype && value.accessorKeys.size === 0;
    }
    if ([...keys].some((key) => value.accessorKeys.has(descriptorPropertyKey(key))
      || value.nonWritableKeys.has(descriptorPropertyKey(key)))) return false;
    if (!keysComplete && (value.accessorKeys.size > 0 || value.nonWritableKeys.size > 0)) return false;
    if (value.nullPrototype) return true;
    if (!keysComplete || keys.has('__proto__')) return false;
    return value.intrinsicPrototype || [...keys].every((key) => hasInitialOwnDataKey(value, key));
  };

  const ordinarySetDispatchSafe = (value, keys, keysComplete = keys?.size > 0) => {
    if (!isProvenMutableLocal(value)) return false;
    if (value.mayBeNonExtensible) return false;
    if (value.tags.has(ORIGIN.UI_CELL)) return true;
    if (keys === undefined || keys.size === 0) {
      return value.nullPrototype && value.accessorKeys.size === 0;
    }
    if ([...keys].some((key) => value.accessorKeys.has(descriptorPropertyKey(key))
      || value.nonWritableKeys.has(descriptorPropertyKey(key)))) return false;
    if (!keysComplete && (value.accessorKeys.size > 0 || value.nonWritableKeys.size > 0)) return false;
    if (value.nullPrototype) return true;
    if (!keysComplete || keys === undefined || keys.size === 0 || keys.has('__proto__')) return false;
    return value.intrinsicPrototype
      || [...keys].every((key) => hasDefinitelyPresentOwnDataKey(value, key));
  };

  const mutationKeyDomainForWrite = (write) => write.keyNode !== undefined
    && ts.isPrivateIdentifier(write.keyNode)
    ? { complete: true, keys: new Set([classMemberShapeKey(write.keyNode)]) }
    : write.literalKey !== undefined
      ? { complete: true, keys: new Set([write.literalKey]) }
      : write.keyNode === undefined
        ? { complete: false, keys: new Set() }
        : staticKeyDomain(write.keyNode, constants, checker);

  const mutationKeysForWrite = (write) => mutationKeyDomainForWrite(write).keys;

  const directMutationKeys = (api, callNode) => {
    if (!ts.isCallExpression(callNode) && !ts.isNewExpression(callNode)) return new Set();
    const calleePath = actualStaticPath(callNode.expression, constants, checker);
    return calleePath === api && callNode.arguments?.[1] !== undefined
      ? staticKeys(callNode.arguments[1], constants, checker)
      : new Set();
  };

  const dominatingDataDefinition = (callNode, targetNode, keys) => {
    if (keys.size === 0) return false;
    const owner = nearestContainingFunction(callNode);
    const targetText = unwrapExpression(targetNode)?.getText();
    return ir.calls.some((candidate) => {
      if (candidate.node.pos >= callNode.pos || nearestContainingFunction(candidate.node) !== owner
        || isPotentiallySkipped(candidate.node, checker) || !ts.isCallExpression(candidate.node)) return false;
      const path = actualStaticPath(candidate.node.expression, constants, checker);
      if (!['Object.defineProperty', 'Reflect.defineProperty'].includes(path ?? '')) return false;
      const candidateTarget = candidate.node.arguments[0] === undefined
        ? undefined
        : unwrapExpression(candidate.node.arguments[0])?.getText();
      if (candidateTarget !== targetText || candidate.node.arguments[1] === undefined) return false;
      const candidateKeys = staticKeys(candidate.node.arguments[1], constants, checker);
      if (![...keys].every((key) => candidateKeys.has(key))) return false;
      const descriptor = candidate.node.arguments[2];
      return descriptor !== undefined && ts.isObjectLiteralExpression(unwrapExpression(descriptor))
        && !unwrapExpression(descriptor).properties.some((property) =>
          (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)
            || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property))
          && ['get', 'set'].includes(property.name?.getText?.() ?? ''));
    });
  };

  const hasCanonicalOwnedLiteralEvidence = (value) => isProvenMutableLocal(value)
    && value.intrinsicPrototype
    && value.shapeKeysComplete
    && value.assignSourceEvidenceComplete
    && value.assignSourceEvidence.size > 0
    && [...value.assignSourceEvidence.values()].every((evidence) =>
      evidence.directOwnedLiteral && evidence.getterFree && evidence.keysComplete);

  const canonicalDescriptorIsDataOnly = (descriptor) =>
    hasCanonicalOwnedLiteralEvidence(descriptor)
    && descriptor.ordinaryData
    && descriptor.accessorKeys.size === 0
    && descriptor.hiddenKeys.size === 0
    && [...descriptor.shape.keys()].every((key) =>
      !['get', 'set', '__proto__'].includes(String(key)));

  const canonicalDescriptorMapIsDataOnly = (descriptorMap) =>
    hasCanonicalOwnedLiteralEvidence(descriptorMap)
    && descriptorMap.ordinaryData
    && descriptorMap.accessorKeys.size === 0
    && descriptorMap.hiddenKeys.size === 0
    && [...descriptorMap.shape.values()].every(canonicalDescriptorIsDataOnly);

  const mutationRecord = (api, argumentsList, callNode, label) => {
    const target = argumentsList[0] ?? origin(ORIGIN.UNKNOWN, `missing ${api} target`);
    const receiver = api === 'Reflect.set' && argumentsList.length >= 4
      ? argumentsList[3]
      : target;
    const keyOrigin = argumentsList[1]
      ?? origin(ORIGIN.UNKNOWN, `missing ${api} property key`);
    const keys = api === 'Object.defineProperties'
      ? new Set([...keyOrigin.shape.keys()].filter((key) => !keyOrigin.hiddenKeys.has(key)))
      : new Set([
        ...finiteKeysFromOrigin(keyOrigin),
        ...directMutationKeys(api, callNode),
      ]);
    const keysComplete = api === 'Object.defineProperties'
      ? keyOrigin.shapeKeysComplete
      : keyOrigin.finiteKeysComplete && keys.size > 0;
    const descriptorDataOnly = api === 'Object.defineProperties'
      ? canonicalDescriptorMapIsDataOnly(argumentsList[1]
        ?? origin(ORIGIN.UNKNOWN, 'missing Object.defineProperties descriptor map'))
      : ['Object.defineProperty', 'Reflect.defineProperty'].includes(api)
        ? canonicalDescriptorIsDataOnly(argumentsList[2]
          ?? origin(ORIGIN.UNKNOWN, `missing ${api} descriptor`))
        : undefined;
    const operationDispatchSafe = (candidateTarget, candidateKeys, complete) => {
      const currentSafe = ordinarySetDispatchSafe(candidateTarget, candidateKeys, complete);
      if (!currentSafe) return false;
      return initialOrdinarySetDispatchSafe(candidateTarget, candidateKeys, complete)
        || (argumentsList[0] !== undefined
          && dominatingDataDefinition(callNode, callNode.arguments?.[0], candidateKeys));
    };
    const objectAssignDispatchSafe = api !== 'Object.assign'
      || argumentsList.slice(1).every((source) => {
        if (!source.shapeKeysComplete || !source.ordinaryData) return false;
        const sourceKeys = new Set([...source.shape.keys()]
          .filter((key) => !source.hiddenKeys.has(key)));
        return sourceKeys.size === 0 || operationDispatchSafe(target, sourceKeys, true);
      });
    const assignSourceArguments = api === 'Object.assign' ? argumentsList.slice(1) : [];
    const assignSources = assignSourceArguments.flatMap((source, sourceIndex) => {
      const keys = new Set([...source.shape.keys()]
        .filter((key) => !source.hiddenKeys.has(key)));
      const common = {
        sourceIndex,
        origin: source,
        keys,
      };
      if (!source.assignSourceEvidenceComplete || source.assignSourceEvidence.size === 0) {
        return [{
          ...common,
          node: callNode,
          keysComplete: false,
          getterFree: false,
          directOwnedLiteral: false,
        }];
      }
      return [...source.assignSourceEvidence.values()].map((evidence) => ({
        ...common,
        node: evidence.node ?? callNode,
        keysComplete: source.shapeKeysComplete && evidence.keysComplete,
        getterFree: evidence.getterFree && source.ordinaryData && source.accessorKeys.size === 0,
        directOwnedLiteral: evidence.directOwnedLiteral && isProvenMutableLocal(source),
      }));
    });
    return {
      receiver: receiver ?? origin(ORIGIN.UNKNOWN, `missing ${api} effective receiver`),
      target,
      keys,
      keysComplete,
      dispatchSafe: api === 'Reflect.set'
        ? operationDispatchSafe(target, keys, keysComplete)
        : objectAssignDispatchSafe,
      label,
      api,
      argumentsList,
      site: callNode,
      assignSourceCount: assignSourceArguments.length,
      assignSourcesComplete: api !== 'Object.assign'
        || (argumentsList.sequenceComplete !== false
          && assignSourceArguments.every((source) => source.assignSourceEvidenceComplete
            && source.assignSourceEvidence.size > 0)),
      assignSources,
      descriptorDataOnly,
      potentiallySkipped: isPotentiallySkipped(callNode, checker),
    };
  };

  const applyObjectMutationTransfer = (api, mutation, argumentsList) => {
    const { receiver } = mutation;
    invalidateSequence(receiver, api);
    const descriptorIsDefinitelyWritable = (descriptor) => {
      const writable = descriptor.shape.get('writable');
      return writable !== undefined && writable.tags.size === 1
        && writable.tags.has(ORIGIN.CONSTANT) && writable.constants.size === 1
        && writable.constants.has(true);
    };
    const descriptorEnumerability = (descriptor) => {
      const enumerable = descriptor.shape.get('enumerable');
      if (enumerable === undefined) return 'omitted';
      if (enumerable.tags.size === 1 && enumerable.tags.has(ORIGIN.CONSTANT)
        && enumerable.constants.size === 1) {
        if (enumerable.constants.has(true)) return 'true';
        if (enumerable.constants.has(false)) return 'false';
      }
      return 'unknown';
    };
    const transferDescriptorEnumerability = (key, descriptor) => {
      const normalized = descriptorPropertyKey(key);
      const state = descriptorEnumerability(descriptor);
      if (state === 'false' || state === 'unknown') {
        receiver.nonEnumerableKeys.add(normalized);
        for (const allocation of receiver.allocations) {
          const keys = allocationNonEnumerableKeys.get(allocation) ?? new Set();
          keys.add(normalized);
          allocationNonEnumerableKeys.set(allocation, keys);
        }
        return;
      }
      if (state === 'omitted' && !hasDefinitelyPresentOwnDataKey(receiver, normalized)) {
        // A newly created property defaults to enumerable:false. When prior
        // presence is not a must-fact, the absent alternative therefore
        // contributes a possible non-enumerable state.
        receiver.nonEnumerableKeys.add(normalized);
        for (const allocation of receiver.allocations) {
          const keys = allocationNonEnumerableKeys.get(allocation) ?? new Set();
          keys.add(normalized);
          allocationNonEnumerableKeys.set(allocation, keys);
        }
      }
      // `true` leaves the may-set clear for a fresh key. We deliberately do
      // not remove a prior non-enumerable alternative: configurability or a
      // skipped/failed redefinition would otherwise be allowed to launder it.
    };
    if (api === 'Object.assign') {
      for (const source of argumentsList.slice(1)) {
        for (const [key, value] of source.shape) mergeShapeValue(receiver, key, value);
        if (source.content !== undefined) {
          mergeContent(receiver, source.content, 'Object.assign source transfer');
        } else if ([ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN]
          .some((tag) => source.tags.has(tag))) {
          mergeContent(receiver, source, 'Object.assign unresolved source transfer');
        }
      }
      return;
    }
    if (api === 'Reflect.set') {
      const value = argumentsList[2] ?? origin(ORIGIN.UNKNOWN, 'missing Reflect.set value');
      for (const key of mutation.keys) mergeShapeValue(receiver, key, value);
      mergeContent(receiver, value, 'Reflect.set value transfer');
      return;
    }
    if (api === 'Reflect.deleteProperty') {
      const invalidated = mutation.keysComplete && mutation.keys.size > 0
        ? mutation.keys
        : new Set([...receiver.initialDataKeys, ...receiver.definedDataKeys]);
      for (const key of invalidated) {
        const normalized = descriptorPropertyKey(key);
        receiver.definedDataKeys.delete(normalized);
        receiver.accessorKeys.delete(normalized);
        receiver.nonWritableKeys.delete(normalized);
        receiver.nonEnumerableKeys.delete(normalized);
        receiver.invalidatedDataKeys.add(normalized);
        receiver.shape.delete(normalized);
      }
      return;
    }
    if (api === 'Object.defineProperty' || api === 'Reflect.defineProperty') {
      const descriptor = argumentsList[2] ?? origin(ORIGIN.UNKNOWN, `missing ${api} descriptor`);
      const value = descriptor.shape.get('value') ?? descriptor.content
        ?? origin(ORIGIN.UNKNOWN, `${api} descriptor value is unresolved`);
      const dataOnly = descriptor.ordinaryData
        && !descriptor.shape.has('get') && !descriptor.shape.has('set');
      for (const key of mutation.keys) {
        transferDescriptorEnumerability(key, descriptor);
        mergeShapeValue(receiver, key, value);
        if (dataOnly) {
          const normalized = descriptorPropertyKey(key);
          const preservesExistingData = mutation.potentiallySkipped
            && hasDefinitelyPresentOwnDataKey(receiver, normalized)
            && !receiver.accessorKeys.has(normalized)
            && !receiver.nonWritableKeys.has(normalized)
            && descriptorIsDefinitelyWritable(descriptor);
          if (!mutation.potentiallySkipped && !receiver.mayBeNonExtensible
            && descriptorIsDefinitelyWritable(descriptor)) {
            receiver.definedDataKeys.add(normalized);
            receiver.invalidatedDataKeys.delete(normalized);
            receiver.accessorKeys.delete(normalized);
            receiver.nonWritableKeys.delete(normalized);
          } else if (preservesExistingData) {
            // Either branch leaves a definitely-present writable own data
            // property: the call installs one, or the skipped path retains
            // the already-proven property. Descriptor enumerability is a
            // separate may-fact and has already been joined above.
            receiver.invalidatedDataKeys.delete(normalized);
          } else {
            receiver.definedDataKeys.delete(normalized);
            receiver.invalidatedDataKeys.add(normalized);
            receiver.nonWritableKeys.add(normalized);
          }
        } else {
          const normalized = descriptorPropertyKey(key);
          receiver.definedDataKeys.delete(normalized);
          receiver.accessorKeys.delete(normalized);
          receiver.nonWritableKeys.delete(normalized);
          receiver.invalidatedDataKeys.add(normalized);
          receiver.accessorKeys.add(normalized);
        }
      }
      mergeContent(receiver, value, `${api} descriptor transfer`);
      return;
    }
    if (api === 'Object.defineProperties') {
      const descriptors = argumentsList[1]
        ?? origin(ORIGIN.UNKNOWN, 'missing Object.defineProperties descriptor map');
      for (const [key, descriptor] of descriptors.shape) {
        transferDescriptorEnumerability(key, descriptor);
        const value = descriptor.shape.get('value') ?? descriptor.content
          ?? origin(ORIGIN.UNKNOWN, `Object.defineProperties descriptor ${key} is unresolved`);
        mergeShapeValue(receiver, key, value);
        const normalized = descriptorPropertyKey(key);
        const preservesExistingData = mutation.potentiallySkipped
          && hasDefinitelyPresentOwnDataKey(receiver, normalized)
          && !receiver.accessorKeys.has(normalized)
          && !receiver.nonWritableKeys.has(normalized)
          && descriptor.ordinaryData
          && descriptorIsDefinitelyWritable(descriptor)
          && !descriptor.shape.has('get') && !descriptor.shape.has('set');
        if (descriptor.ordinaryData && descriptorIsDefinitelyWritable(descriptor)
          && !mutation.potentiallySkipped
          && !receiver.mayBeNonExtensible
          && !descriptor.shape.has('get') && !descriptor.shape.has('set')) {
          receiver.definedDataKeys.add(normalized);
          receiver.invalidatedDataKeys.delete(normalized);
          receiver.accessorKeys.delete(normalized);
          receiver.nonWritableKeys.delete(normalized);
        } else if (preservesExistingData) {
          receiver.invalidatedDataKeys.delete(normalized);
        } else {
          receiver.definedDataKeys.delete(normalized);
          receiver.invalidatedDataKeys.add(normalized);
          if (descriptor.ordinaryData && !descriptor.shape.has('get')
            && !descriptor.shape.has('set')) {
            receiver.nonWritableKeys.add(normalized);
          } else {
            receiver.nonWritableKeys.delete(normalized);
            receiver.accessorKeys.add(normalized);
          }
        }
        mergeContent(receiver, value, 'Object.defineProperties descriptor transfer');
      }
    }
  };

  const positionalSequence = (value, provenance) => {
    if (value.sequenceComplete && value.sequence !== undefined) {
      return { complete: true, values: [...value.sequence] };
    }
    return {
      complete: false,
      values: [origin(ORIGIN.UNKNOWN, provenance + ' has unresolved positional length or indices')],
    };
  };

  resolveCall = (node, overrides = new Map(), depth = 0) => {
    const calleeNode = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
    const callee = evaluate(calleeNode, overrides, depth + 1);
    const argumentsList = argsFor(node, overrides, depth);
    const outcomes = [];
    const effects = new Set();
    const mutationReceivers = [];
    let known = callee.callables.length > 0;
    const descriptions = [];
    if (argumentsList.sequenceComplete === false) {
      known = false;
      effects.add('HOST_UNKNOWN');
      descriptions.push('call arguments have unresolved positional length or indices');
    }
    const evaluateDirectFunction = (entry, invocationArguments) => {
      const declaration = functions.get(entry.id);
      if (declaration !== undefined && nearestContainingFunction(node) === declaration) {
        return collectReturns(declaration).length === 0
          ? constantOrigin(undefined, `recursive void summary ${entry.name}`)
          : origin(ORIGIN.UNKNOWN, `recursive value summary ${entry.name}`);
      }
      const nestedMutationReceivers = [];
      const result = evaluateFunction(entry, invocationArguments, depth + 1, nestedMutationReceivers);
      mutationReceivers.push(...nestedMutationReceivers.map((mutation) => ({
        ...mutation,
        label: `nested mutation in ${entry.name}: ${mutation.label}`,
      })));
      return result;
    };
    const functionWithThis = (target, thisOrigin) => target.kind !== 'function'
      ? target
      : {
        ...target,
        closure: new Map([...(target.closure ?? []), [THIS_ORIGIN, thisOrigin]]),
      };
    const evaluateDeferredCallable = (target, invocationArguments) => {
      if (target.kind === 'function') return evaluateDirectFunction(target, invocationArguments);
      if (target.kind === 'bound') {
        const results = target.targets.map((nested) => evaluateDeferredCallable(
          functionWithThis(
            nested,
            target.boundThis ?? constantOrigin(undefined, 'undefined bound this'),
          ),
          [...target.boundArguments, ...invocationArguments],
        ));
        return results.length === 0
          ? origin(ORIGIN.UNKNOWN, 'bound deferred callable has no targets')
          : joinOrigins(...results);
      }
      if (target.kind === 'ui') return constantOrigin(undefined, `UI deferred callback ${target.name}`);
      return origin(ORIGIN.UNKNOWN, `unsupported deferred callable ${target.kind}:${target.name ?? ''}`);
    };
    let invokeDirect;
    invokeDirect = (target, invocationArguments) => {
      if (target.kind === 'function') {
        outcomes.push(evaluateDirectFunction(target, invocationArguments));
        return;
      }
      if (target.kind === 'bound') {
        for (const nested of target.targets) {
          invokeDirect(
            functionWithThis(nested, target.boundThis ?? constantOrigin(undefined, 'undefined bound this')),
            [...target.boundArguments, ...invocationArguments],
          );
        }
        return;
      }
      if (target.kind === 'builtin') {
        if (objectMutationCalls.has(target.name)) {
          effects.add(objectMutationCalls.get(target.name));
          const mutation = mutationRecord(target.name, invocationArguments, node, `${target.name} target`);
          applyObjectMutationTransfer(target.name, mutation, invocationArguments);
          mutationReceivers.push(mutation);
          outcomes.push(target.name === 'Object.assign'
            ? invocationArguments[0] ?? origin(ORIGIN.UNKNOWN, 'missing Object.assign target')
            : constantOrigin(target.name.startsWith('Reflect.') ? true : undefined, `${target.name} result`));
          return;
        }
        if (forbiddenCapabilityEffects.has(target.name)) {
          effects.add(forbiddenCapabilityEffects.get(target.name));
          outcomes.push(origin(ORIGIN.AMBIENT, `forbidden capability result ${target.name}`));
          return;
        }
        if (browserFacadeCalls.has(target.name)) {
          if (['window.setInterval', 'globalThis.setInterval', 'setInterval'].includes(target.name)) {
            const callback = invocationArguments[0];
            if (!callableArgumentIsResolved(callback)) {
              effects.add('HOST_UNKNOWN');
              if (callback !== undefined) escapeOwned(callback, 'escaped through unresolved timer callback');
            } else {
              const callbackArguments = invocationArguments.slice(2);
              recordDeferredInvocation(node, callback, callbackArguments, 'timer');
              callback.callables.forEach((callable) => {
                evaluateDeferredCallable(callable, callbackArguments);
              });
            }
          }
          effects.add(browserFacadeCalls.get(target.name));
          outcomes.push(origin(ORIGIN.BORROWED, `meta-call browser result ${target.name}`));
          return;
        }
      }
      if (target.kind === 'ambient') {
        const forbiddenEffect = forbiddenCapabilityEffects.get(target.name);
        const facadeEffect = browserFacadeCalls.get(target.name);
        effects.add(forbiddenEffect ?? facadeEffect ?? 'HOST_UNKNOWN');
        outcomes.push(facadeEffect !== undefined
          && !target.name.includes('matchMedia') && target.name !== 'document.getElementById'
          ? constantOrigin(undefined, `void browser operation ${target.name}`)
          : origin(ORIGIN.AMBIENT, `result of ambient meta-call ${target.name}`));
        return;
      }
      if (target.kind === 'ui') {
        effects.add('HOST_UI_STATE');
        outcomes.push(constantOrigin(undefined, `UI callback ${target.name}`));
        return;
      }
      effects.add('HOST_UNKNOWN');
      invocationArguments.forEach((value) => escapeOwned(value, `escaped through unresolved meta-call ${target.name ?? target.kind}`));
      outcomes.push(origin(ORIGIN.UNKNOWN, `unresolved meta-call target ${target.name ?? target.kind}`));
    };

    for (const entry of callee.callables) {
      descriptions.push(`${entry.kind}:${entry.name ?? entry.id}`);
      if (entry.kind === 'meta') {
        const targets = entry.receiver.callables;
        const directlyAnalyzed = targets.length > 0 && targets.every((target) =>
          ['bound', 'builtin', 'function', 'react', 'ui', 'zod'].includes(target.kind));
        if (!directlyAnalyzed) {
          effects.add('HOST_UNKNOWN');
          argumentsList.forEach((value) => escapeOwned(value, `escaped through unresolved ${entry.name}`));
          outcomes.push(origin(ORIGIN.UNKNOWN, `unresolved ${entry.name} target`));
        } else if (entry.name === 'bind') {
          outcomes.push(withCallable({
            kind: 'bound',
            name: 'bound callable',
            targets,
            boundArguments: argumentsList.slice(1),
            boundThis: argumentsList[0] ?? constantOrigin(undefined, 'undefined bound this'),
          }, 'directly analyzed bound callable'));
        } else {
          const applied = entry.name === 'apply'
            ? positionalSequence(
              argumentsList[1] ?? origin(ORIGIN.UNKNOWN, 'missing apply arguments'),
              'Function.apply argument container',
            )
            : undefined;
          if (applied?.complete === false) {
            known = false;
            effects.add('HOST_UNKNOWN');
            descriptions.push('Function.apply argument container has unresolved positional length or indices');
          }
          const invoked = entry.name === 'call'
            ? argumentsList.slice(1)
            : applied.values;
          const thisOrigin = argumentsList[0] ?? constantOrigin(undefined, `undefined ${entry.name} this`);
          targets.forEach((target) => invokeDirect(functionWithThis(target, thisOrigin), invoked));
        }
        continue;
      }
      if (entry.kind === 'bound') {
        entry.targets.forEach((target) => invokeDirect(
          functionWithThis(target, entry.boundThis ?? constantOrigin(undefined, 'undefined bound this')),
          [...entry.boundArguments, ...argumentsList],
        ));
        continue;
      }
      if (entry.kind === 'local-class') {
        outcomes.push(instantiateClass(entry, argumentsList, node, depth + 1));
        continue;
      }
      if (entry.kind === 'function') {
        const result = evaluateDirectFunction(entry, argumentsList);
        outcomes.push(result);
        continue;
      }
      if (entry.kind === 'react') {
        const summary = reactCallSummaries.get(entry.name);
        if (summary === 'REACT_USE_STATE' || summary === 'REACT_USE_REDUCER') {
          if (summary === 'REACT_USE_STATE' && node.arguments?.[0] !== undefined
            && callableArgumentRequiresResolution(node.arguments[0], argumentsList[0], checker)
            && !callableArgumentIsResolved(argumentsList[0])) {
            effects.add('HOST_UNKNOWN');
            escapeOwned(argumentsList[0], 'escaped through unresolved React state initializer');
          }
          if (summary === 'REACT_USE_REDUCER' && !callableArgumentIsResolved(argumentsList[0])) {
            effects.add('HOST_UNKNOWN');
            argumentsList.forEach((value) => escapeOwned(value, 'escaped through unresolved React reducer'));
          }
          if (summary === 'REACT_USE_REDUCER' && node.arguments?.[2] !== undefined
            && !callableArgumentIsResolved(argumentsList[2])) {
            effects.add('HOST_UNKNOWN');
            escapeOwned(argumentsList[2], 'escaped through unresolved React reducer initializer');
          }
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
          if (callableArgumentIsResolved(callback)) {
            outcomes.push(joinOrigins(...callback.callables.map((item) => item.kind === 'function'
              ? evaluateFunction(item, [], depth + 1)
              : origin(ORIGIN.BORROWED, 'memo callback result'))));
          } else {
            effects.add('HOST_UNKNOWN');
            if (callback !== undefined) escapeOwned(callback, 'escaped through unresolved React memo callback');
            outcomes.push(origin(ORIGIN.UNKNOWN, 'unresolved memo callback result'));
          }
        } else if (summary === 'REACT_FORWARD_REF') {
          if (!callableArgumentIsResolved(argumentsList[0])) {
            effects.add('HOST_UNKNOWN');
            if (argumentsList[0] !== undefined) {
              escapeOwned(argumentsList[0], 'escaped through unresolved React forwardRef render');
            }
          }
          outcomes.push(callableArgumentIsResolved(argumentsList[0])
            ? argumentsList[0]
            : origin(ORIGIN.UNKNOWN, 'unresolved forwardRef render'));
        } else if (summary === 'REACT_USE_ID') {
          outcomes.push(constantOrigin(undefined, 'React generated id'));
        } else {
          if (summary === 'REACT_USE_EFFECT' && !callableArgumentIsResolved(argumentsList[0])) {
            effects.add('HOST_UNKNOWN');
            argumentsList.forEach((value) => escapeOwned(value, 'escaped through unresolved React effect registration'));
          } else if (summary === 'REACT_USE_EFFECT') {
            recordDeferredInvocation(node, argumentsList[0], [], 'react-effect');
            const cleanupResults = argumentsList[0].callables.map((item) =>
              evaluateDeferredCallable(item, []));
            const cleanup = joinOrigins(...cleanupResults);
            if ((cleanup.callables.length > 0 && !callableArgumentIsResolved(cleanup))
              || cleanup.tags.has(ORIGIN.UNKNOWN)) {
              effects.add('HOST_UNKNOWN');
              escapeOwned(cleanup, 'escaped through unresolved React effect cleanup');
            } else if (cleanup.callables.length > 0) {
              recordDeferredInvocation(node, cleanup, [], 'react-cleanup');
            }
          }
          effects.add('HOST_UI_STATE');
          outcomes.push(constantOrigin(undefined, 'React effect registration'));
        }
        continue;
      }
      if (entry.kind === 'ui') {
        if (entry.name === 'setState' && node.arguments?.[0] !== undefined
          && callableArgumentRequiresResolution(node.arguments[0], argumentsList[0], checker)
          && !callableArgumentIsResolved(argumentsList[0])) {
          effects.add('HOST_UNKNOWN');
          escapeOwned(argumentsList[0], 'escaped through unresolved React state updater');
        }
        effects.add('HOST_UI_STATE');
        outcomes.push(constantOrigin(undefined, `UI callback ${entry.name}`));
        continue;
      }
      if (entry.kind === 'zod') {
        if (['lazy', 'superRefine'].includes(entry.name)
          && !callableArgumentIsResolved(argumentsList[0])) {
          effects.add('HOST_UNKNOWN');
          argumentsList.forEach((value) => escapeOwned(value, `escaped through unresolved Zod ${entry.name} callback`));
        }
        if (entry.name === 'config') {
          const customError = argumentsList[0]?.shape.get('customError');
          if (customError !== undefined && !callableArgumentIsResolved(customError)) {
            effects.add('HOST_UNKNOWN');
            escapeOwned(customError, 'escaped through unresolved Zod global error callback');
          }
        }
        outcomes.push(entry.name === 'parse' || entry.name === 'safeParse'
          ? origin(ORIGIN.BORROWED, `validated result from Zod ${entry.name}`)
          : entry.name === 'addIssue'
            ? constantOrigin(undefined, 'Zod refinement issue registration')
            : withBrand(ORIGIN.ZOD, `Zod method result ${entry.name}`));
        continue;
      }
      if (entry.kind === 'domain-validator') {
        outcomes.push(origin(ORIGIN.BORROWED, 'validated local capability contract result'));
        continue;
      }
      if (entry.kind === 'opaque-method' && entry.name === 'render') {
        effects.add('HOST_DOM_MOUNT');
        outcomes.push(constantOrigin(undefined, 'opaque React render'));
        continue;
      }
      if (entry.kind === 'ambient') {
        const ambientName = entry.name;
        if (ambientName === 'addEventListener' && !callableArgumentIsResolved(argumentsList[1])) {
          effects.add('HOST_UNKNOWN');
          argumentsList.forEach((value) => escapeOwned(value, 'escaped through unresolved host event listener'));
        } else if (ambientName === 'addEventListener') {
          const callback = argumentsList[1];
          recordDeferredInvocation(node, callback, [hostEventCallbackInput], 'event-listener');
          for (const callable of callback.callables) {
            evaluateDeferredCallable(callable, [hostEventCallbackInput]);
          }
        }
        const facadeEffect = browserFacadeCalls.get(ambientName);
        const effect = uiMethods.has(ambientName)
          ? 'HOST_UI_STATE'
          : facadeEffect
          ?? forbiddenCapabilityEffects.get(ambientName)
          ?? (ambientName === 'submit' || ambientName === 'requestSubmit' ? 'HOST_FORM_SUBMIT' : 'HOST_UNKNOWN');
        effects.add(effect);
        outcomes.push(uiMethods.has(ambientName)
          ? constantOrigin(undefined, `UI event method ${ambientName}`)
          : facadeEffect !== undefined
          && !ambientName.includes('matchMedia') && ambientName !== 'document.getElementById'
            ? constantOrigin(undefined, `void browser operation ${ambientName}`)
            : origin(ORIGIN.AMBIENT, `result of ambient call ${ambientName}`));
        continue;
      }
      if (entry.kind === 'method') {
        const element = entry.receiver.content ?? origin(ORIGIN.BORROWED, `${entry.name} receiver element`);
        let callbackResult;
        if (higherOrderMethods.has(entry.name)
          && !(entry.name === 'sort' && argumentsList[0] === undefined)) {
          const callback = argumentsList[0];
          if (!callableArgumentIsResolved(callback)) {
            effects.add('HOST_UNKNOWN');
            callbackResult = origin(ORIGIN.UNKNOWN, `unresolved ${entry.name} callback result`);
          } else {
            const callbackArguments = ['reduce', 'reduceRight'].includes(entry.name)
              ? [argumentsList[1] ?? element, element, constantOrigin(0, `${entry.name} index`), entry.receiver]
              : [element, constantOrigin(0, `${entry.name} index`), entry.receiver];
            const results = callback.callables.map((item) => item.kind === 'function'
              ? evaluateFunction(item, callbackArguments, depth + 1)
              : origin(ORIGIN.BORROWED, `${entry.name} summarized callback result`));
            callbackResult = joinOrigins(...results);
          }
        }
        if (['replace', 'replaceAll'].includes(entry.name) && node.arguments?.[1] !== undefined
          && callableArgumentRequiresResolution(node.arguments[1], argumentsList[1], checker)
          && !callableArgumentIsResolved(argumentsList[1])) {
          effects.add('HOST_UNKNOWN');
          escapeOwned(argumentsList[1], `escaped through unresolved ${entry.name} callback`);
        }
        if (mutatingMethodEffects.has(entry.name)) {
          effects.add(mutatingMethodEffects.get(entry.name));
          invalidateSequence(entry.receiver, `.${entry.name}()`);
          mutationReceivers.push({ receiver: entry.receiver, label: `.${entry.name}()`, api: `method:${entry.name}`, argumentsList });
          const inserted = entry.name === 'set'
            ? argumentsList[1]
            : entry.name === 'add'
              ? argumentsList[0]
              : ['push', 'unshift'].includes(entry.name)
                ? joinOrigins(...argumentsList)
                : entry.name === 'splice'
                  ? joinOrigins(...argumentsList.slice(2))
                  : entry.name === 'fill'
                    ? argumentsList[0]
                    : undefined;
          if (inserted !== undefined) mergeContent(entry.receiver, inserted, `content update through .${entry.name}()`);
          outcomes.push(['pop', 'shift'].includes(entry.name)
            ? element
            : entry.receiver);
        } else if (uiMethods.has(entry.name)) {
          effects.add('HOST_UI_STATE');
          outcomes.push(constantOrigin(undefined, `UI method ${entry.name}`));
        } else if (entry.name === 'map') {
          outcomes.push(freshOwned(node, allocationProvenance(node, 'map result'), {
            content: callbackResult ?? origin(ORIGIN.UNKNOWN, 'missing map callback result'),
          }));
        } else if (entry.name === 'flatMap') {
          const mapped = callbackResult ?? origin(ORIGIN.UNKNOWN, 'missing flatMap callback result');
          outcomes.push(freshOwned(node, allocationProvenance(node, 'flatMap result'), {
            content: mapped.content ?? mapped,
          }));
        } else if (entry.name === 'concat') {
          const concatenated = argumentsList.map((value) => value.content ?? value);
          outcomes.push(freshOwned(node, allocationProvenance(node, 'concat result'), {
            content: joinOrigins(element, ...concatenated),
          }));
        } else if (entry.name === 'flat') {
          outcomes.push(freshOwned(node, allocationProvenance(node, 'flat result'), {
            content: element.content ?? element,
          }));
        } else if (entry.name === 'reduce' || entry.name === 'reduceRight') {
          outcomes.push(joinOrigins(
            argumentsList[1] ?? element,
            callbackResult ?? origin(ORIGIN.UNKNOWN, `missing ${entry.name} callback result`),
          ));
        } else if (ownedResultMethods.has(entry.name) || ['entries', 'keys', 'values'].includes(entry.name)) {
          outcomes.push(freshOwned(node, allocationProvenance(node, `${entry.name} result`), {
            content: element,
          }));
        } else if (entry.name === 'at' || entry.name === 'find' || entry.name === 'get') {
          const elementResult = entry.receiver.content
            ?? origin(ORIGIN.BOTTOM, `empty ${entry.name} result`);
          outcomes.push(withAbsence(elementResult, `${entry.name} result may be absent`));
        } else {
          outcomes.push(origin(ORIGIN.BORROWED, `pure method result ${entry.name}`));
        }
        continue;
      }
      if (entry.kind === 'contract-object-assign' || entry.kind === 'contract-reflect-set') {
        effects.add('HOST_LOCAL_MUTATION');
        const api = entry.kind === 'contract-object-assign' ? 'Object.assign' : 'Reflect.set';
        const mutation = mutationRecord(api, argumentsList, node, `${entry.name} target`);
        applyObjectMutationTransfer(api, mutation, argumentsList);
        mutationReceivers.push(mutation);
        outcomes.push(entry.kind === 'contract-object-assign'
          ? argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing mutation target')
          : constantOrigin(true, 'Reflect.set result'));
        continue;
      }
      if (entry.kind === 'contract-reflect-get') {
        const target = argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing Reflect.get target');
        const keyNode = node.arguments?.[1];
        const keys = keyNode === undefined ? undefined : staticKeys(keyNode, constants, checker);
        if (keys === undefined || keys.size !== 1) {
          effects.add('HOST_UNKNOWN');
          outcomes.push(origin(ORIGIN.UNKNOWN, 'Reflect.get contract requires one finite key'));
          continue;
        }
        const [key] = keys;
        const targetNode = node.arguments?.[0];
        let declaredProjection;
        if (targetNode !== undefined) {
          try {
            const targetType = checker.getTypeAtLocation(targetNode);
            const property = checker.getPropertyOfType(targetType, String(key));
            if (property !== undefined) {
              const propertyType = checker.getTypeOfSymbolAtLocation(property, targetNode);
              declaredProjection = isDomLikeTsType(propertyType, checker)
                ? origin(ORIGIN.AMBIENT, `Reflect.get capability-bearing property ${String(key)}`)
                : (propertyType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0
                  ? origin(ORIGIN.UNKNOWN, `Reflect.get uncertain property ${String(key)}`)
                  : origin(ORIGIN.BORROWED, `Reflect.get declared property ${String(key)}`);
            }
          } catch {
            declaredProjection = origin(ORIGIN.UNKNOWN, `Reflect.get property ${String(key)} type resolution failed`);
          }
        }
        outcomes.push(target.shape.get(String(key))
          ?? target.content
          ?? (target.tags.has(ORIGIN.AMBIENT) || target.tags.has(ORIGIN.OPAQUE)
            ? target
            : declaredProjection
              ?? origin(ORIGIN.UNKNOWN, `Reflect.get unresolved property ${String(key)}`)));
        continue;
      }
      if (entry.kind === 'contract-method') {
        const brandedCapability = entry.receiver.tags.has(ORIGIN.LOCAL_CAPABILITY);
        const receiverHasAuthority = [ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED]
          .some((tag) => entry.receiver.tags.has(tag));
        const receiverBrandMatches = (entry.name === 'fetch' && entry.receiverLabel === 'client')
          || (entry.name === 'focus' && entry.receiverLabel === 'window')
          || (entry.name === 'getElementById' && entry.receiverLabel === 'document')
          || (entry.receiverLabel === 'CapabilityDefinition'
            && ['deriveResource', 'facts', 'reduce'].includes(entry.name));
        const returnIsScalarOrVoid = isPrimitiveLikeType(node, checker);
        const capabilityArgumentArities = new Map([
          ['deriveResource', 1],
          ['facts', 1],
          ['reduce', 2],
        ]);
        const capabilityArgumentsAreData = entry.receiverLabel === 'CapabilityDefinition'
          && argumentsList.length === capabilityArgumentArities.get(entry.name)
          && argumentsList.every((value) => {
            const facts = transitiveSecurityFacts(value);
            return facts.callableCount === 0
              && ![ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN, ORIGIN.UI_CELL]
                .some((tag) => facts.tags.has(tag))
              && ![SURFACE.CALLABLE, SURFACE.HOST, SURFACE.OPAQUE, SURFACE.UNKNOWN]
                .some((surface) => facts.surfaces.has(surface));
          });
        const receiverArgumentsAreExact = entry.receiverLabel === 'document'
          ? argumentsList.length === 1 && node.arguments?.length === 1
            && staticString(node.arguments[0], constants, checker) !== undefined
          : entry.receiverLabel === 'client' || entry.receiverLabel === 'window'
            ? argumentsList.length === 0
            : capabilityArgumentsAreData;
        const receiverAuthorityIsExact = entry.receiverLabel === 'CapabilityDefinition'
          ? brandedCapability
          : !brandedCapability;
        if ((pureLocalContractMethods.has(entry.name) || entry.receiverLabel === 'CapabilityDefinition')
          && receiverBrandMatches
          && receiverArgumentsAreExact
          && receiverAuthorityIsExact
          && !receiverHasAuthority && !entry.receiver.tags.has(ORIGIN.CALLABLE)
          && !entry.receiver.tags.has(ORIGIN.UNKNOWN)
          && (entry.receiverLabel === 'CapabilityDefinition' || returnIsScalarOrVoid)) {
          outcomes.push(origin(ORIGIN.BORROWED, `approved receiver-branded local method result ${entry.name}`, {
            surfaces: new Set([SURFACE.SCALAR]),
          }));
        } else {
          effects.add('HOST_UNKNOWN');
          descriptions.push(`contract-check:${entry.receiverLabel ?? 'unbranded'}:brand=${brandedCapability}:args=${receiverArgumentsAreExact}:authority=${receiverHasAuthority}:callable=${entry.receiver.tags.has(ORIGIN.CALLABLE)}:unknown=${entry.receiver.tags.has(ORIGIN.UNKNOWN)}`);
          argumentsList.forEach((value) => escapeOwned(value, `escaped through unresolved local method ${entry.name}`));
          outcomes.push(origin(ORIGIN.UNKNOWN, `unsummarized receiver-branded local method ${entry.name}`));
        }
        continue;
      }
      if (entry.kind === 'external-contract' || entry.kind === 'contract') {
        effects.add('HOST_UNKNOWN');
        argumentsList.forEach((value) => escapeOwned(value, `escaped through unresolved contract ${entry.name}`));
        outcomes.push(origin(ORIGIN.UNKNOWN, `unresolved external contract ${entry.name}`));
        continue;
      }
      if (entry.kind === 'constructor') {
        if (forbiddenConstructors.has(entry.name)) {
          effects.add(forbiddenConstructors.get(entry.name));
          outcomes.push(origin(ORIGIN.AMBIENT, `forbidden constructor ${entry.name}`));
        } else if (ownedConstructors.has(entry.name)) {
          const iterable = argumentsList[0];
          const collectionContent = ['Set', 'WeakSet'].includes(entry.name)
            ? iterable === undefined
              ? undefined
              : iterable.content ?? (iterable.shape.size === 0
                ? origin(ORIGIN.UNKNOWN, `unresolved ${entry.name} iterable content`)
                : joinOrigins(...iterable.shape.values()))
            : ['Map', 'WeakMap'].includes(entry.name) && iterable !== undefined
              ? (() => {
                const pairs = iterable.shape.size > 0
                  ? [...iterable.shape.values()]
                  : iterable.content === undefined ? [] : [iterable.content];
                if (pairs.length === 0) {
                  return origin(ORIGIN.UNKNOWN, `unresolved ${entry.name} entry content`);
                }
                return joinOrigins(...pairs.map((pair) => pair.shape.get('1')
                  ?? origin(ORIGIN.UNKNOWN, `unresolved ${entry.name} entry value`)));
              })()
              : argumentsList.length === 0 ? undefined : joinOrigins(...argumentsList);
          outcomes.push(freshOwned(node, allocationProvenance(node, `new ${entry.name}`), {
            content: collectionContent,
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
          const mutation = mutationRecord(name, argumentsList, node, `${name} target`);
          applyObjectMutationTransfer(name, mutation, argumentsList);
          mutationReceivers.push(mutation);
          outcomes.push(name === 'Object.assign'
            ? argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing Object.assign target')
            : constantOrigin(name.startsWith('Reflect.') ? true : undefined, `${name} result`));
        } else if (forbiddenCapabilityEffects.has(name)) {
          effects.add(forbiddenCapabilityEffects.get(name));
          outcomes.push(origin(ORIGIN.AMBIENT, `forbidden capability result ${name}`));
        } else if (browserFacadeCalls.has(name)) {
          if (['window.setInterval', 'globalThis.setInterval', 'setInterval'].includes(name)) {
            const callback = argumentsList[0];
            if (!callableArgumentIsResolved(callback)) {
              effects.add('HOST_UNKNOWN');
              if (callback !== undefined) escapeOwned(callback, 'escaped through unresolved timer callback');
            } else {
              const callbackArguments = argumentsList.slice(2);
              recordDeferredInvocation(node, callback, callbackArguments, 'timer');
              callback.callables.forEach((callable) => {
                evaluateDeferredCallable(callable, callbackArguments);
              });
            }
          }
          effects.add(browserFacadeCalls.get(name));
          outcomes.push(name === 'createRoot'
            ? origin(ORIGIN.OPAQUE, 'opaque React root')
            : name.includes('matchMedia') || name === 'document.getElementById'
              ? origin(ORIGIN.AMBIENT, `browser result ${name}`)
              : constantOrigin(undefined, `browser call ${name}`));
        } else if (name === 'Object.freeze') {
          const frozen = argumentsList[0] ?? origin(ORIGIN.UNKNOWN, 'missing Object.freeze value');
          frozen.mayBeNonExtensible = true;
          frozen.provenance.add('Object.freeze may make the allocation non-extensible');
          outcomes.push(frozen);
        } else if (name === 'Object.getOwnPropertyDescriptor') {
          outcomes.push(origin(ORIGIN.OPAQUE, 'opaque property descriptor'));
        } else if (name === 'Object.getOwnPropertyDescriptors') {
          outcomes.push(freshOwned(node, allocationProvenance(node, 'descriptor table'), {
            content: origin(ORIGIN.OPAQUE, 'opaque property descriptor'),
          }));
        } else if (name === 'Object.getPrototypeOf') {
          outcomes.push(origin(ORIGIN.OPAQUE, 'opaque prototype identity token'));
        } else if (ownedGlobalResults.has(name)) {
          if (name === 'Object.create' && node.arguments?.[0]?.kind !== ts.SyntaxKind.NullKeyword) {
            effects.add('HOST_UNKNOWN');
          }
          let ownedContent = argumentsList[0]?.content ?? argumentsList[0]
            ?? origin(ORIGIN.BORROWED, `${name} content`);
          if (name === 'Array.from' && node.arguments?.[1] !== undefined) {
            const callback = argumentsList[1];
            if (!callableArgumentIsResolved(callback)) {
              effects.add('HOST_UNKNOWN');
              escapeOwned(callback, 'escaped through unresolved Array.from callback');
              ownedContent = origin(ORIGIN.UNKNOWN, 'unresolved Array.from callback result');
            } else {
              const callbackResults = callback.callables.map((item) => item.kind === 'function'
                ? evaluateFunction(item, [ownedContent, constantOrigin(0, 'Array.from index')], depth + 1)
                : origin(ORIGIN.BORROWED, 'summarized Array.from callback result'));
              ownedContent = joinOrigins(...callbackResults);
            }
          }
          outcomes.push(freshOwned(node, allocationProvenance(node, `${name} result`), {
            content: ownedContent,
            nullPrototype: name === 'Object.create' && node.arguments?.[0]?.kind === ts.SyntaxKind.NullKeyword,
            ordinaryData: name === 'Object.create' && node.arguments?.[0]?.kind === ts.SyntaxKind.NullKeyword,
          }));
        } else if (pureGlobalCalls.has(name)) {
          if (name === 'Array.from' && node.arguments?.[1] !== undefined
            && !callableArgumentIsResolved(argumentsList[1])) {
            effects.add('HOST_UNKNOWN');
            escapeOwned(argumentsList[1], 'escaped through unresolved Array.from callback');
          }
          if (name === 'JSON.stringify' && node.arguments?.[1] !== undefined
            && callableArgumentRequiresResolution(node.arguments[1], argumentsList[1], checker)
            && !callableArgumentIsResolved(argumentsList[1])) {
            effects.add('HOST_UNKNOWN');
            escapeOwned(argumentsList[1], 'escaped through unresolved JSON.stringify replacer');
          }
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
    const resolution = {
      known,
      origin: joinOrigins(...outcomes),
      effects,
      mutationReceivers,
      description: descriptions.sort().join('|') || 'unresolved',
      callee,
    };
    const owner = nearestContainingFunction(node);
    const ownerId = owner === undefined ? undefined : `${owner.getSourceFile().fileName}:${owner.pos}`;
    if (irCallNodes.has(node) && ownerId !== undefined && resolvingFunctionIds.has(ownerId)) {
      contextualCallResolutions.set(
        node,
        mergeContextualCallResolution(contextualCallResolutions.get(node), resolution),
      );
    }
    return resolution;
  };

  const seedBinding = (binding) => {
    if (!ts.isIdentifier(binding.target)) return;
    const symbol = resolvedSymbol(binding.target, checker);
    if (symbol === undefined) return;
    if (isParameterChannel(binding.channel)) {
      if (closedJsxCallbackSymbols.has(symbol) || closedJsxValueSymbols.has(symbol)) return;
      const fn = nearestContainingFunction(binding.node);
      const functionId = fn === undefined ? undefined : `${fn.getSourceFile().fileName}:${fn.pos}`;
      const boundary = externalParameterOrigins.get(symbol);
      if (boundary === undefined
        && (functionId === undefined || !externallyCallableFunctionIds.has(functionId))) {
        env.set(symbol, origin(ORIGIN.BOTTOM, `unobserved private parameter ${binding.target.text}`));
        return;
      }
      const parameter = binding.target.parent;
      const declared = ts.isParameter(parameter) && parameter.initializer !== undefined
        ? evaluate(parameter.initializer)
        : declaredOrigin(binding.target, `parameter ${binding.target.text}`);
      const value = boundary === undefined ? declared : joinOrigins(declared, boundary);
      env.set(symbol, joinOrigins(env.get(symbol), value));
      return;
    }
    if (binding.source === undefined) {
      const declaration = binding.target.parent;
      const declared = declaredOrigin(binding.target, `emitless declaration ${binding.target.text}`);
      const value = binding.channel === 'catch'
        ? origin(ORIGIN.UNKNOWN, `unknown thrown value bound to ${binding.target.text}`)
        : isEmitlessDeclaration(declaration)
        ? declared.tags.has(ORIGIN.BORROWED) && !isPrimitiveLikeType(binding.target, checker)
          ? origin(ORIGIN.UNKNOWN, `opaque emitless declaration ${binding.target.text}`)
          : declared
        : constantOrigin(undefined, `uninitialised ${binding.target.text}`);
      env.set(symbol, joinOrigins(env.get(symbol), value));
    }
  };
  ir.bindings.forEach(seedBinding);

  for (const [symbol, id] of functionBySymbol) {
    env.set(symbol, functionCallable(functions.get(id), undefined));
  }

  const directInvocationArguments = (edge, overrides = new Map()) => {
    const values = argsFor(edge.callNode, overrides, 0);
    if (edge.metaName === 'call') return values.slice(1);
    if (edge.metaName === 'apply') return positionalSequence(
      values[1] ?? origin(ORIGIN.UNKNOWN, 'missing apply argument container'),
      'direct Function.apply argument container',
    ).values;
    return values;
  };

  const functionMutationMemo = new Map();
  const functionMayChangeOriginState = (functionId, visiting = new Set()) => {
    if (functionMutationMemo.has(functionId)) return functionMutationMemo.get(functionId);
    if (visiting.has(functionId)) return false;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(functionId);
    if ((functionWrites.get(functionId)?.length ?? 0) > 0) {
      functionMutationMemo.set(functionId, true);
      return true;
    }
    const changes = (functionCalls.get(functionId) ?? []).some((call) => {
      const node = call.node;
      const callee = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
      const current = unwrapExpression(callee);
      if (current === undefined) return true;
      const nestedId = functionIdFromExpression(current);
      if (nestedId !== undefined) return functionMayChangeOriginState(nestedId, nextVisiting);
      const imported = importIdentity(current, checker);
      if (imported?.startsWith('react:') || imported?.startsWith('zod:')) return false;
      if (ts.isIdentifier(current)) {
        return !(pureGlobalCalls.has(current.text) || ownedGlobalResults.has(current.text)
          || ownedConstructors.has(current.text)) && (node.arguments?.length ?? 0) > 0;
      }
      if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        const name = propertyText(current, constants, checker);
        const path = actualStaticPath(current, constants, checker);
        if ((path !== undefined && objectMutationCalls.has(path))
          || (name !== undefined && mutatingMethodEffects.has(name))) return true;
        if (name !== undefined && (pureStandardMethods.has(name) || uiMethods.has(name))
          && isStandardReceiverType(current.expression, checker)) return false;
        // An unsummarized local receiver call can mutate captured/instance
        // state even with zero explicit arguments (`counter.increment()`).
        // Keep it in the contextual replay set so THIS_ORIGIN is preserved.
        return true;
      }
      return true;
    });
    functionMutationMemo.set(functionId, changes);
    return changes;
  };

  const callMayChangeOriginState = (call) => {
    const node = call.node;
    const callee = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
    const current = unwrapExpression(callee);
    if (current === undefined) return true;
    const directFunctionId = functionIdFromExpression(current);
    if (directFunctionId !== undefined) return functionMayChangeOriginState(directFunctionId);
    const imported = importIdentity(current, checker);
    if (imported?.startsWith('react:') || imported?.startsWith('zod:')) return true;
    if (ts.isIdentifier(current)) {
      if (pureGlobalCalls.has(current.text) || ownedGlobalResults.has(current.text)
        || ownedConstructors.has(current.text)) return false;
      return (node.arguments?.length ?? 0) > 0;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const name = propertyText(current, constants, checker);
      const path = actualStaticPath(current, constants, checker);
      if ((path !== undefined && (objectMutationCalls.has(path)
        || forbiddenCapabilityEffects.has(path) || browserFacadeCalls.has(path)))
        || (name !== undefined && mutatingMethodEffects.has(name))) return true;
      if (name !== undefined && (pureStandardMethods.has(name) || uiMethods.has(name))
        && isStandardReceiverType(current.expression, checker)) return false;
      return true;
    }
    return true;
  };
  for (const [functionId, calls] of functionCalls) {
    const fn = functions.get(functionId);
    const consumedRoots = [
      ...(functionBindings.get(functionId) ?? []).flatMap((binding) =>
        binding.source === undefined ? [] : [binding.source]),
      ...(functionWrites.get(functionId) ?? []).flatMap((write) => [
        write.receiver,
        ...(write.source === undefined ? [] : [write.source]),
        ...(write.keyNode === undefined ? [] : [write.keyNode]),
      ]),
      ...(fn === undefined ? [] : collectReturns(fn)),
    ];
    const unconsumed = calls.filter(callMayChangeOriginState).filter((call) =>
      !consumedRoots.some((root) => isWithin(call.node, root)));
    functionCalls.set(functionId, unconsumed.filter((call) =>
      !unconsumed.some((outer) => outer !== call && isWithin(call.node, outer.node))));
  }
  // Function-body effects are replayed with invocation-specific parameter and
  // closure origins by evaluateFunction. The module fixed point must execute
  // only top-level operations; replaying every syntactic call/write here both
  // discarded invocation context and expanded pure nested call graphs once
  // per module iteration.
  const originStateCalls = ir.calls.filter((call) =>
    nearestContainingFunction(call.node) === undefined && callMayChangeOriginState(call));
  const topLevelWrites = ir.writes.filter((write) => nearestContainingFunction(write.node) === undefined);
  const topLevelMutationOperations = [
    ...topLevelWrites.map((write) => ({ kind: 'write', node: write.node, write })),
    ...originStateCalls.map((call) => ({ kind: 'call', call, node: call.node })),
  ].sort((left, right) => left.node.getSourceFile().fileName.localeCompare(right.node.getSourceFile().fileName)
    || left.node.pos - right.node.pos);

  const closureForFunction = (fn, id) => {
    const parent = nearestContainingFunction(fn.parent);
    const parentId = parent === undefined ? undefined : `${parent.getSourceFile().fileName}:${parent.pos}`;
    const parentOverrides = parentId === undefined ? undefined : functionObservedOverrides.get(parentId);
    for (const value of parentOverrides?.values() ?? []) {
      const callable = value.callables.find((candidate) => candidate.kind === 'function' && candidate.id === id);
      if (callable !== undefined) return callable.closure;
    }
    // A directly nested function lexically sees its parent's abstract frame
    // even when it is passed inline rather than first assigned.
    return parentOverrides;
  };

  const ensureContextualOverrides = (node) => {
    const ancestors = [];
    let current = node;
    while (current !== undefined) {
      if (ts.isFunctionLike(current) && current.body !== undefined) ancestors.push(current);
      current = current.parent;
    }
    for (const fn of ancestors.reverse()) {
      const id = `${fn.getSourceFile().fileName}:${fn.pos}`;
      if (functionObservedOverrides.has(id) || !functions.has(id) || resolvingFunctionIds.has(id)) continue;
      evaluateFunction({
        kind: 'function',
        id,
        name: functionName(fn),
        closure: closureForFunction(fn, id),
      }, [], 0);
    }
    const fn = nearestContainingFunction(node);
    if (fn === undefined) return new Map();
    const id = `${fn.getSourceFile().fileName}:${fn.pos}`;
    return functionObservedOverrides.get(id) ?? new Map();
  };

  const appliedWrites = new Set();
  const appliedTopLevelCalls = new Set();
  const callMutationSignatures = new WeakMap();
  const recordBoundaryOverride = (symbol, value, target, closed) => {
    const owner = nearestContainingFunction(target);
    if (owner === undefined) return;
    const ownerId = `${owner.getSourceFile().fileName}:${owner.pos}`;
    const observed = functionObservedOverrides.get(ownerId) ?? new Map();
    const previous = observed.get(symbol);
    observed.set(symbol, closed || previous === undefined ? value : joinOrigins(previous, value));
    functionObservedOverrides.set(ownerId, observed);
  };
  const topLevelBindings = ir.bindings.filter((binding) =>
    nearestContainingFunction(binding.node) === undefined);
  const environmentSignature = () => structuralDigest([...env.entries()]
    .map(([symbol, value]) => `${stableSymbolKey(symbol)}=${originSignature(value)}`)
    .sort());
  let fixedPointConverged = false;
  let boundaryTransfersApplied = false;
  const fixedPointIterationBudget = Math.max(32, topLevelBindings.length + 1);
  for (let iteration = 0; iteration < fixedPointIterationBudget; iteration += 1) {
    const beforeIteration = environmentSignature();
    for (const binding of topLevelBindings) {
      if (!ts.isIdentifier(binding.target) || isParameterChannel(binding.channel)) continue;
      const symbol = resolvedSymbol(binding.target, checker);
      if (symbol === undefined || binding.source === undefined) continue;
      const value = project(evaluate(binding.source), binding.projection, binding.target);
      const previous = env.get(symbol);
      const merged = previous === undefined ? value : joinOrigins(previous, value);
      const previousSignature = originSignature(previous ?? emptyOrigin());
      const mergedSignature = originSignature(merged);
      if (previous === undefined || previousSignature !== mergedSignature) {
        env.set(symbol, merged);
        invalidateFunctionSummariesForSymbol(symbol);
      } else {
        env.set(symbol, previous);
      }
      if ((binding.target.parent.parent.flags & ts.NodeFlags.Const) !== 0) {
        const text = staticString(binding.source, constants, checker);
        const number = staticNumber(binding.source, constants, checker, new Set());
        if (text !== undefined) constants.set(symbol, text);
        else if (number !== undefined) constants.set(symbol, number);
      }
    }
    if (!boundaryTransfersApplied) {
    for (const edge of jsxCallbackEdges) {
      const source = unwrapExpression(edge.expression);
      if (source !== undefined && ts.isIdentifier(source)) {
        const sourceSymbol = resolvedSymbol(source, checker);
        if (sourceSymbol !== undefined && closedJsxCallbackSymbols.has(sourceSymbol)
          && !env.has(sourceSymbol)) continue;
      }
      const value = evaluate(edge.expression, ensureContextualOverrides(edge.expression));
      const previous = env.get(edge.symbol);
      const merged = previous === undefined ? value : joinOrigins(previous, value);
      const previousSignature = originSignature(previous ?? emptyOrigin());
      const mergedSignature = originSignature(merged);
      if (previous === undefined || previousSignature !== mergedSignature) {
        env.set(edge.symbol, merged);
        recordBoundaryOverride(edge.symbol, merged, edge.target, true);
        invalidateFunctionSummariesForSymbol(edge.symbol);
      } else {
        env.set(edge.symbol, previous);
      }
    }
    const jsxPropsForSite = (site) => {
      const shape = new Map();
      const children = [];
      for (const attribute of site.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          const spread = evaluate(
            attribute.expression,
            ensureContextualOverrides(attribute.expression),
          );
          for (const [key, child] of spread.shape) {
            if (spread.hiddenKeys.has(key)) continue;
            const boundedChild = abstractLargeArgument(child, `JSX spread prop ${String(key)}`);
            shape.set(String(key), boundedChild);
            children.push(boundedChild);
          }
          const unresolvedSpread = spread.shape.size === 0
            || [ORIGIN.AMBIENT, ORIGIN.OPAQUE, ORIGIN.ESCAPED, ORIGIN.UNKNOWN]
              .some((tag) => spread.tags.has(tag));
          if (unresolvedSpread) {
            children.push(origin(ORIGIN.UNKNOWN, `unresolved JSX spread ${attribute.expression.getText()}`));
          } else if (spread.content !== undefined) {
            children.push(spread.content);
          }
          continue;
        }
        if (!ts.isJsxAttribute(attribute)) continue;
        const key = attribute.name.getText();
        const child = attribute.initializer === undefined
          ? constantOrigin(true, `JSX boolean prop ${key}`)
          : ts.isStringLiteral(attribute.initializer)
            ? constantOrigin(attribute.initializer.text, `JSX string prop ${key}`)
            : attribute.initializer.expression === undefined
              ? constantOrigin(undefined, `empty JSX prop ${key}`)
              : evaluate(
                attribute.initializer.expression,
                ensureContextualOverrides(attribute.initializer.expression),
              );
        const boundedChild = abstractLargeArgument(child, `JSX prop ${key}`);
        shape.set(key, boundedChild);
        children.push(boundedChild);
      }
      if (ts.isJsxOpeningElement(site) && ts.isJsxElement(site.parent)) {
        const childValues = site.parent.children.flatMap((child) => {
          if (ts.isJsxExpression(child)) {
            return child.expression === undefined
              ? []
              : [evaluate(child.expression, ensureContextualOverrides(child.expression))];
          }
          if (ts.isJsxText(child)) {
            return child.text.trim().length === 0
              ? []
              : [constantOrigin(child.text, 'JSX text child')];
          }
          return [evaluate(child, ensureContextualOverrides(child))];
        });
        if (childValues.length > 0) {
          const child = joinOrigins(...childValues.map((value) =>
            abstractLargeArgument(value, 'JSX child')));
          shape.set('children', child);
          children.push(child);
        }
      }
      const result = abstractLargeArgument(
        freshOwned(site, allocationProvenance(site, `closed JSX props for ${site.tagName.getText()}`), {
          shape,
          content: children.length === 0 ? undefined : joinOrigins(...children),
        }),
        `closed JSX props for ${site.tagName.getText()}`,
      );
      return result;
    };
    for (const edge of jsxValueEdges) {
      const values = edge.sites.map(jsxPropsForSite);
      const props = joinOrigins(...values);
      const value = abstractLargeArgument(
        project(props, edge.projection, edge.target),
        `JSX parameter ${edge.target.getText()}`,
      );
      const previous = env.get(edge.symbol);
      const merged = previous === undefined ? value : joinOrigins(previous, value);
      const previousSignature = originSignature(previous ?? emptyOrigin());
      const mergedSignature = originSignature(merged);
      if (previous === undefined || previousSignature !== mergedSignature) {
        env.set(edge.symbol, merged);
        recordBoundaryOverride(edge.symbol, merged, edge.target, true);
        invalidateFunctionSummariesForSymbol(edge.symbol);
      } else {
        env.set(edge.symbol, previous);
      }
    }
    // A closed JSX component edge invokes the component with the exact props
    // object assembled above. Parameter-only transfer is insufficient when
    // the component stores a prop/child into a captured slot; executing the
    // analyzed body publishes that interprocedural assignment to its owner.
    const componentDepthMemo = new Map();
    const componentDepth = (componentId, visiting = new Set()) => {
      if (componentDepthMemo.has(componentId)) return componentDepthMemo.get(componentId);
      if (visiting.has(componentId)) return 0;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(componentId);
      const depths = (jsxSitesByFunction.get(componentId) ?? []).map((site) => {
        const owner = nearestContainingFunction(site);
        if (owner === undefined) return 0;
        const ownerId = `${owner.getSourceFile().fileName}:${owner.pos}`;
        return functions.has(ownerId) ? componentDepth(ownerId, nextVisiting) + 1 : 0;
      });
      const depth = depths.length === 0 ? 0 : Math.max(...depths);
      componentDepthMemo.set(componentId, depth);
      return depth;
    };
    const closedComponentSites = [...jsxSitesByFunction.entries()]
      .flatMap(([componentId, sites]) => sites.map((site) => {
        const owner = nearestContainingFunction(site);
        const ownerId = owner === undefined ? undefined : `${owner.getSourceFile().fileName}:${owner.pos}`;
        return {
          componentId,
          depth: ownerId === undefined ? 0 : componentDepth(ownerId) + 1,
          site,
        };
      }))
      .sort((left, right) => left.depth - right.depth
        || left.site.getSourceFile().fileName.localeCompare(right.site.getSourceFile().fileName)
        || left.site.pos - right.site.pos);
    for (const { componentId, site } of closedComponentSites) {
      const component = functions.get(componentId);
      if (component === undefined) continue;
      evaluateFunction({
        kind: 'function',
        id: componentId,
        name: functionName(component),
        closure: closureForFunction(component, componentId),
      }, [jsxPropsForSite(site)], 0);
    }
    for (const edge of directArgumentEdges) {
      const callOverrides = ensureContextualOverrides(edge.callNode);
      const argumentsList = directInvocationArguments(edge, callOverrides);
      const passed = edge.parameter.dotDotDotToken === undefined
        ? argumentsList[edge.parameterIndex]
        : freshOwned(edge.callNode, allocationProvenance(edge.callNode, 'direct rest argument transfer'), {
          shape: new Map(argumentsList.slice(edge.parameterIndex).map((value, index) => [String(index), value])),
          content: argumentsList.length <= edge.parameterIndex
            ? origin(ORIGIN.BORROWED, 'empty direct rest arguments')
            : joinOrigins(...argumentsList.slice(edge.parameterIndex)),
        });
      if (passed === undefined && edge.parameter.initializer === undefined) continue;
      const source = passed ?? evaluate(edge.parameter.initializer, callOverrides);
      const value = abstractLargeArgument(
        project(source, edge.binding.projection, edge.binding.target),
        `direct parameter ${edge.binding.target.getText()}`,
      );
      const previous = env.get(edge.symbol);
      const merged = previous === undefined ? value : joinOrigins(previous, value);
      const previousSignature = originSignature(previous ?? emptyOrigin());
      const mergedSignature = originSignature(merged);
      if (previous === undefined || previousSignature !== mergedSignature) {
        env.set(edge.symbol, merged);
        recordBoundaryOverride(edge.symbol, merged, edge.binding.target, false);
        invalidateFunctionSummariesForSymbol(edge.symbol);
      } else {
        env.set(edge.symbol, previous);
      }
    }
    for (const site of unknownJsxSites) {
      for (const attribute of site.attributes.properties) {
        const expression = ts.isJsxSpreadAttribute(attribute)
          ? attribute.expression
          : ts.isJsxAttribute(attribute) && attribute.initializer !== undefined
            && ts.isJsxExpression(attribute.initializer)
          ? attribute.initializer.expression
          : undefined;
        if (expression !== undefined) {
          escapeOwned(
            evaluate(expression, ensureContextualOverrides(expression)),
            `escaped through unresolved JSX component ${site.tagName.getText()}`,
          );
        }
      }
    }
    boundaryTransfersApplied = true;
    }
    for (const operation of topLevelMutationOperations) {
      if (operation.kind === 'write') {
        const { write } = operation;
        const receiver = evaluate(write.receiver);
        const keyDomain = mutationKeyDomainForWrite(write);
        const { keys } = keyDomain;
        recordContextualOrigin(write.receiver, receiver);
        if (!(receiver.tags.size === 1 && receiver.tags.has(ORIGIN.BOTTOM))) {
          recordWriteDispatchProof(
            write.node,
            write.channel === 'delete'
              || ordinarySetDispatchSafe(receiver, keys, keyDomain.complete),
          );
        }
        if (appliedWrites.has(write) || !isProvenMutableLocal(receiver)) continue;
        invalidateSequence(receiver, `top-level ${write.channel} write`);
        const written = write.source === undefined
          ? constantOrigin(undefined, `delete ${write.receiver.getText()}`)
          : project(evaluate(write.source), write.projection, write.node);
        if (write.channel === 'delete') {
          const invalidated = !keyDomain.complete || keys.size === 0
            ? new Set([...receiver.initialDataKeys, ...receiver.definedDataKeys])
            : keys;
          for (const key of invalidated) {
            const normalized = descriptorPropertyKey(key);
            receiver.definedDataKeys.delete(normalized);
            receiver.accessorKeys.delete(normalized);
            receiver.nonWritableKeys.delete(normalized);
            receiver.invalidatedDataKeys.add(normalized);
            receiver.shape.delete(normalized);
          }
        } else {
          for (const key of keys) mergeShapeValue(receiver, key, written);
          mergeContent(receiver, written, `value transfer through ${write.channel} write`);
        }
        appliedWrites.add(write);
        invalidateFunctionSummaries();
        continue;
      }
      const { call } = operation;
      if (appliedTopLevelCalls.has(call)) continue;
      const resolution = resolveCall(call.node);
      appliedTopLevelCalls.add(call);
      if (resolution.mutationReceivers.length > 0 || resolution.effects.has('HOST_UNKNOWN')) {
        const signature = structuralDigest([
          ...resolution.mutationReceivers.map((mutation) => originSignature(mutation.receiver)).sort(),
          resolution.effects.has('HOST_UNKNOWN') ? 'unknown-effect' : '',
        ]);
        callMutationSignatures.set(call.node, signature);
        invalidateFunctionSummaries();
      }
    }
    // Individual transfer phases may temporarily materialize a value that a
    // later phase canonicalizes back to the same abstract environment. Only
    // the whole-iteration start/end state determines convergence; retaining a
    // sticky intermediate `changed` bit caused stable programs to burn the
    // entire graph-sized iteration budget.
    const changed = beforeIteration !== environmentSignature();
    if (!changed) {
      fixedPointConverged = true;
      break;
    }
  }

  // Facade exports and host registrations are semantic invocation roots, not
  // merely functions whose declarations happen to live in the facade file.
  // Preserve the resolved callable origin plus its live arguments/bound this:
  // timers can retain a mutable local cell, re-exports can target helper
  // modules, and React cleanups are invoked after the registering effect.
  const externalFunctionWithThis = (target, thisOrigin) => target.kind !== 'function'
    ? target
    : {
      ...target,
      closure: new Map([...(target.closure ?? []), [THIS_ORIGIN, thisOrigin]]),
    };
  const invokeExternalCallable = (entry, argumentsList, depth = 0) => {
    if (depth > 12) {
      failDeferredInvocation(`external callable depth limit for ${entry.kind}:${entry.name ?? ''}`);
      return origin(ORIGIN.UNKNOWN, 'external callable depth limit exceeded');
    }
    if (entry.kind === 'function') {
      invalidateFunctionSummaries();
      return evaluateFunction(entry, argumentsList, depth + 1, [], true);
    }
    if (entry.kind === 'bound') {
      const results = entry.targets.map((target) => invokeExternalCallable(
        externalFunctionWithThis(
          target,
          entry.boundThis ?? constantOrigin(undefined, 'undefined bound this'),
        ),
        [...entry.boundArguments, ...argumentsList],
        depth + 1,
      ));
      if (results.length > 0) return joinOrigins(...results);
    }
    if (entry.kind === 'ui') return constantOrigin(undefined, `UI external callback ${entry.name}`);
    failDeferredInvocation(`unresolved external callable ${entry.kind}:${entry.name ?? ''}`);
    return origin(ORIGIN.UNKNOWN, `unresolved external callable ${entry.kind}:${entry.name ?? ''}`);
  };
  const invokeExternalOrigin = (value, argumentsList, kind, site) => {
    if (!callableArgumentIsResolved(value)) {
      failDeferredInvocation(`unresolved replay ${kind} at ${site.getSourceFile().fileName}:${site.pos}`);
      return origin(ORIGIN.UNKNOWN, `unresolved ${kind} callable`);
    }
    const results = value.callables.map((entry) => invokeExternalCallable(entry, argumentsList));
    const result = results.length === 0
      ? origin(ORIGIN.UNKNOWN, `${kind} has no analyzed callable target`)
      : joinOrigins(...results);
    if (kind === 'react-effect' && result.callables.length > 0) {
      recordDeferredInvocation(site, result, [], 'react-cleanup');
    }
    return result;
  };
  const facadeExportOrigin = (symbol) => {
    const value = env.get(symbol);
    if (value !== undefined) return value;
    const id = functionBySymbol.get(symbol);
    const fn = id === undefined ? undefined : functions.get(id);
    return fn === undefined ? undefined : functionCallable(fn, closureForFunction(fn, id));
  };
  const invokeExportSurface = (value, seenOrigins = new WeakSet(), seenCallables = new Set(), depth = 0) => {
    if (depth > 10 || seenOrigins.has(value)) return;
    seenOrigins.add(value);
    for (const entry of value.callables) {
      const key = callableKey(entry);
      if (seenCallables.has(key)) continue;
      seenCallables.add(key);
      invokeExternalCallable(entry, [], depth + 1);
    }
    for (const [key, child] of value.shape) {
      if (!value.hiddenKeys.has(key)) invokeExportSurface(child, seenOrigins, seenCallables, depth + 1);
    }
    if (value.content !== undefined) {
      invokeExportSurface(value.content, seenOrigins, seenCallables, depth + 1);
    }
  };
  const jsxHostInput = origin(ORIGIN.AMBIENT, 'host JSX callback input');
  const typedHostInput = origin(ORIGIN.AMBIENT, 'typed host callback input');
  const refreshDeferredBoundarySites = () => {
    for (const site of deferredBoundarySites) {
      const value = evaluate(site.expression, ensureContextualOverrides(site.expression));
      if (site.kind === 'jsx-spread') {
        for (const [key, child] of value.shape) {
          if (value.hiddenKeys.has(key)) continue;
          const name = String(key);
          if (/^on[A-Z]/u.test(name) || name === 'ref') {
            if (name === 'ref' && !callableArgumentIsResolved(child)) continue;
            recordDeferredInvocation(site.expression, child, [jsxHostInput], `jsx:${name}`);
          }
        }
        continue;
      }
      if (site.kind === 'jsx:ref' && !callableArgumentIsResolved(value)) continue;
      recordDeferredInvocation(
        site.expression,
        value,
        [site.kind === 'typed-callback' ? typedHostInput : jsxHostInput],
        site.kind,
      );
    }
  };
  const deferredRecordSignature = () => [...deferredInvocationRecords.entries()]
    .flatMap(([siteKey, records]) => records.map((record) => `${siteKey}:${record.kind}:${record.semanticKey}:${originSignature(record.callable)}:${record.argumentsList.map((value) => originSignature(value)).join(',')}`))
    .sort();
  const externalStateSignature = () => structuralDigest([
    environmentSignature(),
    'overrides',
    ...[...functionObservedOverrides.entries()].flatMap(([id, overrides]) => [...overrides]
      .map(([symbol, value]) => `${id}:${stableSymbolKey(symbol)}=${originSignature(value)}`)).sort(),
    'results',
    ...[...functionObservedResults.entries()]
      .map(([id, value]) => `${id}:${originSignature(value)}`).sort(),
    'deferred',
    ...deferredRecordSignature(),
  ]);
  const hasExternalRoots = facadeExportSymbols.size > 0 || deferredBoundarySites.length > 0
    || deferredInvocationRecords.size > 0 || externallyInvokedCallbackIds.size > 0;
  let externalFixedPointConverged = !hasExternalRoots;
  const externalIterationBudget = Math.max(
    32,
    (facadeExportSymbols.size + deferredBoundarySites.length + deferredInvocationRecords.size + 1) * 8,
  );
  for (let iteration = 0; iteration < externalIterationBudget && hasExternalRoots; iteration += 1) {
    const beforeIteration = externalStateSignature();
    for (const symbol of facadeExportSymbols) {
      const value = facadeExportOrigin(symbol);
      if (value !== undefined) invokeExportSurface(value);
    }
    refreshDeferredBoundarySites();
    const records = [...deferredInvocationRecords.values()].flatMap((items) => [...items]);
    for (const record of records) {
      invalidateFunctionSummaries();
      invokeExternalOrigin(record.callable, record.argumentsList, record.kind, record.site);
    }
    if (beforeIteration === externalStateSignature()) {
      externalFixedPointConverged = !unresolvedDeferredInvocation;
      break;
    }
  }

  const callableResultOf = (value, depth = 0) => {
    if (depth > 8 || value.callables.length === 0) {
      return origin(ORIGIN.UNKNOWN, depth > 8 ? 'exported callable depth limit' : 'exported value is not directly analyzed callable');
    }
    const results = [];
    for (const entry of value.callables) {
      if (entry.kind === 'function') {
        const evaluated = evaluateFunction(entry, [], depth + 1);
        results.push(joinOrigins(evaluated, functionObservedResults.get(entry.id)));
      }
      else if (entry.kind === 'bound') {
        for (const target of entry.targets) {
          if (target.kind === 'function') {
            const boundTarget = externalFunctionWithThis(
              target,
              entry.boundThis ?? constantOrigin(undefined, 'undefined bound this'),
            );
            results.push(joinOrigins(
              evaluateFunction(boundTarget, entry.boundArguments, depth + 1),
              functionObservedResults.get(target.id),
            ));
          }
          else results.push(origin(ORIGIN.UNKNOWN, `unresolved exported bound target ${target.kind}`));
        }
      } else if (entry.kind === 'local-class') {
        const declaration = classes.get(entry.id);
        results.push(instantiateClass(entry, [], declaration ?? sourceFiles[0], depth + 1));
      } else if (entry.kind === 'ui') {
        results.push(constantOrigin(undefined, `UI operation ${entry.name}`));
      } else {
        results.push(origin(ORIGIN.UNKNOWN, `unresolved exported callable ${entry.kind}:${entry.name ?? ''}`));
      }
    }
    return joinOrigins(...results);
  };

  return {
    ORIGIN,
    constants,
    env,
    originOf: (node) => {
      const narrowAtNode = (value) => {
        const current = unwrapExpression(node);
        const symbol = current !== undefined && ts.isIdentifier(current)
          ? resolvedSymbol(current, checker)
          : undefined;
        return symbol !== undefined && isNarrowedPresentAt(current, symbol, checker)
          ? withoutAbsence(value, `non-nullish guard for ${current.text}`)
          : value;
      };
      const recorded = contextualNodeOrigins.get(node);
      if (recorded !== undefined) return narrowAtNode(recorded);
      const overrides = ensureContextualOverrides(node);
      return narrowAtNode(contextualNodeOrigins.get(node) ?? evaluate(node, overrides));
    },
    ordinarySetDispatchSafe,
    mutationKeyDomainForWrite,
    mutationKeysForWrite,
    writeDispatchSafe: (node, receiver, keys, keysComplete = keys?.size > 0) =>
      contextualWriteDispatchProofs.get(node)
      ?? ordinarySetDispatchSafe(receiver, keys, keysComplete),
    declarationOriginOf: (node) => {
      if (ts.isFunctionLike(node) && node.body !== undefined) return functionCallable(node);
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const id = `${node.getSourceFile().fileName}:${node.pos}`;
        return withCallable({ kind: 'local-class', id, name: node.name?.text ?? 'default class' }, `local class ${node.name?.text ?? 'default'}`);
      }
      return origin(ORIGIN.UNKNOWN, `unsupported exported declaration ${ts.SyntaxKind[node.kind]}`);
    },
    functionResultOf: (node) => {
      const id = `${node.getSourceFile().fileName}:${node.pos}`;
      return functions.has(id)
        ? evaluateFunction({ kind: 'function', id, name: functionName(node) }, [], 0)
        : origin(ORIGIN.UNKNOWN, `unresolved exported function ${functionName(node)}`);
    },
    callableResultOf,
    fixedPointExhausted: !fixedPointConverged || !externalFixedPointConverged,
    isUnknownJsx: (node) => unknownJsxSites.includes(node),
    isResolvedCallable: (value) => callableArgumentIsResolved(value),
    requiresCallableResolution: (node, value) => callableArgumentRequiresResolution(node, value, checker),
    resolveCall: (node) => {
      const recorded = contextualCallResolutions.get(node);
      if (recorded !== undefined && !recorded.effects.has('HOST_UNKNOWN')) return recorded;
      const overrides = ensureContextualOverrides(node);
      return resolveCall(node, overrides);
    },
    staticString: (node) => staticString(node, constants, checker),
    staticKey: (node) => staticKey(node, constants, checker),
    staticKeys: (node) => staticKeys(node, constants, checker),
    staticKeyDomain: (node) => staticKeyDomain(node, constants, checker),
    staticStrings: (node) => staticStrings(node, constants, checker),
  };
}
