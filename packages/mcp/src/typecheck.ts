import path from "node:path";
import ts from "typescript";

export interface TypecheckResult {
  errors: string[];
  passed: boolean;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

  return `${path.basename(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
}

export function typecheckVariant(filePath: string, projectRoot: string): TypecheckResult {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  let options: ts.CompilerOptions = {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };

  if (configPath !== undefined) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

    if (configFile.error !== undefined) {
      return {
        errors: [formatDiagnostic(configFile.error)],
        passed: false,
      };
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );

    if (parsed.errors.length > 0) {
      return {
        errors: parsed.errors.map(formatDiagnostic),
        passed: false,
      };
    }

    options = {
      ...parsed.options,
      noEmit: true,
      skipLibCheck: true,
    };
  }

  const program = ts.createProgram({
    options,
    rootNames: [filePath],
  });
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  return {
    errors: [...new Set(diagnostics.map(formatDiagnostic))],
    passed: diagnostics.length === 0,
  };
}
