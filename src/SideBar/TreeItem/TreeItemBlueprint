'use strict';

const vscode = require('vscode');

class TreeItemBlueprint
{
    constructor(label, id, contextValue, settings = {})
    {
        if (typeof label !== 'string')
        {
            throw new TypeError('Tree item label must be a string.');
        }

        if (typeof id !== 'string')
        {
            throw new TypeError('Tree item ID must be a string.');
        }

        if (typeof contextValue !== 'string')
        {
            throw new TypeError('Tree item context must be a string.');
        }

        this.Label = label;
        this.Id = id;
        this.ContextValue = contextValue;
        this.CollapsibleState = settings.CollapsibleState ?? vscode.TreeItemCollapsibleState.None;
        this.Description = settings.Description;
        this.Tooltip = settings.Tooltip;
        this.Command = settings.Command;
        this.IconId = settings.IconId;

        Object.freeze(this);
    }
}

module.exports = { TreeItemBlueprint };