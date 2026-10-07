'use strict'

const vscode = require('vscode');

class StatusBarData
{
    construct(
        command,
        text,
        alignment = vscode.StatusBarAlignment.Left, 
        priority = 20
    )
    {
        this.Command = command;
        this.Text = text;
        this.Alignment = alignment;
        this.Priority = priority;

        Object.freeze(this);

    }
}

module.exports = { StatusBarData };