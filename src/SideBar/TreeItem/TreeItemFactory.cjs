'use strict';

const vscode = require('vscode');

class TreeItemFactory
{
    static Create(blueprint)
    {
        const treeItem = new vscode.TreeItem
        (
            blueprint.Label,
            blueprint.CollapsibleState
        );

        treeItem.id = blueprint.Id;
        treeItem.contextValue = blueprint.ContextValue;
        treeItem.description = blueprint.Description;
        treeItem.tooltip = blueprint.Tooltip;
        treeItem.command = blueprint.Command;

        if (blueprint.IconId !== undefined)
        {
            treeItem.iconPath = new vscode.ThemeIcon(blueprint.IconId);
        }

        return treeItem;
    }
}

module.exports = { TreeItemFactory };