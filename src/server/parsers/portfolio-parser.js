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

function collectSectionEntriesByHeadings(lines, startHeadings, endHeadings) {
  for (const heading of startHeadings) {
    const entries = collectSectionEntries(lines, heading, endHeadings);

    if (entries.length) {
      return entries;
    }
  }

  return [];
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

function isBulletLine(line) {
  return /^[•●\-–—]/.test(line);
}

function mergeCreditStyleLines(lines) {
  const entries = [];
  let currentEntry = "";

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const startsNewEntry =
      (/^["“].+["”]/.test(line) || /#\d+/.test(line) || /\(.+\)\s*$/.test(line)) && !isBulletLine(line);

    if (startsNewEntry) {
      if (currentEntry) {
        entries.push(currentEntry.trim());
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
    entries.push(currentEntry.trim());
  }

  return entries;
}

function mergeWorkLines(lines) {
  if (lines.some((line) => isYearEntry(line))) {
    return mergeYearBasedLines(lines);
  }

  return mergeCreditStyleLines(lines);
}

function stripBulletPrefix(line) {
  return line.replace(/^[•●\-–—]\s*/, "").trim();
}

function mergeBulletBasedLines(lines) {
  const entries = [];
  let currentEntry = "";

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (isBulletLine(line)) {
      if (currentEntry) {
        entries.push(currentEntry.trim());
      }

      currentEntry = stripBulletPrefix(line);
      continue;
    }

    if (!currentEntry) {
      currentEntry = line.trim();
      continue;
    }

    currentEntry = `${currentEntry} ${line.trim()}`;
  }

  if (currentEntry) {
    entries.push(currentEntry.trim());
  }

  return entries;
}

function mergeAwardLines(lines) {
  if (lines.some((line) => isYearEntry(line))) {
    return mergeYearBasedLines(lines);
  }

  if (lines.some((line) => isBulletLine(line))) {
    return mergeBulletBasedLines(lines);
  }

  return mergeYearBasedLines(lines);
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
  const worksBoundaryHeadings = [
    "awards & honors",
    "awards & recognition",
    "education",
    "professional experience",
    "experience",
    "work experience",
    "employment"
  ];
  const worksSections = [
    "literary works",
    "standalone novels",
    "comic book runs",
    "filmography & screenwriting",
    "selected comic book credits",
    "selected works",
    "selected credits"
  ];

  for (let index = 0; index < worksSections.length; index += 1) {
    const currentHeading = worksSections[index];
    const remainingHeadings = worksSections.slice(index + 1);
    const endHeadings = [...remainingHeadings, ...worksBoundaryHeadings];
    const sectionEntries = collectSectionEntries(lines, currentHeading, endHeadings);

    if (sectionEntries.length) {
      works.push(...sectionEntries);
    }
  }

  const awardsLines = collectSectionEntriesByHeadings(
    lines,
    ["awards & honors", "awards & recognition"],
    ["education"]
  );

  return {
    works: mergeWorkLines(works),
    awards: mergeAwardLines(awardsLines)
  };
}
