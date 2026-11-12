// Wraps a screen's visible English text in t("…") so it can be translated (a one-off helper; see src/i18n.ts).
// Uses TypeScript's own parser, so only text the person sees is touched:
//   - text between tags:                 <p>Hello</p>              → <p>{t("Hello")}</p>
//   - placeholder / title / aria-label / alt / label / note attributes
//   - text chosen in {…}:                {busy ? "Saving…" : "Save"} → {busy ? t("Saving…") : t("Save")}
//   - messages: setError("…"), setNotice/setSaved/setMessage("…"), confirm("…"), alert("…"), new Error("…")
//   - `…${x}…` in those places becomes t("…{x}…", { x })
// Everything else (class names, keys, values sent to the server) is left alone.
// Run: node scripts/i18n/wrap.mjs src/components/SomeScreen.tsx [more files…]
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { createRequire } from "node:module";

// TypeScript's classic parser API (TypeScript 7, which builds this project, doesn't have it): TS5_PATH points to a
// TypeScript 5 install, e.g. TS5_PATH=/tmp/ts5/node_modules/typescript.
const ts = createRequire(import.meta.url)(process.env.TS5_PATH ?? "typescript");

const ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label", "note", "summary", "hint"]);
const CALLS = new Set(["setError", "setNotice", "setSaved", "setMessage", "setStatus", "setInfo", "confirm", "alert", "prompt", "setDone", "setNote", "setWarning", "setHint", "setFeedback", "setToast", "setSavedNote"]);
const hasWords = (s) => /[A-Za-z]{2,}/.test(s);
const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/&middot;/g, "·");

