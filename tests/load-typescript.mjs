import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const compiled = new Map();
// 仅在测试进程内转译源码，不向项目写入编译文件。
export async function importTypeScript(filename) {
  const absolute = path.resolve(filename);
  const url = await compile(absolute);
  return import(url);
}
async function compile(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  const source = await fs.readFile(filename, "utf8");
  let output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const imports = [...output.matchAll(/from\s+["'](\.[^"']+)["']/g)];
  for (const match of imports) {
    let target = path.resolve(path.dirname(filename), match[1]);
    if (!path.extname(target)) target += ".ts";
    const url = await compile(target);
    output = output.replace(match[0], `from "${url}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output, "utf8").toString("base64")}`;
  compiled.set(filename, url);
  return url;
}
