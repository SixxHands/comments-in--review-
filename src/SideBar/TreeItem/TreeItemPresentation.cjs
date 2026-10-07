'use strict';

const vscode = require('vscode');
const { TreeItemBlueprint } = require('./TreeItemBlueprint.cjs');

class TreeItemPresentation
{
    static Describe(item)
    {
        if (item.type === 'file')
        {
            return TreeItemPresentation.DescribeFile(item.r);
        }

        return TreeItemPresentation.DescribeEntry(item);
    }

    static DescribeFile(result)
    {
        const descriptions =
        [
            { Matches: result.error, Text: 'Cannot inspect' },
            { Matches: result.approved, Text: 'Approved' },
            { Matches: result.mode === 'whole-file', Text: 'Full-file review' },
            { Matches: true, Text: 'Needs review' }
        ];

        return new TreeItemBlueprint
        (
            result.file, `file:${result.file}`, 'reviewFile',
            {
                CollapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                Description: descriptions.find(entry => entry.Matches).Text,
                Tooltip: result.error || result.reason ||
                    'Source comments and documentation'
            }
        );
    }

    static DescribeEntry(item)
    {
        const id = `${item.r.file}:${item.type}:${item.i?.index ?? item.label}`;

        if (item.type !== 'comment')
        {
            const contextValue = item.type === 'removal' ? 'removal' : 'error';
            return new TreeItemBlueprint(item.label, id, contextValue);
        }

        const comment = item.i;
        const details =
        [
            comment.reason,
            comment.approvalSource ? `Linked: ${comment.approvalSource}` : null,
            comment.symbol
        ];

        return new TreeItemBlueprint
        (
            item.label, id, 'comment',
            {
                Description: details.filter(Boolean).join(' · '),
                Tooltip: comment.text,
                IconId: comment.approved ? 'pass' : 'comment-discussion',
                Command:
                {
                    command: 'commentsInReview.open',
                    title: 'Open',
                    arguments: [item]
                }
            }
        );
    }
}

module.exports = { TreeItemPresentation };
