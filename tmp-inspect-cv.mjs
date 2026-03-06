import fs from "node:fs";
import { PDFParse } from "pdf-parse";

const filePath = "./assets/uploads/Lena Ashford - CV.pdf";
const data = fs.readFileSync(filePath);
const parser = new PDFParse({ data });
const result = await parser.getText();
await parser.destroy();
console.log(result.text);
