#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const DEFAULT_LOCAL_ROOT = 'src/three-r162';
const DEFAULT_UPSTREAM_ROOT = 'three.js/src';
const DEFAULT_MD_PATH = path.join(DEFAULT_LOCAL_ROOT, 'classes.md');

const CLASS_GROUPS = [
  {
    title: 'Exported classes',
    sections: [
      {
        file: 'main-impl.ts',
        classes: [
          'WebGLRenderer',
          'Fog',
          'Scene',
          'Mesh',
          'LineSegments',
          'Line',
          'Points',
          'ShaderMaterial',
          'OrthographicCamera',
          'BufferGeometry',
          'BufferAttribute',
          'Object3D',
          'Texture',
        ],
      },
      {
        file: 'math.ts',
        classes: [
          'Quaternion',
          'Vector3',
          'Vector4',
          'Matrix4',
          'Color',
          'Ray',
        ],
      },
      {
        file: 'extras-impl.ts',
        classes: ['CatmullRomCurve3'],
      },
    ],
  },
  {
    title: 'Internal helper classes',
    intro: 'These classes are defined in the bundled files but are not exported at the end of those modules.',
    sections: [
      {
        file: 'main-impl.ts',
        classes: [
          'EventDispatcher',
          'Source',
          'SingleUniform',
          'StructuredUniform',
          'WebGLUniforms',
          'Material',
          'Camera',
        ],
      },
      {
        file: 'extras-impl.ts',
        classes: ['Curve'],
      },
    ],
  },
];

const CLASS_ORDER = CLASS_GROUPS
  .flatMap((group) => group.sections)
  .flatMap((section) => section.classes);

const LOCAL_IMPL_FILES = new Set(
  CLASS_GROUPS
    .flatMap((group) => group.sections)
    .map((section) => section.file)
);

