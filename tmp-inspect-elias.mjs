import { sql } from "./db.js";
const rows = await sql`select raw_cv_text from candidates where id = 5`;
console.log(rows[0]?.raw_cv_text ?? "");
