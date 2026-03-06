import { sql } from "./db.js";
const rows = await sql`select works_json, awards_json from candidates where id = 5`;
const parse = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};
const works = parse(rows[0]?.works_json);
const awards = parse(rows[0]?.awards_json);
console.log(JSON.stringify({ worksCount: works.length, awardsCount: awards.length, firstWork: works[0], firstAward: awards[0] }, null, 2));
