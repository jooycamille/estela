// Lists English text in the app that isn't wrapped in t() yet (a helper for translating; see src/i18n.ts).
// Prints file:line and the text. Leaves out what isn't shown to people: imports, class names, links, ids, keys,
// comparisons (x === "car"), switch cases, and text already in t()/tr()/tn().
// Run: TS5_PATH=…/typescript node scripts/i18n/audit.mjs src/components/*.tsx
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)(process.env.TS5_PATH ?? "typescript");
const QUIET_ATTRS = new Set(["className", "href", "src", "type", "id", "key", "role", "rel", "target", "name", "autoComplete", "inputMode", "lang", "htmlFor", "method", "accept", "download", "pattern", "loading", "dir", "data-day", "aria-hidden", "aria-haspopup", "aria-live", "aria-current", "kind", "icon", "variant", "size", "mode", "value"]);
const words = (s) => /[A-Za-z]{2,}/.test(s) && /[A-Za-z]{3,}.*\s|^[A-Z][a-z]{2,}/.test(s) && !/^[a-z0-9_-]+$/.test(s) && !/^(https?:|\/|#|\.\/|[a-z]+\/[a-z])/.test(s);

for (const file of process.argv.slice(2)) {
  const code = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (n, text) => console.log(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${JSON.stringify(text).slice(0, 110)}`);
  const inT = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ["t", "tr", "tn"].includes(p.expression.text)) return true;
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ["includes", "startsWith", "endsWith", "test", "match", "replace", "querySelector", "querySelectorAll", "getItem", "setItem", "removeItem", "get", "has", "addEventListener", "removeEventListener", "dispatchEvent"].includes(p.expression.name.text)) return true;
    }
    return false;
  };
  const quiet = (n) => {
    const p = n.parent;
    if (!p) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p)) return true;
    if (ts.isPropertyAssignment(p) && p.name === n) return true;
    if (ts.isJsxAttribute(p) && QUIET_ATTRS.has(p.name.getText(sf))) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
    if (ts.isElementAccessExpression(p)) return true;
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ["fetch", "request", "require", "matchMedia", "Symbol"].includes(p.expression.text)) return true;
    if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && ["RegExp", "URL", "Intl", "Date", "CustomEvent", "Event"].includes(p.expression.text)) return true;
    if (ts.isPropertyAssignment(p) && ["className", "key", "id", "kind", "type", "icon", "href", "url", "value"].includes(p.name.getText(sf))) return true;
    return inT(n);
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) {
      const s = n.getText(sf).trim();
      if (/[A-Za-z]{2,}/.test(s)) report(n, s);
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && words(n.text) && !quiet(n)) report(n, n.text);
    else if (ts.isTemplateExpression(n) && !quiet(n)) {
      const s = n.head.text + n.templateSpans.map((x) => `{…}${x.literal.text}`).join("");
      if (words(s.replace(/\{…\}/g, ""))) report(n, s);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
