//Hi yes Im making code

'use strict';

const vscode = require('vscode');

class IParseData
{
    static Create(data)
    {
        const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
        
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
            
        }

        const languages = new Map();

        const language = extensions[path.extname(file).slice(1).toLowerCase()];
        // Some languages represent documentation as executable attributes, not comments. I want them to be reviewed.
        const attributeDoc =
        [
            'annotation',
            'marker_annotation',
            'attribute_list',
            'attribute_item',
            'decorator',
        ].includes(node.type) || (language === 'elixir' && /^@(module|type)?doc\b/.test(node.text)) || (language === 'rust' && node.type === 'attribute_item' && /\bdoc\s*=/.test(node.text));
    }
}

module.exports = { StatusBarFactory };