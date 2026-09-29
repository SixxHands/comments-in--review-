// SPDX-License-Identifier: BUSL-1.1
'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const Parser = require('web-tree-sitter');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const extensions = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'tsx',
  ts: 'typescript',
  tsx: 'tsx',
  java: 'java',
  cs: 'c_sharp',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  scala: 'scala',
  sc: 'scala',
  dart: 'dart',
  sh: 'bash',
  bash: 'bash',
  lua: 'lua',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  ps1: 'powershell',
  psm1: 'powershell',
  vue: 'vue',
  svelte: 'svelte',
  ml: 'ocaml',
  mli: 'ocaml',
  r: 'r',
};
const languages = new Map();
let ready;
async function extract(file, source) {
  if (source.includes('\0'))
    throw new Error(
      `${file}: binary content needs an explicit scope exclusion`,
    );
  if (Buffer.byteLength(source) > 4 * 1024 * 1024)
    throw new Error(
      `${file}: exceeds the 4 MiB parser limit; narrow the review scope`,
    );
  const language = extensions[path.extname(file).slice(1).toLowerCase()];
  if (
    ['html', 'vue', 'php'].includes(language) &&
    /<(script|style)|<\?php/i.test(source)
  )
    return manual(source, 'Mixed-language file; review all embedded content');
  if (!language)
    return manual(source, 'No bundled grammar; review the complete file');
  ready ||= Parser.init();
  await ready;
  let grammar = languages.get(language);
  if (!grammar) {
    const wasm = path.join(
      __dirname,
      '../node_modules/tree-sitter-wasms/out',
      `tree-sitter-${language}.wasm`,
    );
    try {
      grammar = await Parser.Language.load(wasm);
      languages.set(language, grammar);
    } catch {
      return manual(
        source,
        `No compatible ${language} grammar; review the complete file`,
      );
    }
  }
  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);
  try {
    if (tree.rootNode.hasError)
      return manual(
        source,
        'Parser reported syntax errors; review the complete file',
      );
    const ranges = [];
    function visit(node) {
      const comment = /comment/.test(node.type);
      const docstring =
        language === 'python' &&
        node.type === 'expression_statement' &&
        ['string', 'concatenated_string'].includes(
          node.namedChildren[0]?.type,
        ) &&
        node.parent?.namedChildren.find((n) => !/comment/.test(n.type))?.id ===
          node.id;
      // Some languages represent documentation as executable attributes, not comments. I want them to be reviewed.
      const attributeDoc =
        [
          'annotation',
          'marker_annotation',
          'attribute_list',
          'attribute_item',
          'decorator',
        ].includes(node.type) ||
        (language === 'elixir' && /^@(module|type)?doc\b/.test(node.text)) ||
        (language === 'rust' &&
          node.type === 'attribute_item' &&
          /\bdoc\s*=/.test(node.text));
      if (comment || docstring || attributeDoc) {
        ranges.push({
          start: node.startIndex,
          end: node.endIndex,
          line: node.startPosition.row,
          endLine: node.endPosition.row,
          kind: docstring
            ? 'docstring'
            : attributeDoc
              ? 'documentation attribute'
              : /^\s*(\/\*\*|\/\/[/!]|\/\*!)/.test(node.text)
                ? 'documentation'
                : 'comment',
        });
      } else for (const child of node.namedChildren) visit(child);
    }
    visit(tree.rootNode);
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
      const prev = merged.at(-1);
      if (
        prev &&
        r.line <= prev.endLine + 1 &&
        /^\s*$/.test(source.slice(prev.end, r.start)) &&
        r.kind === prev.kind
      ) {
        prev.end = r.end;
        prev.endLine = r.endLine;
      } else merged.push({ ...r });
    }
    const tokens = [];
    function codeTokens(n) {
      if (
        merged.some(
          (r) =>
            r.kind !== 'documentation attribute' &&
            n.startIndex >= r.start &&
            n.endIndex <= r.end,
        )
      )
        return;
      if (!n.children.length) tokens.push([n.type, n.text, n.endIndex]);
      else for (const c of n.children) codeTokens(c);
    }
    codeTokens(tree.rootNode);
    return {
      language,
      mode: 'parsed',
      codeHash: hash(JSON.stringify(tokens.map((t) => t.slice(0, 2)))),
      items: merged.map((r, index) => ({
        ...r,
        index,
        anchorHash: hash(String(tokens.filter((t) => t[2] <= r.start).length)),
        text: source.slice(r.start, r.end),
      })),
    };
  } finally {
    tree.delete();
    parser.delete();
  }
}
function manual(source, reason) {
  return {
    language: 'manual',
    mode: 'whole-file',
    reason,
    codeHash: hash(source),
    items: [
      {
        index: 0,
        anchorHash: hash('whole-file'),
        start: 0,
        end: source.length,
        line: 0,
        endLine: source.split('\n').length - 1,
        kind: 'whole-file review',
        text: source,
      },
    ],
  };
}
module.exports = { extract, hash, extensions };
