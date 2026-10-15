'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const Parser = require('web-tree-sitter');
const languages = new Map();

class ParseFactory
{
    const extensions = 
    {
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
}