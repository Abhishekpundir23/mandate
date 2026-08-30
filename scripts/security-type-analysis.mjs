import ts from 'typescript';

const closedReflectionRoots = new Set(['Object', 'Reflect', 'Function', 'Proxy', 'globalThis']);

export function resolvedSymbol(node, checker) {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

export function isActualGlobal(node, checker) {
  const symbol = resolvedSymbol(node, checker);
  if (symbol === undefined) return true;
  const declarations = symbol.getDeclarations() ?? [];
  return !declarations.some((declaration) => !declaration.getSourceFile().isDeclarationFile);
}

export function unwrapExpression(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

export function staticString(node, constants, checker) {
  const current = unwrapExpression(node);
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) return current.text;
  if (ts.isIdentifier(current)) return constants.get(resolvedSymbol(current, checker));
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(current.left, constants, checker);
    const right = staticString(current.right, constants, checker);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function startsAtClosedReflectionRoot(node, checker) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    return closedReflectionRoots.has(current.text) && isActualGlobal(current, checker);
  }
  return (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    && startsAtClosedReflectionRoot(current.expression, checker);
}

function typeExposesDynamicCapability(type, checker) {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
  if (type.isUnionOrIntersection()
    && type.types.some((candidate) => typeExposesDynamicCapability(candidate, checker))) return true;
  return checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
    || checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0;
}

export function dynamicElementAccessIsUnsafe(node, property, checker) {
  return ts.isElementAccessExpression(node)
    && property === undefined
    && (startsAtClosedReflectionRoot(node.expression, checker)
      || typeExposesDynamicCapability(checker.getTypeAtLocation(node), checker));
}