function parseArgs(argv) {
  const options = {
    localRoot: DEFAULT_LOCAL_ROOT,
    upstreamRoot: DEFAULT_UPSTREAM_ROOT,
    mdPath: DEFAULT_MD_PATH,
    className: null,
    methodName: null,
    showDiffs: false,
    writeMd: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local-root') {
      options.localRoot = requireValue(argv, ++i, '--local-root');
    } else if (arg === '--upstream-root') {
      options.upstreamRoot = requireValue(argv, ++i, '--upstream-root');
    } else if (arg === '--class') {
      options.className = requireValue(argv, ++i, '--class');
    } else if (arg === '--method') {
      options.methodName = requireValue(argv, ++i, '--method');
    } else if (arg === '--diffs') {
      options.showDiffs = true;
    } else if (arg === '--write-md') {
      options.writeMd = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.mdPath = next;
        i++;
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`Compare bundled three.js subset with upstream three.js.

Usage:
  node tools/compare-three-r162.js [options]

Options:
  --local-root <path>     Local subset root. Default: ${DEFAULT_LOCAL_ROOT}
  --upstream-root <path>  Upstream three.js src root. Default: ${DEFAULT_UPSTREAM_ROOT}
  --class <name>          Limit output to one class.
  --method <name>         Limit diffs to one method (requires --diffs).
  --diffs                 Show per-method diffs for changed methods.
  --write-md [path]       Regenerate classes.md summary. Default path: ${DEFAULT_MD_PATH}
  --help, -h              Show this message.

Examples:
  node tools/compare-three-r162.js
  node tools/compare-three-r162.js --class Vector3 --diffs
  node tools/compare-three-r162.js --class WebGLRenderer --method render --diffs
  node tools/compare-three-r162.js --write-md`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const localRoot = path.resolve(options.localRoot);
  const upstreamRoot = path.resolve(options.upstreamRoot);

  ensureDir(localRoot, 'Local root');
  ensureDir(upstreamRoot, 'Upstream root');

  const localClasses = collectClasses(localRoot);
  const upstreamClasses = collectClasses(upstreamRoot);
  const comparisons = compareClasses(localClasses, upstreamClasses);

  if (options.writeMd) {
    const markdown = renderMarkdown(comparisons);
    fs.writeFileSync(path.resolve(options.mdPath), markdown);
    console.error(`Wrote ${path.resolve(options.mdPath)}`);
  }

  const filtered = filterComparisons(comparisons, options.className);
  printSummary(filtered);

  if (options.showDiffs) {
    printDiffs(filtered, options.methodName);
  }
}

function ensureDir(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} does not exist: ${dirPath}`);
  }
}

function collectFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        (fullPath.endsWith('.js') || LOCAL_IMPL_FILES.has(path.basename(fullPath)))
      ) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files;
}

function parseModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const ast = espree.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    range: true,
  });
  return {source, ast, filePath};
}

function collectClasses(rootDir) {
  const classes = new Map();
  for (const filePath of collectFiles(rootDir)) {
    const parsed = parseModule(filePath);
    for (const [name, data] of extractClassEntries(parsed)) {
      if (!classes.has(name)) {
        classes.set(name, data);
      }
    }
  }
  return classes;
}

function extractClassEntries(parsed) {
  const entries = new Map();

  for (const node of parsed.ast.body) {
    if (node.type === 'ClassDeclaration' && node.id) {
      entries.set(node.id.name, extractClassDeclaration(parsed, node));
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      entries.set(node.id.name, extractConstructorFunction(parsed, node));
    }
  }

  return entries;
}

function extractClassDeclaration(parsed, node) {
  const methods = new Map();

  for (const member of node.body.body) {
    if (member.type !== 'MethodDefinition') continue;
    const name = formatMethodName(member);
    methods.set(name, {
      name,
      source: parsed.source.slice(member.range[0], member.range[1]),
      canonical: canonicalizeNode(member.value),
    });
  }

  return {
    name: node.id.name,
    filePath: parsed.filePath,
    methods,
  };
}

function extractConstructorFunction(parsed, node) {
  const methods = new Map();
  methods.set('constructor', {
    name: 'constructor',
    source: parsed.source.slice(node.range[0], node.range[1]),
    canonical: canonicalizeNode(node),
  });

  for (const statement of node.body.body) {
    if (statement.type !== 'ExpressionStatement') continue;
    const expression = statement.expression;
    if (!expression || expression.type !== 'AssignmentExpression' || expression.operator !== '=') continue;
    const left = expression.left;
    const right = expression.right;
    if (!isThisProperty(left)) continue;
    if (right.type !== 'FunctionExpression' && right.type !== 'ArrowFunctionExpression') continue;
    const name = left.property.name;
    methods.set(name, {
      name,
      source: `${name}: ${parsed.source.slice(right.range[0], right.range[1])}`,
      canonical: canonicalizeNode(right),
    });
  }

  return {
    name: node.id.name,
    filePath: parsed.filePath,
    methods,
  };
}

function isThisProperty(node) {
  return node.type === 'MemberExpression' &&
    node.object.type === 'ThisExpression' &&
    !node.computed &&
    node.property.type === 'Identifier';
}

function formatMethodName(member) {
  let name;
  if (member.kind === 'constructor') {
    name = 'constructor';
  } else if (member.key.type === 'Identifier') {
    name = member.key.name;
  } else if (member.key.type === 'Literal') {
    name = String(member.key.value);
  } else {
    name = '[computed]';
  }

  if (member.kind === 'get') {
    name = `get ${name}`;
  } else if (member.kind === 'set') {
    name = `set ${name}`;
  }

  if (member.static) {
    name = `static ${name}`;
  }

  return name;
}

function canonicalizeNode(node) {
  return JSON.stringify(stripMetadata(node));
}

function stripMetadata(value) {
  if (Array.isArray(value)) {
    return value.map(stripMetadata);
  }

  if (value && typeof value === 'object') {
    const cleaned = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'range' || key === 'loc' || key === 'raw' || key === 'comments' || key === 'tokens' ||
          key === 'start' || key === 'end') {
        continue;
      }
      cleaned[key] = stripMetadata(value[key]);
    }
    return cleaned;
  }

  return value;
}

function compareClasses(localClasses, upstreamClasses) {
  return CLASS_ORDER.map((name) => compareClass(name, localClasses.get(name), upstreamClasses.get(name)));
}

function compareClass(name, localClass, upstreamClass) {
  if (!localClass || !upstreamClass) {
    return {
      name,
      note: 'missing',
      changedMethods: [],
      missingUpstreamMethods: [],
      localOnlyMethods: [],
      localClass,
      upstreamClass,
    };
  }

  const localNames = [...localClass.methods.keys()];
  const upstreamNames = [...upstreamClass.methods.keys()];
  const changedMethods = [];
  const localOnlyMethods = [];
  const missingUpstreamMethods = [];

  for (const methodName of localNames) {
    const localMethod = localClass.methods.get(methodName);
    const upstreamMethod = upstreamClass.methods.get(methodName);
    if (!upstreamMethod) {
      localOnlyMethods.push(methodName);
      changedMethods.push(methodName);
      continue;
    }
    if (localMethod.canonical !== upstreamMethod.canonical) {
      changedMethods.push(methodName);
    }
  }

  for (const methodName of upstreamNames) {
    if (!localClass.methods.has(methodName)) {
      missingUpstreamMethods.push(methodName);
    }
  }

  let note;
  if (changedMethods.length === 0 && missingUpstreamMethods.length === 0 && localOnlyMethods.length === 0) {
    note = 'same';
  } else if (changedMethods.length === 0 && localOnlyMethods.length === 0 && localNames.length < upstreamNames.length) {
    note = `subset ${localNames.length}/${upstreamNames.length}`;
  } else {
    note = `differs in ${changedMethods.join(', ')}`;
  }

  return {
    name,
    note,
    changedMethods,
    missingUpstreamMethods,
    localOnlyMethods,
    localClass,
    upstreamClass,
  };
}

function filterComparisons(comparisons, className) {
  if (!className) return comparisons;
  const filtered = comparisons.filter((entry) => entry.name === className);
  if (filtered.length === 0) {
    throw new Error(`Class not found in comparison set: ${className}`);
  }
  return filtered;
}

function printSummary(comparisons) {
  for (const entry of comparisons) {
    console.log(`${entry.name}\t${entry.note}`);
  }
}

function printDiffs(comparisons, methodName) {
  for (const entry of comparisons) {
    if (!entry.localClass || !entry.upstreamClass) continue;

    const methodNames = methodName ? [methodName] : entry.changedMethods;
    let printedHeader = false;

    for (const name of methodNames) {
      const localMethod = entry.localClass.methods.get(name);
      const upstreamMethod = entry.upstreamClass.methods.get(name);
      if (!localMethod || !upstreamMethod) continue;

      if (!printedHeader) {
        console.log('');
        console.log(`## ${entry.name}`);
        printedHeader = true;
      }

      console.log(`### ${name}`);
      console.log(renderUnifiedDiff(localMethod.source, upstreamMethod.source, 'local', 'upstream'));
    }
  }
}

