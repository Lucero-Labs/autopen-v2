// Enforces the checkable half of STYLES §5 over every package and app source.
//
//   missing-jsdoc       an exported declaration with no /** */ contract
//   restating-summary   a JSDoc whose first sentence only restates the name —
//                       `/** The policy gate. */` above `PolicyGate`
//   todo-without-issue  a TODO that does not cite an issue as TODO(#N)
//
// Whether a summary *states the contract* is still judged by review; this only
// catches the forms a machine can be certain about, so it has no false positives
// to argue with. Parsing goes through the TypeScript compiler rather than a
// regex, because a JSDoc belongs to a declaration, not to a line.
//
// Usage: node scripts/check-docs.mjs

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Source that ships. Tests are exempt from missing-jsdoc — an `it` is its own
// documentation — but not from the TODO rule, which is about tracking work.
const SOURCE_DIRS = ["src", "web"];
const TEST_DIRS = ["test"];
const SKIPPED = new Set(["node_modules", "dist", "dist-browser", ".turbo"]);

const ARTICLES = new Set(["the", "a", "an"]);

function listTypeScript(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScript(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function workspaceRoots() {
  return ["packages", "apps"].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(ROOT, group, entry.name)),
  );
}

function isExported(statement) {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The names a statement exports, or none when it is not a documentable declaration. */
function declaredNames(statement) {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((declaration) => declaration.name)
      .filter(ts.isIdentifier)
      .map((name) => name.text);
  }
  return [];
}

function jsDocsOf(statement) {
  return (statement.jsDoc ?? []).filter((doc) => ts.isJSDoc(doc));
}

function words(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

function firstSentence(doc) {
  const comment = ts.getTextOfJSDocComment(doc.comment) ?? "";
  return comment.split(/(?<=[.!?])\s/)[0] ?? "";
}

/** True when a summary is the identifier re-spelled, give or take an article. */
function restates(summary, name) {
  const said = words(summary);
  while (said.length > 0 && ARTICLES.has(said[0])) said.shift();
  const named = words(name);
  return said.length > 0 && said.join(" ") === named.join(" ");
}

function commentRanges(source) {
  const text = source.getFullText();
  const seen = new Map();
  const visit = (node) => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
    ]) {
      seen.set(range.pos, range);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Comments after the last token belong to no node; the end-of-file token holds them.
  for (const range of ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()) ?? []) {
    seen.set(range.pos, range);
  }
  return [...seen.values()];
}

function check(path, { requireDocs }) {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];

  const report = (position, rule, message) => {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    findings.push(`${relative(ROOT, path)}:${line + 1}:${character + 1}  ${rule}  ${message}`);
  };

  if (requireDocs) {
    for (const statement of source.statements) {
      if (!isExported(statement)) continue;
      const names = declaredNames(statement);
      if (names.length === 0) continue;

      const docs = jsDocsOf(statement);
      const doc = docs.at(-1);
      if (doc === undefined || (ts.getTextOfJSDocComment(doc.comment) ?? "").trim() === "") {
        report(statement.getStart(source), "missing-jsdoc", `\`${names.join(", ")}\` is exported without a contract`);
        continue;
      }
      const summary = firstSentence(doc);
      if (names.some((name) => restates(summary, name))) {
        report(doc.getStart(source), "restating-summary", `"${summary}" restates \`${names[0]}\``);
      }
    }
  }

  for (const range of commentRanges(source)) {
    const comment = text.slice(range.pos, range.end);
    for (const match of comment.matchAll(/\bTODO\b(?!\(#\d+\))/g)) {
      report(range.pos + match.index, "todo-without-issue", "write it as TODO(#N): …");
    }
  }

  return findings;
}

const findings = workspaceRoots().flatMap((workspace) => [
  ...SOURCE_DIRS.flatMap((dir) => listTypeScript(join(workspace, dir))).flatMap((path) =>
    check(path, { requireDocs: true }),
  ),
  ...TEST_DIRS.flatMap((dir) => listTypeScript(join(workspace, dir))).flatMap((path) =>
    check(path, { requireDocs: false }),
  ),
]);

for (const finding of findings) console.error(finding);
if (findings.length > 0) {
  console.error(`\ncheck-docs: ${findings.length} finding(s) — STYLES §5`);
  process.exitCode = 1;
} else {
  console.log("check-docs: ok");
}
