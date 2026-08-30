import type { ActionSelector, Clause, IntentDiff, IntentDiffOp } from '../domain/types';

const confidenceLevels = Object.freeze([1, 0.9, 0.6] as const);

export const compilerSupportMetadata = Object.freeze({
  mode: 'DETERMINISTIC_SUPPORTED_LANGUAGE' as const,
  label: 'Supported language only',
  arbitraryLanguage: false,
  confidenceLevels,
});

export interface SupportedAction {
  readonly id: string;
  readonly phrases: readonly string[];
  readonly entityTerms?: readonly string[];
  readonly statement: string;
  readonly selector: ActionSelector;
}

export interface CompilerContext {
  readonly baseVersion: number;
  readonly actions: readonly SupportedAction[];
  readonly activeClauses: readonly Clause[];
}

export interface CompilerTurn {
  readonly id: string;
  readonly text: string;
  readonly origin?: 'USER' | 'UNTRUSTED';
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function stripQuotedSpans(text: string): string {
  return text
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/‘[^’]*’/g, ' ')
    .replace(/'[^']*'/g, ' ');
}

function selectorsEqual(left: ActionSelector | undefined, right: ActionSelector): boolean {
  return left !== undefined
    && left.tool === right.tool
    && left.operation === right.operation
    && left.resource === right.resource
    && left.effect === right.effect;
}

function makeDiff(
  turn: CompilerTurn,
  context: CompilerContext,
  ops: readonly IntentDiffOp[],
): IntentDiff {
  return {
    baseVersion: context.baseVersion,
    turnId: turn.id,
    source: { turnId: turn.id, quote: turn.text },
    ops,
  };
}

function compileSupportedTurnValue(turn: CompilerTurn, context: CompilerContext): IntentDiff {
  const unquoted = stripQuotedSpans(turn.text);
  const normalized = unquoted.toLowerCase().trim();
  if (turn.origin === 'UNTRUSTED') {
    return makeDiff(turn, context, [{ op: 'NO_CHANGE', reason: 'IRRELEVANT' }]);
  }
  if (/^(?:(?:the )?page says\b|tool (?:output|observation)\s*:|(?:the )?(?:document|fixture) says\b)/.test(normalized)) {
    return makeDiff(turn, context, [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
  }

  const action = context.actions.find((candidate) =>
    candidate.phrases.some((phrase) => normalized.includes(phrase.toLowerCase())),
  );
  const actionStartsTurn = action?.phrases.some((phrase) =>
    normalized.startsWith(phrase.toLowerCase()),
  ) ?? false;

  if (action !== undefined && actionStartsTurn && normalized.includes(' instead of ')) {
    const replacedText = normalized.split(' instead of ', 2)[1] ?? '';
    const replacedAction = context.actions.find((candidate) =>
      candidate.entityTerms?.some((term) => replacedText.includes(term.toLowerCase())),
    );
    const replacedClause = replacedAction === undefined
      ? undefined
      : context.activeClauses.find((clause) =>
        (clause.kind === 'MAY' || clause.kind === 'MUST')
        && selectorsEqual(clause.selector, replacedAction.selector),
      );
    if (replacedClause !== undefined) {
      return makeDiff(turn, context, [{
        op: 'REPLACE',
        targetClauseIds: [replacedClause.id],
        replacement: {
          id: `${turn.id}:${action.id}:replacement`,
          kind: replacedClause.kind,
          statement: action.statement,
          selector: structuredClone(action.selector),
          source: { turnId: turn.id, quote: turn.text },
          confidence: 1,
        },
      }]);
    }
  }

  const explicitDeny = /^(?:(?:actually|please),?\s+)?(?:do not|don't)\b/.test(normalized)
    && !/^don't forget to\b/.test(normalized);
  if (action !== undefined && explicitDeny) {
    const grant = context.activeClauses.find((clause) =>
      (clause.kind === 'MAY' || clause.kind === 'MUST')
      && selectorsEqual(clause.selector, action.selector),
    );
    if (grant !== undefined) {
      return makeDiff(turn, context, [{
        op: 'REVOKE',
        tombstone: {
          id: `${turn.id}:${grant.id}:revoke`,
          kind: 'REVOKED',
          statement: `Revoked: ${grant.statement}`,
          targetClauseIds: [grant.id],
          revokedSelector: structuredClone(action.selector),
          source: { turnId: turn.id, quote: turn.text },
          confidence: 1,
        },
      }]);
    }
    return makeDiff(turn, context, [{
      op: 'ADD',
      clause: {
        id: `${turn.id}:${action.id}:deny`,
        kind: 'MUST_NOT',
        statement: `Do not ${action.statement.toLowerCase()}`,
        selector: structuredClone(action.selector),
        source: { turnId: turn.id, quote: turn.text },
        confidence: 1,
      },
    }]);
  }

  if (action !== undefined && /^(?:ask me|confirm with me|get my confirmation) before\b/.test(normalized)) {
    return makeDiff(turn, context, [{
      op: 'ADD',
      clause: {
        id: `${turn.id}:${action.id}:confirm`,
        kind: 'NEEDS_CONFIRMATION',
        statement: `Confirm before: ${action.statement}`,
        selector: structuredClone(action.selector),
        afterConfirmation: 'MAY',
        source: { turnId: turn.id, quote: turn.text },
        confidence: 1,
      },
    }]);
  }

  const required = action !== undefined
    && (/^don't forget to\b/.test(normalized) || actionStartsTurn);
  if (required) {
    return makeDiff(turn, context, [{
      op: 'ADD',
      clause: {
        id: `${turn.id}:${action.id}:require`,
        kind: 'MUST',
        statement: action.statement,
        selector: structuredClone(action.selector),
        source: { turnId: turn.id, quote: turn.text },
        confidence: 0.9,
      },
    }]);
  }

  if (action !== undefined && /^(?:you may|you can|i authorize you to)\b/.test(normalized)) {
    return makeDiff(turn, context, [{
      op: 'ADD',
      clause: {
        id: `${turn.id}:${action.id}:allow`,
        kind: 'MAY',
        statement: action.statement,
        selector: structuredClone(action.selector),
        source: { turnId: turn.id, quote: turn.text },
        confidence: 1,
      },
    }]);
  }

  if (/\b(?:finish|complete|do)\s+(?:it|that|this)\b/.test(normalized)) {
    return makeDiff(turn, context, [{ op: 'NO_CHANGE', reason: 'AMBIGUOUS' }]);
  }
  if (action === undefined && /^[a-z]+\s+(?:the|a|an)\b/i.test(unquoted.trimStart())) {
    return makeDiff(turn, context, [{ op: 'NO_CHANGE', reason: 'IRRELEVANT' }]);
  }
  return makeDiff(turn, context, [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
}

export function compileSupportedTurn(turn: CompilerTurn, context: CompilerContext): IntentDiff {
  return deepFreeze(compileSupportedTurnValue(turn, context)) as IntentDiff;
}
