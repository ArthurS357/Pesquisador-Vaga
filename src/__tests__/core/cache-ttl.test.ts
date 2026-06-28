import { describe, expect, it } from "vitest";
import { isCacheStale, DAY_MS } from "../../core/cache-ttl";

const NOW = Date.UTC(2026, 5, 28); // referência fixa
const daysAgo = (n: number): Date => new Date(NOW - n * DAY_MS);

describe("isCacheStale", () => {
  it("cache dentro do TTL → usado (não stale)", () => {
    expect(isCacheStale(daysAgo(10), daysAgo(40), NOW, 30, 7)).toBe(false);
  });

  it("cache além do TTL → ignorado (stale)", () => {
    expect(isCacheStale(daysAgo(40), daysAgo(40), NOW, 30, 7)).toBe(true);
  });

  it("CACHE_TTL_DAYS=0 → cache nunca expira (backward-compat)", () => {
    expect(isCacheStale(daysAgo(999), daysAgo(999), NOW, 0, 7)).toBe(false);
    // null judgedAt também não expira com TTL desligado
    expect(isCacheStale(null, daysAgo(999), NOW, 0, 7)).toBe(false);
  });

  it("legado (judgedAt null) com anúncio velho (>grace) → reavalia", () => {
    expect(isCacheStale(null, daysAgo(10), NOW, 30, 7)).toBe(true);
  });

  it("legado (judgedAt null) com anúncio recente (<grace) → adiado (anti-avalanche)", () => {
    expect(isCacheStale(null, daysAgo(3), NOW, 30, 7)).toBe(false);
  });

  it("legado (judgedAt null) sem updatedAt → reavalia já", () => {
    expect(isCacheStale(null, null, NOW, 30, 7)).toBe(true);
  });

  it("borda exata do TTL não conta como stale (estritamente menor)", () => {
    expect(isCacheStale(new Date(NOW - 30 * DAY_MS), null, NOW, 30, 7)).toBe(false);
  });
});
