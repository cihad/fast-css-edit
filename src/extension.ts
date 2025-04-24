import * as vscode from "vscode";
import * as path from "path";
import {
  StyleFileInfo,
  ClassAttributeDetails,
  findStyleFile,
  findOrCreateClassRuleAndGetRange,
  findClassAttributeDetails,
  getCssRuleContent,
  findAndDeleteCssRuleBlock,
} from "./utils";

export function activate(context: vscode.ExtensionContext) {
  console.log('"fast-css-edit" with Delete Rule feature is now active!');

  const supportedLanguages = [
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "html" },
  ];

  const definitionProvider = vscode.languages.registerDefinitionProvider(
    supportedLanguages,
    new CssDefinitionProvider()
  );

  const hoverProvider = vscode.languages.registerHoverProvider(
    supportedLanguages,
    new CssHoverProvider()
  );

  const deleteCommand = vscode.commands.registerCommand(
    "fast-css-edit.deleteCssRule",
    async (args: {
      styleUriFsPath: string;
      className: string;
      componentUriFsPath: string;
      componentClassRange: vscode.Range;
    }) => {
      if (
        !args ||
        !args.styleUriFsPath ||
        !args.className ||
        !args.componentUriFsPath ||
        !args.componentClassRange
      ) {
        vscode.window.showErrorMessage(
          "[Fast CSS Edit] Invalid arguments for delete command (missing component info)."
        );
        return;
      }

      const styleUri = vscode.Uri.file(args.styleUriFsPath);
      const componentUri = vscode.Uri.file(args.componentUriFsPath);
      // Deserialize the plain object range back into a vscode.Range
      const componentClassRange = new vscode.Range(
        new vscode.Position(
          args.componentClassRange.start.line,
          args.componentClassRange.start.character
        ),
        new vscode.Position(
          args.componentClassRange.end.line,
          args.componentClassRange.end.character
        )
      );

      console.log(
        `[Fast CSS Edit] Delete command invoked for: .${args.className} in ${styleUri.fsPath} and class in ${componentUri.fsPath}`
      );

      const confirmation = await vscode.window.showWarningMessage(
        `Are you sure you want to delete the CSS rule ".${
          args.className
        }" from ${path.basename(styleUri.fsPath)} AND remove the class "${
          args.className
        }" from ${path.basename(componentUri.fsPath)}?`,
        { modal: true },
        "Yes, Delete Both"
      );

      if (confirmation === "Yes, Delete Both") {
        let ruleDeleted = false;
        let classRemoved = false;
        try {
          // 1. Delete CSS Rule
          ruleDeleted = await findAndDeleteCssRuleBlock(
            styleUri,
            args.className
          );
          if (ruleDeleted) {
            console.log(
              `[Fast CSS Edit] Rule ".${args.className}" deleted from ${styleUri.fsPath}.`
            );
          } else {
            console.log(
              `[Fast CSS Edit] Rule ".${args.className}" not found in ${styleUri.fsPath}, proceeding to remove class from component.`
            );
            // Allow proceeding even if rule wasn't found, maybe it was already deleted
            ruleDeleted = true; // Treat as handled for messaging purposes
          }

          // 2. Remove Class Name from Component if rule deletion was successful (or rule wasn't found)
          if (ruleDeleted) {
            const edit = new vscode.WorkspaceEdit();
            const componentDoc = await vscode.workspace.openTextDocument(
              componentUri
            );

            // --- Logic adapted from removeClassNameFromAttribute ---
            let rangeToDelete = componentClassRange;
            let removedSpace = false;
            const text = componentDoc.getText(); // Get full text once

            // Check preceding space
            if (componentClassRange.start.character > 0) {
              const charBeforePos = componentClassRange.start.translate(0, -1);
              const rangeBefore = new vscode.Range(
                charBeforePos,
                componentClassRange.start
              );
              if (componentDoc.getText(rangeBefore) === " ") {
                rangeToDelete = new vscode.Range(
                  rangeBefore.start,
                  componentClassRange.end
                );
                removedSpace = true;
                console.log(
                  "[Fast CSS Edit] Including preceding space in component deletion."
                );
              }
            }

            // Check trailing space if preceding wasn't removed
            if (!removedSpace) {
              const charAfterPos = componentClassRange.end;
              const rangeAfter = new vscode.Range(
                charAfterPos,
                charAfterPos.translate(0, 1)
              );
              // Ensure rangeAfter is within document bounds before checking text
              if (
                rangeAfter.end.isBeforeOrEqual(
                  componentDoc.lineAt(rangeAfter.end.line).range.end
                )
              ) {
                if (componentDoc.getText(rangeAfter) === " ") {
                  rangeToDelete = new vscode.Range(
                    componentClassRange.start,
                    rangeAfter.end
                  );
                  removedSpace = true;
                  console.log(
                    "[Fast CSS Edit] Including trailing space in component deletion."
                  );
                }
              }
            }
            // --- End of adapted logic ---

            console.log(
              `[Fast CSS Edit] Attempting to delete range in component: Line ${rangeToDelete.start.line}, Chars ${rangeToDelete.start.character}-${rangeToDelete.end.character}`
            );
            edit.delete(componentUri, rangeToDelete);
            classRemoved = await vscode.workspace.applyEdit(edit);

            if (classRemoved) {
              console.log(
                `[Fast CSS Edit] Class "${args.className}" removed from ${componentUri.fsPath}.`
              );
            } else {
              console.error(
                `[Fast CSS Edit] Failed to apply edit to remove class "${args.className}" from ${componentUri.fsPath}.`
              );
            }
          }

          // 3. Show final message
          if (ruleDeleted && classRemoved) {
            vscode.window.showInformationMessage(
              `CSS rule ".${args.className}" and class "${args.className}" deleted successfully.`
            );
          } else if (ruleDeleted && !classRemoved) {
            vscode.window.showWarningMessage(
              `CSS rule ".${args.className}" deleted, but failed to remove class "${args.className}" from the component.`
            );
          } else {
            // This case shouldn't happen if ruleDeleted is true before attempting class removal
            vscode.window.showErrorMessage(
              `Failed to delete CSS rule ".${args.className}". Class was not removed.`
            );
          }
        } catch (error: any) {
          vscode.window.showErrorMessage(
            `[Fast CSS Edit] Error during delete operation: ${error.message}`
          );
          console.error(
            "[Fast CSS Edit] Error executing delete command:",
            error
          );
        }
      } else {
        console.log(
          "[Fast CSS Edit] Rule and class deletion cancelled by user."
        );
      }
    }
  );

  const removeClassCommand = vscode.commands.registerCommand(
    "fast-css-edit.removeClass",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found.");
        return;
      }

      const document = editor.document;
      const position = editor.selection.active;
      const config = vscode.workspace.getConfiguration("fast-css-edit");
      const cssModuleIdentifier = config.get<string>(
        "cssModuleIdentifier",
        "styles"
      );
      const customRegexStr = config.get<string>("classNameExtractionRegex");

      const classDetails = findClassAttributeDetails(
        document,
        position,
        cssModuleIdentifier,
        customRegexStr
      );

      if (!classDetails) {
        vscode.window.showInformationMessage(
          "No CSS class found at the cursor position."
        );
        return;
      }

      console.log(
        `[Fast CSS Edit] Remove command initiated for: "${classDetails.className}"`
      );

      let styleFileInfo: StyleFileInfo | undefined;
      try {
        styleFileInfo = await findStyleFile(
          document,
          classDetails.className,
          classDetails.isModule,
          classDetails.moduleIdentifier || cssModuleIdentifier,
          config
        );
      } catch (error: any) {
        console.warn(
          `[Fast CSS Edit] Error finding style file (proceeding with component removal attempt): ${error.message}`
        );
      }

      let confirmation: string | undefined;
      if (!styleFileInfo) {
        console.log(
          "[Fast CSS Edit] Style file not found or determined for removal. Proceeding to remove class from component only."
        );
        confirmation = await vscode.window.showWarningMessage(
          `Style rule/file for ".${classDetails.className}" not found. Do you want to remove the class "${classDetails.className}" from the current file only?`,
          { modal: true },
          "Yes, Remove Class"
        );
        if (confirmation !== "Yes, Remove Class") {
          console.log(
            "[Fast CSS Edit] Class removal cancelled by user (style file not found)."
          );
          return;
        }
      } else {
        confirmation = await vscode.window.showWarningMessage(
          `Are you sure you want to remove the class "${
            classDetails.className
          }" from this file AND delete the rule ".${
            styleFileInfo.className
          }" from ${path.basename(styleFileInfo.uri.fsPath)}?`,
          { modal: true },
          "Yes, Remove Both"
        );
        if (confirmation !== "Yes, Remove Both") {
          console.log(
            "[Fast CSS Edit] Class and rule removal cancelled by user."
          );
          return;
        }
      }

      let ruleDeletedHandled = false;
      let classRemoved = false;

      try {
        if (styleFileInfo && confirmation === "Yes, Remove Both") {
          try {
            const deleted = await findAndDeleteCssRuleBlock(
              styleFileInfo.uri,
              styleFileInfo.className
            );
            if (deleted) {
              console.log(
                `[Fast CSS Edit] Rule ".${styleFileInfo.className}" deleted from ${styleFileInfo.uri.fsPath}`
              );
              ruleDeletedHandled = true;
            } else {
              console.log(
                `[Fast CSS Edit] Rule ".${styleFileInfo.className}" not found in ${styleFileInfo.uri.fsPath}, but proceeding.`
              );
              ruleDeletedHandled = true;
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Error deleting CSS rule: ${error.message}`
            );
            console.error(
              "[Fast CSS Edit] Error in findAndDeleteCssRuleBlock:",
              error
            );
          }
        } else if (!styleFileInfo && confirmation === "Yes, Remove Class") {
          ruleDeletedHandled = true;
        }

        if (ruleDeletedHandled) {
          classRemoved = await removeClassNameFromAttribute(
            editor,
            classDetails
          );
          if (classRemoved) {
            console.log(
              `[Fast CSS Edit] Class "${classDetails.className}" removed from ${document.uri.fsPath}`
            );
          } else {
            console.log(
              `[Fast CSS Edit] Failed to remove class "${classDetails.className}" from component.`
            );
          }
        }

        if (
          classRemoved &&
          styleFileInfo &&
          ruleDeletedHandled &&
          confirmation === "Yes, Remove Both"
        ) {
          vscode.window.showInformationMessage(
            `Class "${classDetails.className}" and its CSS rule deleted.`
          );
        } else if (
          classRemoved &&
          !styleFileInfo &&
          ruleDeletedHandled &&
          confirmation === "Yes, Remove Class"
        ) {
          vscode.window.showInformationMessage(
            `Class "${classDetails.className}" removed from the component.`
          );
        } else if (
          !classRemoved &&
          styleFileInfo &&
          ruleDeletedHandled &&
          confirmation === "Yes, Remove Both"
        ) {
          vscode.window.showWarningMessage(
            `CSS rule for ".${styleFileInfo.className}" deleted, but failed to remove class "${classDetails.className}" from the component.`
          );
        } else if (!classRemoved && !ruleDeletedHandled) {
          vscode.window.showErrorMessage(
            `Failed to remove CSS rule. Class "${classDetails.className}" was not removed from the component.`
          );
        } else if (
          classRemoved &&
          styleFileInfo &&
          ruleDeletedHandled &&
          confirmation !== "Yes, Remove Both"
        ) {
          console.warn(
            "[Fast CSS Edit] Inconsistent state after removal attempt."
          );
        } else {
          console.warn(
            `[Fast CSS Edit] Could not complete the removal process for "${classDetails.className}". Class removed: ${classRemoved}, Rule handled: ${ruleDeletedHandled}`
          );
          if (
            confirmation === "Yes, Remove Both" ||
            confirmation === "Yes, Remove Class"
          ) {
            vscode.window.showWarningMessage(
              `Could not complete the removal process for "${classDetails.className}".`
            );
          }
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Error removing class: ${error.message}`
        );
        console.error(
          "[Fast CSS Edit] Error during removeClass command:",
          error
        );
      }
    }
  );

  context.subscriptions.push(
    definitionProvider,
    hoverProvider,
    deleteCommand,
    removeClassCommand
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("fast-css-edit")) {
        console.log("[Fast CSS Edit] Configuration changed.");
      }
    })
  );
}

