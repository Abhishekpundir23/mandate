import ts from 'typescript';

export function unwrapTarget(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

export function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function defaultTarget(node) {
  const current = unwrapTarget(node);
  return ts.isBinaryExpression(current)
    && current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ? current.left
    : current;
}

function literalProperty(node) {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function addLeaf(target, source, projection, channel, file, output) {
  const current = unwrapTarget(defaultTarget(target));
  if (ts.isIdentifier(current)) {
    output.bindings.push({
      kind: 'BIND',
      target: current,
      source,
      projection,
      channel,
      file,
      node: current,
    });
    return;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    output.writes.push({
      kind: 'WRITE',
      receiver: current.expression,
      keyNode: ts.isPropertyAccessExpression(current) ? current.name : current.argumentExpression,
      literalKey: ts.isPropertyAccessExpression(current) ? current.name.text : undefined,
      source,
      projection,
      channel,
      file,
      node: current,
    });
    return;
  }
  lowerTarget(current, source, projection, channel, file, output);
}

function lowerBindingPattern(pattern, source, projection, channel, file, output) {
  if (ts.isArrayBindingPattern(pattern)) {
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      lowerTarget(
        element.name,
        source,
        [...projection, element.dotDotDotToken === undefined ? index : '*'],
        element.dotDotDotToken === undefined ? channel : `${channel}:rest`,
        file,
        output,
      );
    });
    return;
  }
  for (const element of pattern.elements) {
    const property = literalProperty(element.propertyName)
      ?? (element.propertyName === undefined && ts.isIdentifier(element.name)
        ? element.name.text
        : undefined);
    const keyNode = element.propertyName !== undefined && ts.isComputedPropertyName(element.propertyName)
      ? element.propertyName.expression
      : undefined;
    lowerTarget(
      element.name,
      source,
      [...projection, element.dotDotDotToken === undefined
        ? { property, keyNode }
        : '*'],
      element.dotDotDotToken === undefined ? channel : `${channel}:rest`,
      file,
      output,
    );
  }
}

function lowerAssignmentPattern(pattern, source, projection, channel, file, output) {
  if (ts.isArrayLiteralExpression(pattern)) {
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const spread = ts.isSpreadElement(element);
      addLeaf(
        spread ? element.expression : element,
        source,
        [...projection, spread ? '*' : index],
        spread ? `${channel}:rest` : channel,
        file,
        output,
      );
    });
    return;
  }
  for (const property of pattern.properties) {
    if (ts.isSpreadAssignment(property)) {
      addLeaf(
        property.expression,
        source,
        [...projection, '*'],
        `${channel}:rest`,
        file,
        output,
      );
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      addLeaf(
        property.name,
        source,
        [...projection, { property: property.name.text }],
        channel,
        file,
        output,
      );
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = literalProperty(property.name);
    const keyNode = ts.isComputedPropertyName(property.name)
      ? property.name.expression
      : undefined;
    addLeaf(
      property.initializer,
      source,
      [...projection, { property: propertyName, keyNode }],
      channel,
      file,
      output,
    );
  }
}

export function lowerTarget(target, source, projection, channel, file, output) {
  const current = unwrapTarget(defaultTarget(target));
  if (ts.isIdentifier(current)
    || ts.isPropertyAccessExpression(current)
    || ts.isElementAccessExpression(current)) {
    addLeaf(current, source, projection, channel, file, output);
    return;
  }
  if (ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current)) {
    lowerBindingPattern(current, source, projection, channel, file, output);
    return;
  }
  if (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current)) {
    lowerAssignmentPattern(current, source, projection, channel, file, output);
    return;
  }
  output.unsupported.push({
    kind: 'UNSUPPORTED_TARGET',
    target: current,
    source,
    channel,
    file,
    node: current,
  });
}

export function normalizeProgram(sourceFiles) {
  const output = {
    bindings: [],
    writes: [],
    calls: [],
    unsupported: [],
  };
  for (const file of sourceFiles) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) {
        lowerTarget(node.name, node.initializer, [], 'declaration', file.fileName, output);
      }
      if (ts.isParameter(node)) {
        lowerTarget(node.name, node.initializer, [], 'parameter', file.fileName, output);
      }
      if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
        lowerTarget(
          node.variableDeclaration.name,
          undefined,
          [],
          'catch',
          file.fileName,
          output,
        );
      }
      if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
        lowerTarget(
          node.left,
          node.right,
          [],
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ? 'assignment'
            : 'compound-assignment',
          file.fileName,
          output,
        );
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken
          || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        lowerTarget(node.operand, node.operand, [], 'update', file.fileName, output);
      }
      if (ts.isDeleteExpression(node)) {
        lowerTarget(node.expression, undefined, [], 'delete', file.fileName, output);
      }
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const channel = ts.isForOfStatement(node) ? 'for-of' : 'for-in';
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const declaration of node.initializer.declarations) {
            lowerTarget(declaration.name, node.expression, [], channel, file.fileName, output);
          }
        } else {
          lowerTarget(node.initializer, node.expression, [], channel, file.fileName, output);
        }
      }
      if (ts.isCallExpression(node)
        || ts.isNewExpression(node)
        || ts.isTaggedTemplateExpression(node)) {
        output.calls.push({
          kind: ts.isCallExpression(node)
            ? 'CALL'
            : ts.isNewExpression(node)
              ? 'CONSTRUCT'
              : 'TAG',
          node,
          file: file.fileName,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return output;
}
