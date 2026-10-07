//Hi yes Im making code

'use strict';

const vscode = require('vscode');

class StatusBarFactory 
{
    static Create(data)
    {
        const statusBar = vscode.window.createStatusBarItem(
            data.Aligment,
            data.Priority
        );

        statusBar.command = data.command;
        statusBar.text = data.Text;

        return statusBar;
    }
}

module.exports = { StatusBarFactory };