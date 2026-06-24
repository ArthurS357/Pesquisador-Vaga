import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resilientFetch } from "../../core/http-client";

/**
 * Testes do cliente HTTP educado. Relógio falso (fake timers) + `fetch` mockado
 * pra validar tempo virtual sem espera real. Cada teste usa um HOSTNAME único
 * porque o rate limiter é singleton de processo (estado por host persiste).
 */

const POLITE_UA = "Pesquisa-Emprego-Bot/1.0 (+https://github.com/sabino/pesquisa-emprego)";

function jsonOk(): Response {
  return new Response("{}", { status: 200 });
}
function status(code: number, headers?: Record<string, string>): Response {
  return new Response(null, { status: code, headers });
}

/** Segundo argumento (RequestInit) da n-ésima chamada do fetch mock. */
function initOf(mock: ReturnType<typeof vi.fn>, call = 0): RequestInit {
  const args = mock.mock.calls[call];
  expect(args).toBeDefined();
  return (args?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resilientFetch — rate limit por host", () => {
  it("espaça requests ao mesmo host em 500ms (2 rps)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);

    // Duas requests concorrentes ao MESMO host.
    const p1 = resilientFetch("https://rate.test/a");
    const p2 = resilientFetch("https://rate.test/b");

    // Sem avançar o relógio: só a 1ª dispara (slot t=0). A 2ª reservou t=500.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 499ms ainda não libera a 2ª…
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // …no marco de 500ms ela dispara.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([p1, p2]);
  });
});

describe("resilientFetch — Retry-After (escudo 429)", () => {
  it("respeita o header Retry-After antes de retentar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(429, { "retry-after": "2" })) // pausa 2s
      .mockResolvedValueOnce(jsonOk());
    vi.stubGlobal("fetch", fetchMock);

    const p = resilientFetch("https://retry.test/a");

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 1ª → 429

    await vi.advanceTimersByTimeAsync(1999); // < 2000ms: não retenta
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1); // 2000ms: retenta
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const res = await p;
    expect(res.status).toBe(200);
  });
});

describe("resilientFetch — backoff exponencial com jitter", () => {
  it("aplica base*2^attempt + jitter entre retries de 5xx", async () => {
    // Math.random fixo → jitter determinístico (0.5 * 1000 = 500ms).
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(500)) // attempt 0
      .mockResolvedValueOnce(status(500)) // attempt 1
      .mockResolvedValue(jsonOk()); // attempt 2
    vi.stubGlobal("fetch", fetchMock);

    const p = resilientFetch("https://backoff.test/a");

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1º backoff = 1000*2^0 + 0.5*1000 = 1500ms.
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 2º backoff = 1000*2^1 + 0.5*1000 = 2500ms (crescimento exponencial).
    await vi.advanceTimersByTimeAsync(2499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const res = await p;
    expect(res.status).toBe(200);
  });
});

describe("resilientFetch — teto de 60s no Retry-After", () => {
  it("dorme no máximo 60s e aborta na 2ª insistência acima do teto", async () => {
    // Alvo pede 2h (7200s) toda vez.
    const fetchMock = vi.fn().mockResolvedValue(status(429, { "retry-after": "7200" }));
    vi.stubGlobal("fetch", fetchMock);

    const p = resilientFetch("https://ceiling.test/a");
    const settled = p.catch((e: unknown) => e); // captura p/ evitar unhandled rejection

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 1ª → 429 (pausa-teto concedida)

    // Não dorme as 2h: 59999ms ainda não retenta…
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …em 60s exatos retenta (teto aplicado).
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 2ª resposta acima do teto → aborta sem dormir de novo.
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/teto de 60s/);
  });
});

describe("resilientFetch — User-Agent educado", () => {
  it("injeta o UA padrão quando ausente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);

    const p = resilientFetch("https://ua.test/a");
    await vi.advanceTimersByTimeAsync(0);
    await p;

    expect(new Headers(initOf(fetchMock).headers).get("user-agent")).toBe(POLITE_UA);
  });

  it("preserva um User-Agent já fornecido pelo chamador", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);

    const p = resilientFetch("https://ua2.test/a", { headers: { "User-Agent": "Custom/9" } });
    await vi.advanceTimersByTimeAsync(0);
    await p;

    expect(new Headers(initOf(fetchMock).headers).get("user-agent")).toBe("Custom/9");
  });
});
