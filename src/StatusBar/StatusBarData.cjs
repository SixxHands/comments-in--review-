'use strict'

const vscode = require('vscode');

class StatusBarData
{
    constructo(
        command,
        text,
        alignment = vscode.StatusBarAlignment.Left, 
        priority = 20
    )
    {
        this.Command = command;
        this.Text = text;
        this.Alginment = alignment;
        this.priority = priority;

        Object.freeze(this);

    }
}

module.exports = { StatusBarData };