import defaultTheme from "./themes/default.json";

type Theme = Record<string, unknown>;

const themes: Record<string, Theme> = {
  Default: defaultTheme
};

const storageKey = "seed.themeName";

function flattenTheme(prefix: string, value: unknown, output: Record<string, string>) {
  if (typeof value === "string") {
    output[prefix] = value;
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    const next = prefix ? `${prefix}-${key}` : key;
    flattenTheme(next, child, output);
  });
}

export function getThemes(): string[] {
  return Object.keys(themes);
}

export function applyTheme(name: string) {
  const theme = themes[name] ?? themes.Default;
  const vars: Record<string, string> = {};
  flattenTheme("", theme, vars);
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, val]) => {
    root.style.setProperty(`--${key}`, val);
  });
  window.localStorage.setItem(storageKey, name);
}

export function loadThemeFromStorage() {
  const stored = window.localStorage.getItem(storageKey) ?? "Default";
  applyTheme(stored);
  return stored;
}