async function removeClassNameFromAttribute(
  editor: vscode.TextEditor,
  classDetails: ClassAttributeDetails
): Promise<boolean> {
  return editor.edit(
    (editBuilder) => {
      const document = editor.document;
      const classRange = classDetails.range;

      let rangeToDelete = classRange;
      let removedSpace = false;

      if (classRange.start.character > 0) {
        const charBeforePos = classRange.start.translate(0, -1);
        const rangeBefore = new vscode.Range(charBeforePos, classRange.start);
        if (document.getText(rangeBefore) === " ") {
          rangeToDelete = new vscode.Range(rangeBefore.start, classRange.end);
          removedSpace = true;
          console.log("[Fast CSS Edit] Including preceding space in deletion.");
        }
      }

      if (!removedSpace) {
        const charAfterPos = classRange.end;
        const rangeAfter = new vscode.Range(
          charAfterPos,
          charAfterPos.translate(0, 1)
        );
        if (
          rangeAfter.end.isBeforeOrEqual(
            document.lineAt(rangeAfter.end.line).range.end
          )
        ) {
          if (document.getText(rangeAfter) === " ") {
            rangeToDelete = new vscode.Range(classRange.start, rangeAfter.end);
            removedSpace = true;
            console.log(
              "[Fast CSS Edit] Including trailing space in deletion."
            );
          }
        }
      }

      console.log(
        `[Fast CSS Edit] Attempting to delete range in component: Line ${rangeToDelete.start.line}, Chars ${rangeToDelete.start.character}-${rangeToDelete.end.character}`
      );
      editBuilder.delete(rangeToDelete);
    },
    { undoStopBefore: false, undoStopAfter: true }
  );
}

