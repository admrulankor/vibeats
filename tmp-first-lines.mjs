import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";

const dir = "./assets/uploads";
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));

for (const file of files) {
  const filePath = path.join(dir, file);
  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  await parser.destroy();
  const lines = result.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  console.log(`\n===== ${file} (first 25 lines) =====`);
  console.log(lines.slice(0, 25).join("\n"));
}
