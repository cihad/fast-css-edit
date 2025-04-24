import * as vscode from "vscode";
import * as path from "path";

export interface StyleFileInfo {
  uri: vscode.Uri;
  className: string;
  isModule: boolean;
}

export interface ClassAttributeDetails {
  className: string;
  isModule: boolean;
  moduleIdentifier?: string;
  range: vscode.Range;
}

export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPositionAt(text: string, offset: number): vscode.Position {
  offset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastLineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      lastLineStart = i + 1;
    }
  }
  return new vscode.Position(line, offset - lastLineStart);
}

function getOffsetAt(text: string, position: vscode.Position): number {
  let offset = 0;
  const lines = text.split("\n");
  const lineCount = lines.length;
  for (let i = 0; i < position.line && i < lineCount; i++) {
    offset += lines[i].length + 1;
  }
  if (position.line < lineCount) {
    offset += Math.max(
      0,
      Math.min(position.character, lines[position.line].length)
    );
  } else if (lineCount > 0) {
    offset = text.length;
  }
  return Math.min(offset, text.length);
}

function getLineCount(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      count++;
    }
  }
  return count;
}

export function findClassAttributeDetails(
  document: vscode.TextDocument,
  position: vscode.Position,
  cssModuleIdentifier: string,
  customRegexStr?: string | null
): ClassAttributeDetails | undefined {
  console.log(
    `[Fast CSS Edit] findClassAttributeDetails: Checking position ${position.line}:${position.character}`
  );
  const lineText = document.lineAt(position.line).text;

  const stringAttrRegex = /(class(?:Name)?)\s*=\s*(["'])(.*?)\2/g;
  const moduleAttrRegex = /(className)\s*=\s*\{(.*?)\}/g;

  let potentialMatch: ClassAttributeDetails | undefined = undefined;

  let match;
  while ((match = stringAttrRegex.exec(lineText)) !== null) {
    if (potentialMatch) {
      break;
    }

    const attrName = match[1];
    const quote = match[2];
    const attrValue = match[3];
    const attrStartIndex = match.index;
    const valueStartIndex = attrStartIndex + attrName.length + 1 + quote.length;
    const valueEndIndex = valueStartIndex + attrValue.length;

    console.log(
      `[Fast CSS Edit] Found string attribute: ${attrName}=${quote}${attrValue}${quote} (Value range: ${valueStartIndex}-${valueEndIndex})`
    );

    if (
      position.character >= valueStartIndex &&
      position.character <= valueEndIndex
    ) {
      console.log(
        `[Fast CSS Edit] Position ${position.character} is inside the value range.`
      );
      const wordRange = document.getWordRangeAtPosition(position, /[\w_-]+/);

      if (wordRange && !wordRange.isEmpty) {
        const clickedWord = document.getText(wordRange);
        console.log(
          `[Fast CSS Edit] Potential word detected: "${clickedWord}"`
        );
        const classesInAttribute = attrValue.split(/\s+/);

        if (classesInAttribute.includes(clickedWord)) {
          console.log(
            `[Fast CSS Edit] Confirmed "${clickedWord}" is a valid class within "${attrValue}".`
          );
          potentialMatch = {
            className: clickedWord,
            isModule: false,
            range: wordRange,
          };
          break;
        } else {
          console.log(
            `[Fast CSS Edit] "${clickedWord}" not found directly in split classes: [${classesInAttribute.join(
              ", "
            )}]`
          );
        }
      } else {
        console.log(
          "[Fast CSS Edit] No specific word range found at cursor position within the string value."
        );
      }
    } else {
      console.log(
        `[Fast CSS Edit] Position ${position.character} is outside the value range ${valueStartIndex}-${valueEndIndex}.`
      );
    }
  }

  if (!potentialMatch) {
    while ((match = moduleAttrRegex.exec(lineText)) !== null) {
      if (potentialMatch) {
        break;
      }

      const attrName = match[1];
      const attrValueContent = match[2].trim();
      const attrStartIndex = match.index;
      const valueStartIndex = attrStartIndex + attrName.length + 2;
      const valueEndIndex = attrStartIndex + match[0].length - 1;

      console.log(
        `[Fast CSS Edit] Found module attribute: ${attrName}={${attrValueContent}} (Value range: ${valueStartIndex}-${valueEndIndex})`
      );

      if (
        position.character >= valueStartIndex &&
        position.character <= valueEndIndex
      ) {
        console.log(
          `[Fast CSS Edit] Position ${position.character} is inside the module value range.`
        );
        const wordRange = document.getWordRangeAtPosition(
          position,
          /[\w._'\[\]"-]+/
        );

        if (wordRange && !wordRange.isEmpty) {
          const clickedExpression = document.getText(wordRange);
          console.log(
            `[Fast CSS Edit] Potential expression (module context): "${clickedExpression}"`
          );

          const moduleDotMatch = clickedExpression.match(
            new RegExp(`^${escapeRegExp(cssModuleIdentifier)}\\.([\\w_-]+)$`)
          );
          const moduleBracketMatch =
            clickedExpression.match(
              new RegExp(
                `^${escapeRegExp(cssModuleIdentifier)}\\['([\\w_-]+)'\\]$`
              )
            ) ||
            clickedExpression.match(
              new RegExp(
                `^${escapeRegExp(cssModuleIdentifier)}\\["([\\w_-]+)"\\]$`
              )
            );

          let actualClassName: string | null = null;
          let matchedModuleIdentifier: string | null = null;

          if (moduleDotMatch) {
            actualClassName = moduleDotMatch[1];
            matchedModuleIdentifier = cssModuleIdentifier;
          } else if (moduleBracketMatch) {
            actualClassName = moduleBracketMatch[1];
            matchedModuleIdentifier = cssModuleIdentifier;
          }

          if (actualClassName && matchedModuleIdentifier) {
            console.log(
              `[Fast CSS Edit] Matched module class: "${actualClassName}" with identifier "${matchedModuleIdentifier}".`
            );
            potentialMatch = {
              className: actualClassName,
              isModule: true,
              moduleIdentifier: matchedModuleIdentifier,
              range: wordRange,
            };
            break;
          } else {
            console.log(
              `[Fast CSS Edit] "${clickedExpression}" does not match simple module format.`
            );
          }
        } else {
          console.log(
            "[Fast CSS Edit] No specific word range found at cursor position within the module value."
          );
        }
      } else {
        console.log(
          `[Fast CSS Edit] Position ${position.character} is outside the module value range ${valueStartIndex}-${valueEndIndex}.`
        );
      }
    }
  }

  if (potentialMatch) {
    console.log(
      "[Fast CSS Edit] findClassAttributeDetails returning:",
      potentialMatch
    );
  } else {
    console.log("[Fast CSS Edit] No valid class attribute details found.");
  }
  return potentialMatch;
}

export async function findStyleFile(
  doc: vscode.TextDocument,
  className: string,
  isModule: boolean,
  cssModuleIdentifier: string,
  config: vscode.WorkspaceConfiguration
): Promise<StyleFileInfo | undefined> {
  console.log(
    `[Fast CSS Edit] findStyleFile: Searching for class "${className}", isModule=${isModule}, identifier=${cssModuleIdentifier}`
  );
  const docPath = doc.uri.fsPath;
  const docDir = path.dirname(docPath);
  const docExt = path.extname(docPath);
  const docName = path.basename(docPath, docExt);

  const moduleImportRegex = new RegExp(
    `import\\s+(?:(?:\\*\\s+as\\s+(\\w+))|(\\w+)|(?:\\{\\s*.*\\s*\\}))\\s+from\\s+['"](\\.[./\\w-]+(\\.(?:css|scss|sass|less|styl)))['"]`,
    "g"
  );
  const globalImportRegex =
    /import\s+['"](\.[./\\w-]+(\.(?:css|scss|sass|less|styl)))['"]/g;
  const text = doc.getText();
  let match;

  if (isModule) {
    while ((match = moduleImportRegex.exec(text)) !== null) {
      const importedIdentifier = match[1] || match[2];
      if (importedIdentifier === cssModuleIdentifier) {
        const relativePath = match[3];
        try {
          const absolutePath = path.resolve(docDir, relativePath);
          const targetUri = vscode.Uri.file(absolutePath);
          console.log(
            `[Fast CSS Edit] Found potential matching module import: ${relativePath} for identifier ${cssModuleIdentifier}`
          );
          return { uri: targetUri, className: className, isModule: true };
        } catch (error: any) {
          console.error(
            `[Fast CSS Edit] Error resolving path ${relativePath}: ${error.message}`
          );
        }
      }
    }
  }

  if (!isModule) {
    while ((match = globalImportRegex.exec(text)) !== null) {
      const relativePath = match[1];
      try {
        const absolutePath = path.resolve(docDir, relativePath);
        const targetUri = vscode.Uri.file(absolutePath);
        console.log(
          `[Fast CSS Edit] Found potential global style import: ${relativePath}`
        );
        return { uri: targetUri, className: className, isModule: false };
      } catch (error: any) {
        console.error(
          `[Fast CSS Edit] Error resolving path ${relativePath}: ${error.message}`
        );
      }
    }
  }

  console.log(
    "[Fast CSS Edit] No matching import found. Determining path based on convention."
  );
  const defaultExt = config.get<string>("defaultStyleExtension", "module.css");
  const namingConvention = config.get<string>(
    "styleFileNamingConvention",
    "{componentName}"
  );
  const conventionReplaced = namingConvention.replace(
    "{componentName}",
    docName
  );
  const styleFileName = conventionReplaced.endsWith(`.${defaultExt}`)
    ? conventionReplaced
    : `${conventionReplaced}.${defaultExt}`;
  const stylePath = path.join(docDir, styleFileName);
  const styleUri = vscode.Uri.file(stylePath);

  console.log(
    `[Fast CSS Edit] Assuming style file based on convention: ${stylePath}`
  );
  const defaultIsModule = defaultExt.includes(".module.");
  return { uri: styleUri, className: className, isModule: defaultIsModule };
}

export async function findOrCreateClassRuleAndGetRange(
  styleUri: vscode.Uri,
  className: string,
  enableFileCreation: boolean
): Promise<{ targetRange: vscode.Range; fileWasCreated: boolean }> {
  console.log(
    `[Fast CSS Edit] findOrCreateClassRuleAndGetRange: Processing URI ${styleUri.fsPath} for class "${className}"`
  );
  let fileContent = "";
  let fileExists = false;
  let fileWasCreated = false;

  try {
    const fileStat = await vscode.workspace.fs.stat(styleUri);
    if (fileStat.type === vscode.FileType.File) {
      const readData = await vscode.workspace.fs.readFile(styleUri);
      fileContent = Buffer.from(readData).toString("utf8");
      fileExists = true;
    } else {
      throw new Error(`Not a file: ${styleUri.fsPath}`);
    }
  } catch (error: any) {
    if (
      error.code === "FileNotFound" ||
      (error instanceof vscode.FileSystemError && error.code === "FileNotFound")
    ) {
      if (!enableFileCreation) {
        throw new Error(
          `File not found & creation disabled: ${styleUri.fsPath}`
        );
      }
      await vscode.workspace.fs.writeFile(styleUri, new Uint8Array());
      fileContent = "";
      fileExists = true;
      fileWasCreated = true;
      console.log(`[Fast CSS Edit] Created style file: ${styleUri.fsPath}`);
    } else {
      throw new Error(`Error accessing file: ${error.message}`);
    }
  }

  const classRegex = new RegExp(
    `(^|\\s|\\})\\.${escapeRegExp(className)}\\s*\\{`,
    "m"
  );
  const match = classRegex.exec(fileContent);
  let targetPosition: vscode.Position;

  if (match) {
    const ruleStartIndex = match.index + match[1].length;
    const openBraceIndex = fileContent.indexOf("{", ruleStartIndex);

    if (openBraceIndex > -1) {
      let closingBraceIndex = -1;
      let braceLevel = 0;
      for (let i = openBraceIndex + 1; i < fileContent.length; i++) {
        if (fileContent[i] === "{") {
          braceLevel++;
        } else if (fileContent[i] === "}") {
          if (braceLevel === 0) {
            closingBraceIndex = i;
            break;
          } else {
            braceLevel--;
          }
        }
      }

      if (closingBraceIndex > -1) {
        targetPosition = getPositionAt(fileContent, closingBraceIndex);
        console.log(
          `[Fast CSS Edit] Found existing rule for .${className}. Targeting position just before '}' at ${targetPosition.line}:${targetPosition.character}.`
        );
      } else {
        console.warn(
          `[Fast CSS Edit] Could not find matching closing brace. Placing cursor after opening brace.`
        );
        targetPosition = getPositionAt(fileContent, openBraceIndex + 1);
      }
    } else {
      console.warn(
        `[Fast CSS Edit] Could not find opening brace. Placing cursor at rule start.`
      );
      targetPosition = getPositionAt(fileContent, ruleStartIndex);
    }

    return {
      targetRange: new vscode.Range(targetPosition, targetPosition),
      fileWasCreated: false,
    };
  } else {
    console.log(
      `[Fast CSS Edit] Rule for .${className} not found in ${styleUri.fsPath}. Appending.`
    );
    const prefix =
      fileContent.length === 0 ? "" : fileContent.endsWith("\n") ? "" : "\n";
    const ruleToAdd = `${prefix}\n.${className} {\n\t\n}\n`;
    const newContent = fileContent + ruleToAdd;

    try {
      await vscode.workspace.fs.writeFile(
        styleUri,
        Buffer.from(newContent, "utf8")
      );
      console.log(
        `[Fast CSS Edit] Appended rule for .${className} and saved file.`
      );
      const newLines = newContent.split("\n");
      const targetLineIndex = Math.max(0, newLines.length - 3);
      targetPosition = new vscode.Position(targetLineIndex, 1);
      return {
        targetRange: new vscode.Range(targetPosition, targetPosition),
        fileWasCreated: fileWasCreated,
      };
    } catch (writeError: any) {
      console.error(
        `[Fast CSS Edit] Failed to save changes to ${styleUri.fsPath}: ${writeError.message}`
      );
      throw new Error(`Failed to save new rule: ${writeError.message}`);
    }
  }
}

export async function getCssRuleContent(
  styleUri: vscode.Uri,
  className: string
): Promise<string | undefined> {
  console.log(
    `[Fast CSS Edit] getCssRuleContent: Reading ${styleUri.fsPath} for class "${className}"`
  );
  let fileContent: string;
  try {
    const readData = await vscode.workspace.fs.readFile(styleUri);
    fileContent = Buffer.from(readData).toString("utf8");
  } catch (error) {
    console.log(
      `[Fast CSS Edit] Cannot read ${styleUri.fsPath} for hover: ${error}`
    );
    return undefined;
  }

  const ruleRegex = new RegExp(
    `(^|\\s|\\})\\.${escapeRegExp(className)}\\s*\\{([^}]*?)\\}`,
    "m"
  );
  const match = ruleRegex.exec(fileContent);

  if (match) {
    const fullRuleText = `.${className} {${match[2].trim()}}`;
    console.log(`[Fast CSS Edit] Found rule content for .${className}`);
    return fullRuleText;
  } else {
    console.log(
      `[Fast CSS Edit] Rule .${className} not found in ${styleUri.fsPath} for hover content.`
    );
    return undefined;
  }
}

async function findCssRuleRange(
  styleUri: vscode.Uri,
  className: string
): Promise<vscode.Range | undefined> {
  let fileContent: string;
  try {
    const readData = await vscode.workspace.fs.readFile(styleUri);
    fileContent = Buffer.from(readData).toString("utf8");
  } catch (error) {
    console.log(
      `[Fast CSS Edit] Cannot read ${styleUri.fsPath} to find rule range: ${error}`
    );
    return undefined;
  }

  const startRegex = new RegExp(
    `(^|\\s|\\})\\s*\\.${escapeRegExp(className)}\\s*\\{`,
    "m"
  );
  const match = startRegex.exec(fileContent);

  if (!match) {
    console.log(`[Fast CSS Edit] Start of rule .${className} not found.`);
    return undefined;
  }

  const ruleActualStartIndex = match.index + match[1].length;
  const ruleContentStartIndex = match.index + match[0].length;
  let ruleEndIndex = -1;

  let braceLevel = 0;
  for (let i = ruleContentStartIndex; i < fileContent.length; i++) {
    if (fileContent[i] === "{") {
      braceLevel++;
    } else if (fileContent[i] === "}") {
      if (braceLevel === 0) {
        ruleEndIndex = i;
        break;
      } else {
        braceLevel--;
      }
    }
  }

  if (ruleEndIndex === -1) {
    console.log(
      `[Fast CSS Edit] Could not find matching closing brace for rule .${className}.`
    );
    return undefined;
  }

  let finalStartIndex = ruleActualStartIndex;
  while (finalStartIndex > 0 && /\s/.test(fileContent[finalStartIndex - 1])) {
    finalStartIndex--;
  }

  let finalEndOffset = ruleEndIndex + 1;
  while (
    finalEndOffset < fileContent.length &&
    /\s/.test(fileContent[finalEndOffset])
  ) {
    finalEndOffset++;
  }

  const startPosition = getPositionAt(fileContent, finalStartIndex);
  const endPosition = getPositionAt(fileContent, finalEndOffset);

  console.log(
    `[Fast CSS Edit] Found range for deletion of rule .${className}: ${startPosition.line}:${startPosition.character} to ${endPosition.line}:${endPosition.character}`
  );
  return new vscode.Range(startPosition, endPosition);
}

export async function findAndDeleteCssRuleBlock(
  styleUri: vscode.Uri,
  className: string
): Promise<boolean> {
  console.log(
    `[Fast CSS Edit] Attempting to delete rule ".${className}" from ${styleUri.fsPath}`
  );

  const ruleRange = await findCssRuleRange(styleUri, className);

  if (!ruleRange) {
    console.log(
      `[Fast CSS Edit] Rule range for ".${className}" not found. Cannot delete.`
    );
    return false;
  }

  try {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(styleUri, ruleRange);
    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      console.log(
        `[Fast CSS Edit] Successfully applied edit to delete range for ".${className}".`
      );
      try {
        const doc = await vscode.workspace.openTextDocument(styleUri);
        await doc.save();
        console.log(
          `[Fast CSS Edit] Saved file ${styleUri.fsPath} after deletion.`
        );
      } catch (saveError: any) {
        console.error(
          `[Fast CSS Edit] Failed to save file after deletion: ${saveError.message}`
        );
      }
      return true;
    } else {
      console.error(
        `[Fast CSS Edit] Failed to apply workspace edit for deletion.`
      );
      throw new Error("VS Code failed to apply the deletion edit.");
    }
  } catch (error: any) {
    console.error(
      `[Fast CSS Edit] Error applying delete edit: ${error.message}`
    );
    throw error;
  }
}
