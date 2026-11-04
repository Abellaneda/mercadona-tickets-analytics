import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const srcDir = path.resolve('src');
const distDir = path.resolve('dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Orden topológico estricto para que las utilidades y servicios se declaren antes de usarse
const fileOrder = [
  'utils/sheetUtils.ts',
  'utils/pdfParser.ts',
  'services/statusService.ts',
  'services/analyticsService.ts',
  'services/googleService.ts',
  'services/notificationService.ts',
  'ui/instructionsView.ts',
  'ui/statusView.ts',
  'ui/dashboardView.ts',
  'main.ts',
];

let fullCode = `/**
 * ============================================================================
 * SISTEMA DE AUTOMATIZACIÓN Y ANALÍTICA DE TICKETS DE MERCADONA
 * Generado automáticamente para Google Apps Script (V8).
 * ============================================================================
 */\n\n`;

for (const relPath of fileOrder) {
  const fullPath = path.join(srcDir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`No se encontró el archivo fuente esperado: ${fullPath}`);
  }

  const rawTs = fs.readFileSync(fullPath, 'utf-8');

  // Transpilar de TypeScript a JavaScript moderno compatible con Google Apps Script V8
  const transpiled = ts.transpileModule(rawTs, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
    },
  }).outputText;

  // Limpiar imports (de una o varias líneas), exports y restos de módulos para Apps Script
  const cleaned = transpiled
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(async\s+function|function|const|let|var|class)/gm, '$1')
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '')
    .replace(/^export\s+default\s+.*?;?\s*$/gm, '')
    .replace(/^"use strict";\s*$/gm, '')
    .replace(/Object\.defineProperty\(exports,\s*"__esModule",\s*\{[^}]*\}\);?/g, '')
    .replace(/exports\.[a-zA-Z0-9_$]+\s*=\s*[^;]+;?/g, '');

  fullCode += `// ----------------------------------------------------------------------------\n`;
  fullCode += `// Archivo fuente: ${relPath}\n`;
  fullCode += `// ----------------------------------------------------------------------------\n`;
  fullCode += cleaned.trim() + '\n\n';
}

// Verificación automática de sintaxis JavaScript pura (sin import/export residuales)
try {
  new vm.Script(fullCode, { filename: 'Codigo_AppsScript.gs' });
} catch (syntaxErr) {
  console.error('❌ Error de sintaxis en el archivo generado para Apps Script:', syntaxErr);
  process.exit(1);
}

const outputPath = path.join(distDir, 'Codigo_AppsScript.gs');
fs.writeFileSync(outputPath, fullCode, 'utf-8');

console.log(`✅ Archivo verificado y generado con éxito en:\n   ${outputPath}`);
