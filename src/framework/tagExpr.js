function tokenize(input) {
  const s = String(input || '').trim();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push(c); i++; continue; }
    // words like and/or/not or tag names
    let j = i;
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '(' && s[j] !== ')') j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

function parseExpr(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Invalid tag expression (unexpected end)');
    if (t === '(') {
      take();
      const e = parseOr();
      if (peek() !== ')') throw new Error('Invalid tag expression (missing ")")');
      take();
      return e;
    }
    if (String(t).toLowerCase() === 'not') {
      take();
      return { type: 'not', expr: parsePrimary() };
    }
    // tag token: allow @smoke or smoke
    take();
    const tag = t.startsWith('@') ? t.slice(1) : t;
    return { type: 'tag', tag };
  }

  function parseAnd() {
    let left = parsePrimary();
    while (true) {
      const t = peek();
      if (!t) break;
      if (String(t).toLowerCase() !== 'and') break;
      take();
      left = { type: 'and', left, right: parsePrimary() };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (true) {
      const t = peek();
      if (!t) break;
      if (String(t).toLowerCase() !== 'or') break;
      take();
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new Error(`Invalid tag expression near: ${tokens.slice(pos).join(' ')}`);
  return ast;
}

function compileTagExpr(expr) {
  if (!expr || !String(expr).trim()) {
    // empty expr => include everything
    return () => true;
  }
  const tokens = tokenize(expr);
  const ast = parseExpr(tokens);

  function evalAst(node, tagSet) {
    switch (node.type) {
      case 'tag':
        return tagSet.has(String(node.tag).toLowerCase());
      case 'not':
        return !evalAst(node.expr, tagSet);
      case 'and':
        return evalAst(node.left, tagSet) && evalAst(node.right, tagSet);
      case 'or':
        return evalAst(node.left, tagSet) || evalAst(node.right, tagSet);
      default:
        throw new Error(`Unknown AST node: ${node.type}`);
    }
  }

  return (tags) => {
    const tagSet = new Set((tags || []).map(t => String(t).toLowerCase()));
    return evalAst(ast, tagSet);
  };
}

module.exports = { compileTagExpr };