export function deactivate() {
  console.log('"fast-css-edit" is now deactivated.');
}

class CssDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
    const config = vscode.workspace.getConfiguration("fast-css-edit");
    const cssModuleIdentifier = config.get<string>(
      "cssModuleIdentifier",
      "styles"
    );
    const customRegexStr = config.get<string>("classNameExtractionRegex");

    const classDetails = findClassAttributeDetails(
      document,
      position,
      cssModuleIdentifier,
      customRegexStr
    );
    if (!classDetails || token.isCancellationRequested) {
      return undefined;
    }
    console.log(
      `[Fast CSS Edit] Definition requested for: "${classDetails.className}"`
    );

    const styleFileInfo = await findStyleFile(
      document,
      classDetails.className,
      classDetails.isModule,
      classDetails.moduleIdentifier || cssModuleIdentifier,
      config
    );
    if (!styleFileInfo || token.isCancellationRequested) {
      console.log(
        "[Fast CSS Edit] Style file could not be determined for definition."
      );
      return undefined;
    }
    console.log(
      `[Fast CSS Edit] Target style file URI for definition: ${styleFileInfo.uri.fsPath}`
    );

    try {
      const { targetRange } = await findOrCreateClassRuleAndGetRange(
        styleFileInfo.uri,
        styleFileInfo.className,
        config.get<boolean>("enableFileCreation", true)
      );
      if (token.isCancellationRequested) {
        return undefined;
      }

      console.log(
        `[Fast CSS Edit] Returning definition location: ${styleFileInfo.uri.fsPath} at range ${targetRange.start.line}:${targetRange.start.character}`
      );
      return new vscode.Location(styleFileInfo.uri, targetRange);
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `[Fast CSS Edit] Error processing style rule - ${error.message}`
      );
      console.error("[Fast CSS Edit] Error in provideDefinition:", error);
      return undefined;
    }
  }
}

class CssHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const config = vscode.workspace.getConfiguration("fast-css-edit");
    const cssModuleIdentifier = config.get<string>(
      "cssModuleIdentifier",
      "styles"
    );
    const customRegexStr = config.get<string>("classNameExtractionRegex");

    const classDetails = findClassAttributeDetails(
      document,
      position,
      cssModuleIdentifier,
      customRegexStr
    );
    if (!classDetails || token.isCancellationRequested) {
      return undefined;
    }

    const styleFileInfo = await findStyleFile(
      document,
      classDetails.className,
      classDetails.isModule,
      classDetails.moduleIdentifier || cssModuleIdentifier,
      config
    );
    if (!styleFileInfo || token.isCancellationRequested) {
      return undefined;
    }

    const ruleContent = await getCssRuleContent(
      styleFileInfo.uri,
      classDetails.className
    );
    if (token.isCancellationRequested) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString("", true);
    markdown.supportHtml = true;
    markdown.isTrusted = true;

    if (ruleContent) {
      const lang = path.extname(styleFileInfo.uri.fsPath).substring(1) || "css";
      const maxLines = 10;
      const lines = ruleContent.split("\n");
      let displayContent = ruleContent;
      if (lines.length > maxLines) {
        displayContent = lines.slice(0, maxLines).join("\n") + "\n...";
      }
      markdown.appendCodeblock(displayContent, lang);
      markdown.appendMarkdown("\n\n");

      const deleteArgsObj = {
        styleUriFsPath: styleFileInfo.uri.fsPath,
        className: classDetails.className, // Use the class name found in the component
        componentUriFsPath: document.uri.fsPath,
        componentClassRange: classDetails.range,
      };
      const deleteArgs = encodeURIComponent(JSON.stringify(deleteArgsObj));
      const deleteCommandUri = vscode.Uri.parse(
        `command:fast-css-edit.deleteCssRule?${deleteArgs}`
      );

      // Use the component's class name for the tooltip
      markdown.appendMarkdown(
        `[🗑️ Delete Rule & Class](${deleteCommandUri} "Delete the CSS rule for .${styleFileInfo.className} and remove '${classDetails.className}' from this file")`
      );
    } else {
      markdown.appendText(
        `CSS rule for ".${classDetails.className}" not found in ${path.basename(
          styleFileInfo.uri.fsPath
        )}.`
      );
      markdown.appendMarkdown("\n\n");
    }

    return new vscode.Hover(markdown, classDetails.range);
  }
}