function wrapFile(file) {
  const code = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // `t` is taken (a trip, a parameter…)? Then the function is tr().
  let tTaken = false;
  const seeDecl = (n) => {
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === "t") tTaken = true;
    ts.forEachChild(n, seeDecl);
  };
  seeDecl(sf);
  const alreadyImported = /from "(\.\.?\/)+i18n\.ts"/.test(code);
  const importedAs = code.match(/import \{[^}]*\bt as (\w+)/)?.[1] ?? (alreadyImported && /import \{[^}]*\bt\b[^}]*\} from "(\.\.?\/)+i18n\.ts"/.test(code) ? "t" : undefined);
  const T = importedAs ?? (tTaken ? "tr" : "t");

  const edits = []; // { start, end, text }
  const skipped = [];

  const isCallT = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "t" || n.expression.text === "tr" || n.expression.text === "tn");

  /** "…" or `…${x}…` → t(…) source, or undefined if it isn't text to translate. */
  const asT = (lit) => {
    if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
      if (!hasWords(lit.text)) return undefined;
      return `${T}(${JSON.stringify(lit.text)})`;
    }
    if (ts.isTemplateExpression(lit)) {
      let text = lit.head.text;
      const vars = [];
      const used = new Set();
      for (const span of lit.templateSpans) {
        const e = span.expression;
        let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined;
        if (!name || used.has(name) || !/^[a-zA-Z]\w*$/.test(name)) name = `v${vars.length + 1}`;
        used.add(name);
        vars.push([name, e.getText(sf)]);
        text += `{${name}}${span.literal.text}`;
      }
      if (!hasWords(text.replace(/\{\w+\}/g, ""))) return undefined;
      const obj = vars.map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(", ");
      return `${T}(${JSON.stringify(text)}, { ${obj} })`;
    }
    return undefined;
  };

  /** A literal whose value is shown: directly, or picked by ?: / && / || / ?? (in parentheses or not). */
  const wrapShown = (expr) => {
    if (!expr) return;
    if (ts.isParenthesizedExpression(expr)) return wrapShown(expr.expression);
    if (ts.isConditionalExpression(expr)) {
      wrapShown(expr.whenTrue);
      wrapShown(expr.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) {
      if (expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) wrapShown(expr.left);
      wrapShown(expr.right);
      return;
    }
    const out = asT(expr);
    if (out) edits.push({ start: expr.getStart(sf), end: expr.getEnd(), text: out });
  };

  // A sentence with values in it stays one text: <p>Day {n} of {total}</p> → <p>{t("Day {n} of {total}", { n, total })}</p>.
  // (Translations need whole sentences: word order differs between languages.) Elements in it (<b>, <a>…) end it.
  const merged = new Set();
  const containsJsx = (e) => {
    let found = false;
    const look = (x) => {
      if (found) return;
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) found = true;
      else ts.forEachChild(x, look);
    };
    look(e);
    return found;
  };
  const isValue = (child) => ts.isJsxExpression(child) && child.expression && !containsJsx(child.expression) && !isCallT(child.expression);
  const nameFor = (e, used) => {
    let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isCallExpression(e) && ts.isIdentifier(e.expression) ? e.expression.text : undefined;
    if (ts.isStringLiteral(e) && e.text === " ") return null; // {" "}: just a space
    if (!name || used.has(name) || !/^[a-zA-Z]\w*$/.test(name)) name = `v${used.size + 1}`;
    used.add(name);
    return name;
  };
  const mergeRuns = (parent) => {
    const kids = parent.children;
    let run = [];
    const flush = () => {
      const texts = run.filter((k) => ts.isJsxText(k) && hasWords(k.getText(sf)) && !/[{}]/.test(k.getText(sf)));
      const values = run.filter((k) => isValue(k) && !(ts.isStringLiteral(k.expression) && k.expression.text === " "));
      if (texts.length && values.length) {
        const used = new Set();
        const vars = [];
        let text = "";
        for (const k of run) {
          if (ts.isJsxText(k)) text += decode(code.slice(k.pos, k.end).replace(/\s*\n\s*/g, (m) => (m.includes("\n") ? " " : m)));
          else {
            const e = k.expression;
            const name = nameFor(e, used);
            if (name === null) {
              text += " ";
              continue;
            }
            // A value that's itself words picked by ?: ("item" : "items") is translated too.
            let src = e.getText(sf);
            if (ts.isConditionalExpression(e) && asT(e.whenTrue) && asT(e.whenFalse)) src = `${e.condition.getText(sf)} ? ${asT(e.whenTrue)} : ${asT(e.whenFalse)}`;
            vars.push([name, src]);
            text += `{${name}}`;
          }
        }
        // JSX drops whitespace with line breaks at the ends; keep plain spaces outside the text.
        const first = run[0];
        const last = run[run.length - 1];
        const lead = text.match(/^\s*/)[0];
        const trail = text.match(/\s*$/)[0];
        const body = text.trim().replace(/\s+/g, " ");
        const firstRaw = ts.isJsxText(first) ? code.slice(first.pos, first.end) : "";
        const lastRaw = ts.isJsxText(last) ? code.slice(last.pos, last.end) : "";
        const before = firstRaw.match(/^\s*/)?.[0].includes("\n") ? firstRaw.match(/^\s*/)[0] : lead ? `{" "}` : "";
        const after = lastRaw.match(/\s*$/)?.[0].includes("\n") ? lastRaw.match(/\s*$/)[0] : trail ? `{" "}` : "";
        const obj = vars.map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(", ");
        edits.push({ start: first.pos, end: last.end, text: `${before}{${T}(${JSON.stringify(body)}, { ${obj} })}${after}` });
        for (const k of run) merged.add(k);
      }
      run = [];
    };
    for (const k of kids) {
      if (ts.isJsxText(k) || isValue(k)) run.push(k);
      else flush();
    }
    flush();
  };

  const visit = (n) => {
    if (merged.has(n)) return;
    if (isCallT(n)) return; // already done
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) mergeRuns(n);
    // Text between tags.
    if (ts.isJsxText(n)) {
      const raw = code.slice(n.pos, n.end); // with its leading spaces, which matter
      if (hasWords(raw)) {
        if (/[{}]/.test(raw)) skipped.push(raw.trim());
        else {
          const lead = raw.match(/^\s*/)[0];
          const trail = raw.match(/\s*$/)[0];
          const body = decode(raw.slice(lead.length, raw.length - trail.length).split(/\s*\n\s*/).join(" "));
          // Whitespace with a line break is dropped by JSX (keep the layout of the code); without one, it's a space.
          const before = lead.includes("\n") ? lead : lead ? `{" "}` : "";
          const after = trail.includes("\n") ? trail : trail ? `{" "}` : "";
          edits.push({ start: n.pos, end: n.end, text: `${before}{${T}(${JSON.stringify(body)})}${after}` });
        }
      }
      return;
    }
    // Attributes people read.
    if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const init = n.initializer;
      if (ts.isStringLiteral(init)) {
        if (hasWords(init.text)) edits.push({ start: init.getStart(sf), end: init.getEnd(), text: `{${T}(${JSON.stringify(init.text)})}` });
      } else if (ts.isJsxExpression(init)) wrapShown(init.expression);
      return;
    }
    // Text shown in {…} between tags.
    if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      wrapShown(n.expression);
      ts.forEachChild(n, visit);
      return;
    }
    // Messages.
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments?.length) {
      const callee = n.expression.getText(sf);
      const name = callee.split(".").pop();
      if (CALLS.has(name) || (ts.isNewExpression(n) && callee === "Error")) wrapShown(n.arguments[0]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  if (!edits.length) return { file, count: 0, skipped };
  // Apply from the end, skipping any edit inside another.
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  let lastStart = Infinity;
  let count = 0;
  for (const e of edits) {
    if (e.end > lastStart) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
    count++;
  }
  if (!alreadyImported) {
    const depth = relative("src", file).split("/").length - 1;
    const path = `${depth ? "../".repeat(depth) : "./"}i18n.ts`;
    const imp = T === "t" ? `import { t } from "${path}";\n` : `import { t as tr } from "${path}";\n`;
    // After the last import.
    const lastImport = [...out.matchAll(/^import [^;]+;\n/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    out = out.slice(0, at) + imp + out.slice(at);
  }
  writeFileSync(file, out);
  return { file, count, skipped, T };
}

for (const f of process.argv.slice(2)) {
  const r = wrapFile(f);
  console.log(`${r.file}: ${r.count} wrapped${r.T === "tr" ? " (as tr)" : ""}${r.skipped.length ? `; check by hand: ${r.skipped.map((s) => JSON.stringify(s.slice(0, 50))).join(", ")}` : ""}`);
}
