'use strict';

const vscode = require('vscode');

class TreeItemFactory
{
    static Create(item)
    {
        const t = new vscode.TreeItem(
                item.label,
                vscode.TreeItemCollapsibleState.None,
              );
              t.id =
                item.r.file + ':' + item.type + ':' + (item.i?.index ?? item.label);
              t.contextValue =
                item.type === 'removal'
                  ? 'removal'
                  : item.type === 'comment'
                    ? 'comment'
                    : 'error';
              if (item.type === 'comment') {
                t.description = [
                  item.i.reason,
                  item.i.approvalSource ? 'Linked: ' + item.i.approvalSource : null,
                  item.i.symbol,
                ]
                  .filter(Boolean)
                  .join(' · ');
                t.tooltip = item.i.text;
                t.command = {
                  command: 'commentsInReview.open',
                  title: 'Open',
                  arguments: [item],
                };
                t.iconPath = new vscode.ThemeIcon(
                  item.i.approved ? 'pass' : 'comment-discussion',
                );
              }

              return TreeItemFactory;
    }
}

module.exports = { TreeItemFactory }