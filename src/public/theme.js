const STORAGE_KEY = "vibeats-theme";

function isValidTheme(value) {
  return value === "light" || value === "dark" || value === "system";
}

function getStoredThemePreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isValidTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

function setStoredThemePreference(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage access failures in private mode or locked-down environments.
  }
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference) {
  return preference === "system" ? getSystemTheme() : preference;
}

function applyTheme(preference) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolveTheme(preference);
}

function syncThemeSelects(preference) {
  const selects = document.querySelectorAll("[data-theme-select]");
  for (const select of selects) {
    if (select.value !== preference) {
      select.value = preference;
    }
  }
}

function initializeThemePicker() {
  const initialPreference = getStoredThemePreference();
  applyTheme(initialPreference);
  syncThemeSelects(initialPreference);

  const selects = document.querySelectorAll("[data-theme-select]");
  for (const select of selects) {
    select.addEventListener("change", (event) => {
      const nextPreference = event.target.value;
      if (!isValidTheme(nextPreference)) {
        return;
      }

      setStoredThemePreference(nextPreference);
      applyTheme(nextPreference);
      syncThemeSelects(nextPreference);
    });
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    const currentPreference = getStoredThemePreference();
    if (currentPreference === "system") {
      applyTheme("system");
    }
  });
}

initializeThemePicker();
