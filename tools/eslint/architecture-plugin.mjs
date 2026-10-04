import path from 'node:path';

const sourceRoot = path.resolve(import.meta.dirname, '..', '..', 'src');

function importSourceValue(node) {
  if (node === null || node === undefined) return null;
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function packageName(specifier) {
  const segments = specifier.replaceAll('\\', '/').split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

function resolveSourceImport(filename, specifier) {
  const cleanSpecifier = specifier.replace(/[?#].*$/u, '');
  const portableSpecifier = cleanSpecifier.replaceAll('\\', '/');
  let resolved;
  if (portableSpecifier.startsWith('@/')) {
    resolved = path.resolve(sourceRoot, portableSpecifier.slice(2));
  } else if (portableSpecifier.startsWith('src/')) {
    resolved = path.resolve(sourceRoot, portableSpecifier.slice(4));
  } else if (portableSpecifier.startsWith('.') || portableSpecifier.startsWith('/')) {
    resolved = path.resolve(path.dirname(filename), portableSpecifier);
  } else {
    return null;
  }

  const relative = path.relative(sourceRoot, resolved);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return { outsideSource: true, relative: null, root: null };
  }

  const normalized = relative.split(path.sep).join('/');
  return {
    outsideSource: false,
    relative: normalized,
    root: normalized.split('/')[0] ?? null,
  };
}

const sourceLayersRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce fail-closed source-layer imports, including dynamic imports.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPackages: { type: 'array', items: { type: 'string' } },
          allowedSourceFiles: { type: 'array', items: { type: 'string' } },
          allowedSourcePaths: { type: 'array', items: { type: 'string' } },
          allowedSourceRoots: { type: 'array', items: { type: 'string' } },
          forbiddenPackages: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      boundary:
        '当前层不得导入 "{{specifier}}"（解析到 src/{{target}}"）。请通过 core contract、application port 或 composition root 注入。',
      dynamic:
        '无法静态验证动态导入目标。请改用字符串字面量，或只对经过审计的单行添加精确 ESLint 例外。',
      outside: '分层源码不得通过 "{{specifier}}" 导入 src 目录之外的项目文件。',
      package: '当前层不得依赖 "{{packageName}}"；请把 React、DOM、Worker 或 WASM 能力移到适配层。',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowedPackages =
      options.allowedPackages === undefined ? null : new Set(options.allowedPackages);
    const allowedSourceFiles = new Set(options.allowedSourceFiles ?? []);
    const allowedSourcePaths = new Set(options.allowedSourcePaths ?? []);
    const allowedSourceRoots = new Set(options.allowedSourceRoots ?? []);
    const forbiddenPackages = new Set(options.forbiddenPackages ?? []);
    const filename = context.physicalFilename ?? context.filename;

    function isAllowedSourcePath(relative) {
      if (allowedSourceFiles.has(relative)) return true;

      const withoutExtension = relative.replace(/\.(?:[cm]?[jt]sx?|json)$/u, '');
      for (const allowedPath of allowedSourcePaths) {
        if (withoutExtension === allowedPath || withoutExtension.startsWith(`${allowedPath}/`)) {
          return true;
        }
      }
      return false;
    }

    function inspect(sourceNode, isDynamic = false) {
      const specifier = importSourceValue(sourceNode);
      if (specifier === null) {
        if (isDynamic) context.report({ node: sourceNode, messageId: 'dynamic' });
        return;
      }

      const target = resolveSourceImport(filename, specifier);
      if (target === null) {
        const importedPackage = packageName(specifier);
        if (
          (allowedPackages !== null && !allowedPackages.has(importedPackage)) ||
          forbiddenPackages.has(importedPackage)
        ) {
          context.report({
            node: sourceNode,
            messageId: 'package',
            data: { packageName: importedPackage },
          });
        }
        return;
      }
      if (target.outsideSource) {
        context.report({ node: sourceNode, messageId: 'outside', data: { specifier } });
        return;
      }
      if (
        target.root !== null &&
        !allowedSourceRoots.has(target.root) &&
        (target.relative === null || !isAllowedSourcePath(target.relative))
      ) {
        context.report({
          node: sourceNode,
          messageId: 'boundary',
          data: { specifier, target: target.relative ?? 'unknown' },
        });
      }
    }

    return {
      ExportAllDeclaration(node) {
        inspect(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) inspect(node.source);
      },
      ImportDeclaration(node) {
        inspect(node.source);
      },
      ImportExpression(node) {
        inspect(node.source, true);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          inspect(node.moduleReference.expression);
        }
      },
      TSImportType(node) {
        inspect(node.source);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0
        ) {
          inspect(node.arguments[0], true);
        }
      },
    };
  },
};

const noPlatformGlobalsRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent a pure source layer from referencing ambient browser or Worker globals, including in TypeScript type positions.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
        required: ['names'],
      },
    ],
    messages: {
      forbidden:
        'src/core 不得引用浏览器或 Worker 全局 "{{name}}"（包括类型位置）；请定义纯数据 contract 或移到 adapter。',
    },
  },
  create(context) {
    const forbiddenNames = new Set(context.options[0]?.names ?? []);
    const isDeclarationFile = /\.d\.[cm]?[jt]sx?$/u.test(
      context.physicalFilename ?? context.filename,
    );

    function definitionEmitsValue(definition) {
      if (isDeclarationFile || definition.type === 'Type') return false;

      if (definition.type === 'ImportBinding') {
        if (definition.node.importKind === 'type') return false;

        let importParent = definition.node.parent;
        while (importParent !== undefined && importParent.type !== 'ImportDeclaration') {
          if (importParent.type === 'Program') return false;
          importParent = importParent.parent;
        }
        if (importParent === undefined || importParent.importKind === 'type') return false;
      }

      let node = definition.node;
      while (node.type !== 'Program') {
        if (node.type === 'TSDeclareFunction' || node.declare === true) return false;
        if (node.parent === undefined) break;
        node = node.parent;
      }
      return true;
    }

    function isAllowedLocalShadow(variable) {
      if (variable.scope.type === 'global' && variable.defs.length === 0) return false;
      if (!variable.isValueVariable) return true;
      return variable.defs.some((definition) => definitionEmitsValue(definition));
    }

    return {
      'Program:exit'() {
        const reportedIdentifiers = new Set();

        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const identifier = reference.identifier;
            if (reportedIdentifiers.has(identifier) || !forbiddenNames.has(identifier.name)) {
              continue;
            }

            const resolved = reference.resolved;
            if (resolved !== null && isAllowedLocalShadow(resolved)) continue;

            reportedIdentifiers.add(identifier);
            context.report({
              node: identifier,
              messageId: 'forbidden',
              data: { name: identifier.name },
            });
          }
        }
      },
    };
  },
};

export const architecturePlugin = {
  rules: {
    'no-platform-globals': noPlatformGlobalsRule,
    'source-layers': sourceLayersRule,
  },
};
