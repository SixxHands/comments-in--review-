'use strict'

class TreeViewData
{
    constructor(id, treeDataProvider)
    {
        this.Id = id;
        this.treeDataProvider = treeDataProvider;

        Object.freeze(this);
    }
}

module.exports = { TreeViewData };