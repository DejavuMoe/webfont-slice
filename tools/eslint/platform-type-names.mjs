import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const platformLibraryPattern = /^lib\.(?:dom|webworker)(?:\.[^.]+)*\.d\.ts$/u;
const requiredLibraries = ['lib.dom.d.ts', 'lib.webworker.d.ts'];
const requiredTypeNames = [
  'BodyInit',
  'EventListener',
  'RequestInfo',
  'ServiceWorkerGlobalScope',
  'Transferable',
];

function addBindingName(names, node) {
  if (ts.isIdentifier(node)) {
    names.add(node.text);
    return;
  }
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const element of node.elements) {
      if (ts.isBindingElement(element)) addBindingName(names, element.name);
    }
  }
}

function collectDeclarations(names, statements) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBindingName(names, declaration.name);
      }
      continue;
    }

    if (ts.isModuleDeclaration(statement)) {
      if (
        (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0 &&
        statement.body !== undefined
      ) {
        const body = statement.body;
        if (ts.isModuleBlock(body)) collectDeclarations(names, body.statements);
        else collectDeclarations(names, [body]);
      } else {
        addBindingName(names, statement.name);
      }
      continue;
    }

    if (
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      if (statement.name !== undefined) addBindingName(names, statement.name);
    }
  }
}

export function loadPlatformTypeNames() {
  const libraryDirectory = path.dirname(
    ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }),
  );
  const libraryFiles = fs
    .readdirSync(libraryDirectory)
    .filter((name) => platformLibraryPattern.test(name))
    .sort();

  for (const requiredLibrary of requiredLibraries) {
    if (!libraryFiles.includes(requiredLibrary)) {
      throw new Error(`TypeScript 平台类型库缺失：${requiredLibrary}`);
    }
  }

  const names = new Set();
  for (const libraryFile of libraryFiles) {
    const sourceFile = ts.createSourceFile(
      libraryFile,
      fs.readFileSync(path.join(libraryDirectory, libraryFile), 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    collectDeclarations(names, sourceFile.statements);
  }

  for (const requiredName of requiredTypeNames) {
    if (!names.has(requiredName)) {
      throw new Error(`TypeScript 平台类型声明提取不完整：${requiredName}`);
    }
  }

  return [...names].sort();
}
