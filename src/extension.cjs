// SPDX-License-Identifier: BUSL-1.1
'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
const review = require('./comments-in-review.cjs');
const navigation = require('./navigation.cjs');
const { TreeItemPresentation } = require('./SideBar/TreeItem/TreeItemPresentation.cjs');
const { TreeItemFactory } = require('./SideBar/TreeItem/TreeItemFactory.cjs');
function activateCommentsInReview(context) 
{
    let root = null,
    results = [],
    visibleResults = [],
    generation = 0,
    timer,
    branchWatcher,
    watchedHead;
    const emitter = new vscode.EventEmitter();
    const output = vscode.window.createOutputChannel('Comments In (Review)');
    const virtual = new Map();
    const contentProvider = {
    provideTextDocumentContent: (uri) => virtual.get(uri.toString()) || '',
};
    function uri(label, text) 
    {
        const u = vscode.Uri.parse
        (
            'comments-in-review:/' + encodeURIComponent(label) + '?' + Date.now() + Math.random(),
        );
    virtual.set(u.toString(), text);
    return u;
    }

    async function guard(fn) 
    {
        try 
        {
            if (!vscode.workspace.isTrusted)
                throw new Error
                (
                    'Trust this workspace before reviewing or installing hooks',
                );
                    
                await fn();
        } 
            
        catch (e) 
        {
            vscode.window.showErrorMessage('Comments In (Review): ' + e.message);
        }
    }

    async function chooseRoot() 
    {
        const folders = vscode.workspace.workspaceFolders || [];
        if (!folders.length)
            throw new Error('Open a local Git project in VS Code first');
        const selected =
            folders.length === 1 ? folders[0] : await vscode.window.showQuickPick
            (
                folders.map((f) => ({ label: f.name, folder: f })),
            );
        if (!selected) return null;
        
        return repo.rootAt((selected.folder || selected).uri.fsPath);
    }

    async function refresh() 
    {
        if (!root) return;
        const headPath = path.resolve
        (
            root,
            repo.git(root, ['rev-parse', '--git-path', 'HEAD']).trim(),
        );

        if (watchedHead !== headPath) 
        {
            branchWatcher?.dispose();
            branchWatcher = vscode.workspace.createFileSystemWatcher
            (
                new vscode.RelativePattern
                (
                    path.dirname(headPath),
                    path.basename(headPath),
                ),
            );
            context.subscriptions.push
            (
                branchWatcher,
                branchWatcher.onDidChange(schedule),
                branchWatcher.onDidCreate(schedule),
            );

            watchedHead = headPath;
        }

        store.ensureContext(root);
    
        const current = ++generation;
        const next = await review.scan(root);
        if (current !== generation) return;
        
        const visible = await navigation.discover
        (
            vscode,
            root,
            next,
            store.load(root),
        );

        if (current !== generation) return;

        results = next;
        visibleResults = visible;
    }
};