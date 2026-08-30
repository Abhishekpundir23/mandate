import ts from 'typescript';

const closedReflectionRoots = new Set(['Object', 'Reflect', 'Function', 'Proxy', 'globalThis']);
const ambientDataRoots = new Set(['window', 'globalThis', 'self', 'document', 'navigator', 'location', 'history']);

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

export function startsAtClosedReflectionRoot(node, checker) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    return closedReflectionRoots.has(current.text) && isActualGlobal(current, checker);
  }
  return (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    && startsAtClosedReflectionRoot(current.expression, checker);
}

function typeHasUnresolvedGeneric(type) {
  if ((type.flags & (
    ts.TypeFlags.TypeParameter
    | ts.TypeFlags.IndexedAccess
    | ts.TypeFlags.Conditional
    | ts.TypeFlags.Substitution
  )) !== 0) return true;
  return type.isUnionOrIntersection()
    && type.types.some((candidate) => typeHasUnresolvedGeneric(candidate));
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
      || typeHasUnresolvedGeneric(checker.getTypeAtLocation(node))
      || typeHasUnresolvedGeneric(checker.getTypeAtLocation(node.expression))
      || (node.argumentExpression !== undefined
        && typeHasUnresolvedGeneric(checker.getTypeAtLocation(node.argumentExpression)))
      || typeExposesDynamicCapability(checker.getTypeAtLocation(node), checker));
}

function functionReturns(declaration) {
  if (declaration.body === undefined) return [];
  if (!ts.isBlock(declaration.body)) return [declaration.body];
  const returns = [];
  const visit = (node) => {
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) returns.push(node.expression);
    else ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return returns;
}

function calledFunctionDeclarations(node, checker) {
  const callee = unwrapExpression(node.expression);
  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) return [callee];
  if (!ts.isIdentifier(callee)) return [];
  const declarations = resolvedSymbol(callee, checker)?.getDeclarations() ?? [];
  return declarations.flatMap((declaration) => {
    if (ts.isFunctionDeclaration(declaration)) return [declaration];
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const initializer = unwrapExpression(declaration.initializer);
      return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) ? [initializer] : [];
    }
    return [];
  });
}

function assignmentTargetHasSymbol(node, symbol, checker) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) return resolvedSymbol(current, checker) === symbol;
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return resolvedSymbol(property.name, checker) === symbol;
      if (ts.isPropertyAssignment(property)) return assignmentTargetHasSymbol(property.initializer, symbol, checker);
      if (ts.isSpreadAssignment(property)) return assignmentTargetHasSymbol(property.expression, symbol, checker);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.some((element) =>
      !ts.isOmittedExpression(element)
      && assignmentTargetHasSymbol(ts.isSpreadElement(element) ? element.expression : element, symbol, checker));
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignmentTargetHasSymbol(current.left, symbol, checker);
  }
  return false;
}

function symbolIsReassigned(symbol, declaration, checker) {
  let reassigned = false;
  const visit = (node) => {
    if (reassigned) return;
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && assignmentTargetHasSymbol(node.left, symbol, checker)) reassigned = true;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      && assignmentTargetHasSymbol(node.operand, symbol, checker)) reassigned = true;
    if (!reassigned) ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return reassigned;
}

/** Proves that an expression is locally created inert data rather than ambient or reflective authority. */
export function isProvenSafeLocalData(node, checker, seen = new Set()) {
  const current = unwrapExpression(node);
  if (seen.has(current)) return false;
  const nextSeen = new Set(seen).add(current);
  if (ts.isStringLiteralLike(current) || ts.isNumericLiteral(current)
    || current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword
    || current.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.every((property) => {
      if (ts.isPropertyAssignment(property)) return isProvenSafeLocalData(property.initializer, checker, nextSeen);
      if (ts.isShorthandPropertyAssignment(property)) return isProvenSafeLocalData(property.name, checker, nextSeen);
      if (ts.isSpreadAssignment(property)) return isProvenSafeLocalData(property.expression, checker, nextSeen);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.every((element) =>
      ts.isOmittedExpression(element) || isProvenSafeLocalData(element, checker, nextSeen));
  }
  if (ts.isIdentifier(current)) {
    if ((closedReflectionRoots.has(current.text) || ambientDataRoots.has(current.text))
      && isActualGlobal(current, checker)) return false;
    const symbol = resolvedSymbol(current, checker);
    const declarations = symbol?.getDeclarations() ?? [];
    if (declarations.length === 0) return false;
    return declarations.every((declaration) => {
      if (symbol !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
        && !symbolIsReassigned(symbol, declaration, checker)) {
        return isProvenSafeLocalData(declaration.initializer, checker, nextSeen);
      }
      if (ts.isBindingElement(declaration)) return false;
      return false;
    });
  }
  if (ts.isCallExpression(current)) {
    const declarations = calledFunctionDeclarations(current, checker);
    if (declarations.length === 0) return false;
    const returns = declarations.flatMap(functionReturns);
    return returns.length > 0
      && returns.every((expression) => isProvenSafeLocalData(expression, checker, nextSeen));
  }
  if (ts.isConditionalExpression(current)) {
    return isProvenSafeLocalData(current.whenTrue, checker, nextSeen)
      && isProvenSafeLocalData(current.whenFalse, checker, nextSeen);
  }
  return false;
}
