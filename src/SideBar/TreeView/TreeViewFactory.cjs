'use strict';

const vscode = require('vscode');

class TreeViewFactory
{
    static Create(data)
    {
        return vscode.window.createTreeView
        (
            data.Id,
            {
                treeDataProvider : data.treeDataProvider
            }
        );
    }
}

module.exports = { TreeViewFactory };