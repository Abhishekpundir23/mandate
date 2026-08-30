import type { ActionSelector, Clause, IntentDiff } from '../domain/types';

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
}

function selectorsEqual(left: ActionSelector | undefined, right: ActionSelector): boolean {
  return left !== undefined
    && left.tool === right.tool
    && left.operation === right.operation
    && left.resource === right.resource
    && left.effect === right.effect;
}

function stripQuotedSpans(text: string): string {
  return text
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/‘[^’]*’/g, ' ');
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function compileSupportedTurnValue(turn: CompilerTurn, context: CompilerContext): IntentDiff {
  const unquoted = stripQuotedSpans(turn.text);
  const normalized = unquoted.toLocaleLowerCase();
  const action = context.actions.find((candidate) =>
    candidate.phrases.some((phrase) => normalized.includes(phrase.toLocaleLowerCase())),
  );

  if (action !== undefined && normalized.includes(' instead of ')) {
    const replacedText = normalized.split(' instead of ', 2)[1] ?? '';
    const replacedAction = context.actions.find((candidate) =>
      candidate.entityTerms?.some((term) => replacedText.includes(term.toLocaleLowerCase())),
    );
    const replacedClause = replacedAction === undefined
      ? undefined
      : context.activeClauses.find((clause) => selectorsEqual(clause.selector, replacedAction.selector));

    if (replacedClause !== undefined) {
      const replacementKind = replacedClause.kind === 'MUST' ? 'MUST' : 'MAY';
      return {
        baseVersion: context.baseVersion,
        turnId: turn.id,
        ops: [{
          op: 'REPLACE',
          targetClauseIds: [replacedClause.id],
          replacement: {
            id: `${turn.id}:${action.id}:replacement`,
            kind: replacementKind,
            statement: action.statement,
            selector: action.selector,
            source: { turnId: turn.id, quote: turn.text },
            confidence: 1,
          },
        }],
      };
    }
  }

  if (action !== undefined && /\b(?:do not|don't)\b/.test(normalized) && !/\bdon't forget to\b/.test(normalized)) {
    const grant = context.activeClauses.find((clause) =>
      (clause.kind === 'MAY' || clause.kind === 'MUST')
      && selectorsEqual(clause.selector, action.selector),
    );

    if (grant !== undefined) {
      return {
        baseVersion: context.baseVersion,
        turnId: turn.id,
        ops: [{
          op: 'REVOKE',
          tombstone: {
            id: `${turn.id}:${grant.id}:revoke`,
            kind: 'REVOKED',
            statement: `Revoked: ${grant.statement}`,
            targetClauseIds: [grant.id],
            revokedSelector: action.selector,
            source: { turnId: turn.id, quote: turn.text },
            confidence: 1,
          },
        }],
      };
    }

    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{
        op: 'ADD',
        clause: {
          id: `${turn.id}:${action.id}:deny`,
          kind: 'MUST_NOT',
          statement: `Do not ${action.statement.toLocaleLowerCase()}`,
          selector: action.selector,
          source: { turnId: turn.id, quote: turn.text },
          confidence: 1,
        },
      }],
    };
  }

  if (action !== undefined && /\b(?:ask me|confirm with me|get my confirmation) before\b/.test(normalized)) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{
        op: 'ADD',
        clause: {
          id: `${turn.id}:${action.id}:confirm`,
          kind: 'NEEDS_CONFIRMATION',
          statement: `Confirm before: ${action.statement}`,
          selector: action.selector,
          afterConfirmation: 'MAY',
          source: { turnId: turn.id, quote: turn.text },
          confidence: 1,
        },
      }],
    };
  }

  if (action !== undefined && /\bdon't forget to\b/.test(normalized)) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{
        op: 'ADD',
        clause: {
          id: `${turn.id}:${action.id}:require`,
          kind: 'MUST',
          statement: action.statement,
          selector: action.selector,
          source: { turnId: turn.id, quote: turn.text },
          confidence: 0.9,
        },
      }],
    };
  }

  if (action !== undefined && /\b(?:you may|you can|i authorize you to)\b/.test(normalized)) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{
        op: 'ADD',
        clause: {
          id: `${turn.id}:${action.id}:allow`,
          kind: 'MAY',
          statement: action.statement,
          selector: action.selector,
          source: { turnId: turn.id, quote: turn.text },
          confidence: 1,
        },
      }],
    };
  }

  const isSupportedImperative = action?.phrases.some((phrase) =>
    normalized.trimStart().startsWith(phrase.toLocaleLowerCase()),
  ) ?? false;
  if (action !== undefined && isSupportedImperative) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{
        op: 'ADD',
        clause: {
          id: `${turn.id}:${action.id}:require`,
          kind: 'MUST',
          statement: action.statement,
          selector: action.selector,
          source: { turnId: turn.id, quote: turn.text },
          confidence: 0.9,
        },
      }],
    };
  }

  if (/\b(?:finish|complete|do)\s+(?:it|that|this)\b/.test(normalized)) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{ op: 'NO_CHANGE', reason: 'AMBIGUOUS' }],
    };
  }

  if (action === undefined && /^[a-z]+\s+(?:the|a|an)\b/i.test(unquoted.trimStart())) {
    return {
      baseVersion: context.baseVersion,
      turnId: turn.id,
      ops: [{ op: 'NO_CHANGE', reason: 'IRRELEVANT' }],
    };
  }

  return {
    baseVersion: context.baseVersion,
    turnId: turn.id,
    ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
  };
}

export function compileSupportedTurn(turn: CompilerTurn, context: CompilerContext): IntentDiff {
  return deepFreeze(compileSupportedTurnValue(turn, context)) as IntentDiff;
}
