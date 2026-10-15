'use strict';

const { TreeItemPresentation } = require('../TreeItem/TreeItemPresentation.cjs');
const { TreeItemFactory } = require('../TreeItem/TreeItemFactory.cjs');
const { get } = require('axios');

class TreeDataProvider
{
    getParent(item)
    {
        if (item.type === 'file')
        {
            return undefined;
        }

        return { type: 'file', r: item.r };
    }

    getTreeItem(item)
    {
        const blueprint = TreeItemPresentation.Describe(item);

        return TreeItemFactory.Create(blueprint);
    
    }
}

module.exports = { TreeDataProvider };