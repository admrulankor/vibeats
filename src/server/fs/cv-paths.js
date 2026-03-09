import fs from "node:fs";
import path from "node:path";
import { directories } from "../config/app-config.js";

export function getCvFilenameForCandidateName(name) {
  const expectedFileName = `${name} - CV.pdf`;
  const expectedFilePath = path.join(directories.uploads, expectedFileName);

  return fs.existsSync(expectedFilePath) ? expectedFileName : null;
}

export function getCvAbsolutePath(cvFilename) {
  return path.join(directories.uploads, cvFilename);
}
