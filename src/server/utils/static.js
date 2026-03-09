import fs from "node:fs";
import path from "node:path";

export function safeStaticPath(rootDirectory, incomingPath) {
  const relativePath = incomingPath.replace(/^[/\\]+/, "");
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(rootDirectory, relativePath);

  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedPath;
  }

  return null;
}

export async function maybeServeFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);

  if (!stats.isFile()) {
    return null;
  }

  return new Response(Bun.file(filePath));
}
