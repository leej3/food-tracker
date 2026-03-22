import type { NutrientDefinition } from "./types";

export interface HistorySuggestion {
  label: string;
  score: number;
}

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const charBigramSimilarity = (a: string, b: string): number => {
  if (!a.length || !b.length) {
    return 0;
  }

  const left = `${a} `;
  const right = `${b} `;
  const leftBigrams: string[] = [];
  const rightBigrams: string[] = [];

  for (let i = 0; i < left.length - 1; i += 1) {
    leftBigrams.push(left.slice(i, i + 2));
  }
  for (let i = 0; i < right.length - 1; i += 1) {
    rightBigrams.push(right.slice(i, i + 2));
  }

  let intersection = 0;
  const rightCounts = new Map<string, number>();

  for (const token of rightBigrams) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  for (const token of leftBigrams) {
    const count = rightCounts.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      rightCounts.set(token, count - 1);
    }
  }

  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

export const buildHistorySuggestions = (
  input: string,
  historyNames: Array<string>,
): string[] => {
  const cleanInput = normalize(input);

  if (!cleanInput) {
    return [];
  }

  const suggestions = historyNames
    .map((name) => {
      const normalized = normalize(name);
      const exactMatch = normalized.includes(cleanInput);
      const exact = exactMatch ? 1.2 : 0;
      const score = Math.max(exact, charBigramSimilarity(cleanInput, normalized));
      return {
        label: name,
        normalized,
        exactMatch,
        score,
      };
    })
    .filter((item) => item.score >= 0.45 && (item.exactMatch || item.normalized.startsWith(cleanInput[0] ?? "")))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.label);

  return [...new Set(suggestions)];
};

export const buildNutrientMap = (nutrients: NutrientDefinition[]) =>
  nutrients.reduce<Record<string, NutrientDefinition>>((acc, nutrient) => {
    acc[nutrient.code] = nutrient;
    return acc;
  }, {});