function renderMarkdown(comparisons) {
  const byName = new Map(comparisons.map((entry) => [entry.name, entry]));
  const lines = [
    '# Classes in `src/three-r162`',
    '',
    'This directory contains three bundled source files with class definitions.',
    '',
  ];

  for (const group of CLASS_GROUPS) {
    lines.push(`## ${group.title}`);
    lines.push('');
    if (group.intro) {
      lines.push(group.intro);
      lines.push('');
    }
    for (const section of group.sections) {
      lines.push(`### \`${section.file}\``);
      lines.push('');
      for (const className of section.classes) {
        const entry = byName.get(className);
        const note = entry ? entry.note : 'missing';
        lines.push(`- \`${className}\` - ${note}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderUnifiedDiff(localSource, upstreamSource, localLabel, upstreamLabel) {
  const localLines = localSource.split('\n');
  const upstreamLines = upstreamSource.split('\n');
  const operations = diffLines(localLines, upstreamLines);
  const lines = [`--- ${localLabel}`, `+++ ${upstreamLabel}`];

  for (const operation of operations) {
    const prefix = operation.type === 'equal' ? ' ' : operation.type === 'delete' ? '-' : '+';
    lines.push(`${prefix}${operation.line}`);
  }

  return lines.join('\n');
}

function diffLines(left, right) {
  const rows = left.length;
  const cols = right.length;
  const table = Array.from({length: rows + 1}, () => Array(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      if (left[i] === right[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      operations.push({type: 'equal', line: left[i]});
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({type: 'delete', line: left[i]});
      i++;
    } else {
      operations.push({type: 'insert', line: right[j]});
      j++;
    }
  }

  while (i < rows) {
    operations.push({type: 'delete', line: left[i]});
    i++;
  }

  while (j < cols) {
    operations.push({type: 'insert', line: right[j]});
    j++;
  }

  return operations;
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
