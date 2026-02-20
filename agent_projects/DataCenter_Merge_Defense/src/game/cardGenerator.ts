import {
  CardConfig,
  CardEffectValueConfig,
  CardTemplateConfig,
  NumericRangeConfig
} from "./types";
import { createSeededRandom, randomRange } from "./random";

export function generateCardsFromTemplates(
  templates: CardTemplateConfig[],
  seed: number
): CardConfig[] {
  const random = createSeededRandom(seed);
  return templates.map((template) => ({
    id: template.id,
    icon: template.icon,
    name: template.name,
    description: template.description,
    fire_rate_multiplier: resolveCardValue(
      template.fire_rate_multiplier,
      random,
      2,
      false
    ),
    damage_multiplier: resolveCardValue(
      template.damage_multiplier,
      random,
      2,
      false
    ),
    crit_chance_bonus: resolveCardValue(
      template.crit_chance_bonus,
      random,
      3,
      false
    ),
    merge_bonus_credits: resolveCardValue(
      template.merge_bonus_credits,
      random,
      0,
      true
    )
  }));
}

function resolveCardValue(
  value: CardEffectValueConfig | undefined,
  random: () => number,
  defaultPrecision: number,
  asInteger: boolean
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return asInteger ? Math.round(value) : value;
  }

  const precision = value.precision ?? defaultPrecision;
  return sampleRange(value, random, precision, asInteger);
}

function sampleRange(
  range: NumericRangeConfig,
  random: () => number,
  precision: number,
  asInteger: boolean
): number {
  const sampled = randomRange(random, range.min, range.max);
  if (asInteger) {
    return Math.round(sampled);
  }

  const power = Math.pow(10, Math.max(0, precision));
  return Math.round(sampled * power) / power;
}
