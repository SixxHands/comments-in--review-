'use strict';

class TreeDataProviderBlueprint
{
    constructor(getResults, onDidTreeChange, mode = 'pending')
    {
        if (typeof getResults !== 'function')
        {
            throw new TypeError('GetResults must be a function.');
        }

        if (typeof onDidTreeChange !== 'function')
        {
            throw new TypeError('OnDidTreeChange must be a function.');
        }

        if (mode !== 'pending' && mode !== 'approved')
        {
            throw new RangeError('Mode must be pending, or approved');
        }

        this.GetResults = getResults;
        this.OnDidChangeTreeData = onDidTreeChange;
        this.Mode = mode;

        Object.freeze(this);
    }
}

module.exports = { TreeDataProviderBlueprint };