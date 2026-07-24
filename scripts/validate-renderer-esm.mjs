import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [entryArgument] = process.argv.slice(2);

if (entryArgument === undefined) {
  throw new Error('Informe o arquivo de entrada do renderer.');
}

const entry = path.resolve(entryArgument);
const rendererRoot = path.dirname(entry);
const isolatedRoot = path.dirname(rendererRoot);
const visited = new Set();

await validateModule(entry);

async function validateModule(filePath) {
  if (visited.has(filePath)) {
    return;
  }
  visited.add(filePath);

  const source = await readFile(filePath, 'utf8');
  for (const specifier of collectSpecifiers(source)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(
        `Importação incompatível com o renderer isolado em ${filePath}: ${specifier}`,
      );
    }

    const dependency = path.resolve(path.dirname(filePath), specifier);
    const relativeDependency = path.relative(isolatedRoot, dependency);
    if (
      relativeDependency.startsWith(`..${path.sep}`) ||
      relativeDependency === '..' ||
      path.isAbsolute(relativeDependency)
    ) {
      throw new Error(`Importação local fora do renderer isolado em ${filePath}: ${specifier}`);
    }
    await validateModule(dependency);
  }
}

function collectSpecifiers(source) {
  const specifiers = [];
  const importPattern =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}
