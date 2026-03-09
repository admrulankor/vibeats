export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function uniqueStrings(items) {
  const seen = new Set();
  const ordered = [];

  for (const item of items) {
    const normalized = item.trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push(normalized);
  }

  return ordered;
}

export function toTitleCaseName(value) {
  return value
    .split(/\s+/)
    .map((token) => {
      if (!token) {
        return token;
      }

      if (/^[A-Z]\.?(?:[A-Z]\.?)?$/.test(token)) {
        return token.toUpperCase();
      }

      return token
        .toLowerCase()
        .replace(/(^|[-'])\p{L}/gu, (match) => match.toUpperCase());
    })
    .join(" ");
}
