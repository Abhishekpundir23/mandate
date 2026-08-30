import ts from 'typescript';

import { receiverIndependentSinks } from './security-source-policy.mjs';
import { isProvenSafeLocalData, staticString, unwrapExpression } from './security-type-analysis.mjs';

function syntaxPropertyName(node, constants, checker) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return ts.isComputedPropertyName(node) ? staticString(node.expression, constants, checker) : undefined;
}

export function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function isDynamicWriteTarget(node) {
  let current = node;
  while ((ts.isParenthesizedExpression(current.parent)
    || ts.isAsExpression(current.parent)
    || ts.isTypeAssertionExpression(current.parent)
    || ts.isNonNullExpression(current.parent)
    || ts.isSatisfiesExpression(current.parent))
    && current.parent.expression === current) current = current.parent;
  const parent = current.parent;
  if (ts.isBinaryExpression(parent) && parent.left === current && isAssignmentOperator(parent.operatorToken.kind)) return true;
  return (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && parent.operand === current
    && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken);
}

export function inspectAssignmentPattern(target, source, constants, checker, violations) {
  const current = unwrapExpression(target);
  if (!ts.isObjectLiteralExpression(current) && !ts.isArrayLiteralExpression(current)) return;
  if (source !== undefined && !isProvenSafeLocalData(source, checker)) {
    violations.push('assignment pattern source is not proven safe local data');
  }
  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements) {
      if (ts.isOmittedExpression(element)) continue;
      inspectAssignmentPattern(ts.isSpreadElement(element) ? element.expression : element, undefined, constants, checker, violations);
    }
    return;
  }
  for (const property of current.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (source === undefined || !isProvenSafeLocalData(source, checker)) {
        violations.push('assignment rest source is not proven safe local data');
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      if (receiverIndependentSinks.has(property.name.text)) {
        violations.push(`forbidden assignment property ${property.name.text}`);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = syntaxPropertyName(property.name, constants, checker);
    if (name === undefined && ts.isComputedPropertyName(property.name)) {
      violations.push('unknown computed assignment property');
    } else if (name !== undefined && receiverIndependentSinks.has(name)) {
      violations.push(`forbidden assignment property ${name}`);
    }
    const nested = ts.isBinaryExpression(property.initializer)
      && property.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ? property.initializer.left
      : property.initializer;
    inspectAssignmentPattern(nested, undefined, constants, checker, violations);
  }
}
