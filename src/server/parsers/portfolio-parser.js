function sanitizePortfolioLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+\/\d+$/.test(line) && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

function isYearEntry(line) {
  return /^\d{4}(?:[–-]\d{4})?\b/.test(line);
}

function collectSectionEntries(lines, startHeading, endHeadings) {
  const startIndex = lines.findIndex((line) => line.toLowerCase() === startHeading.toLowerCase());

  if (startIndex === -1) {
    return [];
  }

  const entries = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();

    if (endHeadings.some((heading) => lower === heading.toLowerCase())) {
      break;
    }

    entries.push(line);
  }

  return entries;
}

function mergeYearBasedLines(lines) {
  const entries = [];
  let currentEntry = "";

  for (const line of lines) {
    if (isYearEntry(line)) {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = line;
      continue;
    }

    if (!currentEntry) {
      currentEntry = line;
      continue;
    }

    currentEntry = `${currentEntry} ${line}`;
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

export function extractPortfolioHighlights(rawText) {
  const lines = sanitizePortfolioLines(rawText);

  if (!lines.length) {
    return {
      works: [],
      awards: []
    };
  }

  const works = [];
  const worksSections = [
    "literary works",
    "standalone novels",
    "comic book runs",
    "filmography & screenwriting"
  ];

  for (let index = 0; index < worksSections.length; index += 1) {
    const currentHeading = worksSections[index];
    const remainingHeadings = worksSections.slice(index + 1);
    const endHeadings = [...remainingHeadings, "awards & honors", "education"];
    const sectionEntries = collectSectionEntries(lines, currentHeading, endHeadings);

    if (sectionEntries.length) {
      works.push(...sectionEntries);
    }
  }

  const awardsLines = collectSectionEntries(lines, "awards & honors", ["education"]);

  return {
    works: mergeYearBasedLines(works),
    awards: mergeYearBasedLines(awardsLines)
  };
}
