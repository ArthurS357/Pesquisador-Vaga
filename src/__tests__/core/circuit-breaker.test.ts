import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, withDeadline } from "../../core/circuit-breaker";

/**
 * Testes da máquina de estados do disjuntor. Relógio falso pra envelhecer o
 * `openedAt` sem espera real (o `phase()` compara `Date.now() - openedAt` ao
 * cooldown). Cada teste cria um breaker NOVO — sem singleton, sem bleed de estado.
 */

const COOLDOWN_MS = 5 * 60_000; // default do CircuitBreaker

const boom = (): Promise<never> => Promise.reject(new Error("falha de fonte"));
const ok = <T>(v: T): (() => Promise<T>) => () => Promise.resolve(v);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CircuitBreaker — CLOSED (abaixo do limiar)", () => {
  it("conta falhas mas SEGUE executando fn enquanto fechado", async () => {
    const cb = new CircuitBreaker(); // threshold 3
    const fn = vi.fn(boom);

    // 2 falhas (< 3): cada chamada DEVE invocar fn.
    await expect(cb.exec("src", fn)).rejects.toThrow("falha de fonte");
    await expect(cb.exec("src", fn)).rejects.toThrow("falha de fonte");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(cb.phase("src")).toBe("closed"); // ainda não abriu
  });

  it("sucesso zera o contador de falhas (não acumula p/ abrir)", async () => {
    const cb = new CircuitBreaker();
    const failing = vi.fn(boom);
    const success = vi.fn(ok("payload"));

    await expect(cb.exec("src", failing)).rejects.toThrow(); // 1 falha
    await expect(cb.exec("src", failing)).rejects.toThrow(); // 2 falhas
    await expect(cb.exec("src", success)).resolves.toBe("payload"); // reset → 0

    // 2 novas falhas: contador recomeçou, logo ainda fechado.
    await expect(cb.exec("src", failing)).rejects.toThrow();
    await expect(cb.exec("src", failing)).rejects.toThrow();
    expect(cb.phase("src")).toBe("closed");
  });
});

describe("CircuitBreaker — OPEN (fast-fail)", () => {
  it("3 falhas consecutivas abrem o circuito; daí fast-fail SEM chamar fn", async () => {
    const cb = new CircuitBreaker();
    const fn = vi.fn(boom);

    for (let i = 0; i < 3; i++) {
      await expect(cb.exec("src", fn)).rejects.toThrow("falha de fonte");
    }
    expect(fn).toHaveBeenCalledTimes(3);
    expect(cb.phase("src")).toBe("open");

    // Aberto: rejeita com mensagem de fast-fail e NÃO invoca fn de novo.
    await expect(cb.exec("src", fn)).rejects.toThrow(/ABERTO — fast-fail/);
    expect(fn).toHaveBeenCalledTimes(3); // inalterado
  });

  it("isola chaves: abrir 'a' não afeta 'b'", async () => {
    const cb = new CircuitBreaker();
    const fn = vi.fn(boom);

    for (let i = 0; i < 3; i++) await expect(cb.exec("a", fn)).rejects.toThrow();
    expect(cb.phase("a")).toBe("open");
    expect(cb.phase("b")).toBe("closed"); // chave independente
  });
});

describe("CircuitBreaker — HALF-OPEN (recuperação após cooldown)", () => {
  it("após o cooldown vira half-open; sucesso FECHA o circuito", async () => {
    const cb = new CircuitBreaker();
    const fn = vi.fn(boom);

    for (let i = 0; i < 3; i++) await expect(cb.exec("src", fn)).rejects.toThrow();
    expect(cb.phase("src")).toBe("open");

    // 1ms antes do fim do cooldown: ainda aberto (fast-fail).
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1);
    expect(cb.phase("src")).toBe("open");

    // No marco do cooldown: half-open → 1 tentativa de prova é permitida.
    await vi.advanceTimersByTimeAsync(1);
    expect(cb.phase("src")).toBe("half-open");

    const success = vi.fn(ok("vivo"));
    await expect(cb.exec("src", success)).resolves.toBe("vivo");
    expect(success).toHaveBeenCalledTimes(1); // a prova rodou de verdade
    expect(cb.phase("src")).toBe("closed"); // reset total
  });

  it("se a prova half-open falha, REABRE por todo o cooldown", async () => {
    const cb = new CircuitBreaker();
    const fn = vi.fn(boom);

    for (let i = 0; i < 3; i++) await expect(cb.exec("src", fn)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
    expect(cb.phase("src")).toBe("half-open");

    // Prova falha → reabre (novo openedAt).
    await expect(cb.exec("src", fn)).rejects.toThrow("falha de fonte");
    expect(cb.phase("src")).toBe("open");

    // E o cooldown recomeça: meio cooldown depois ainda aberto.
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS / 2);
    expect(cb.phase("src")).toBe("open");
  });

  it("respeita threshold e cooldown customizados", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const fn = vi.fn(boom);

    await expect(cb.exec("src", fn)).rejects.toThrow(); // 1 falha basta
    expect(cb.phase("src")).toBe("open");

    await vi.advanceTimersByTimeAsync(1000);
    expect(cb.phase("src")).toBe("half-open");
  });
});

describe("withDeadline", () => {
  it("resolve normal quando a promise ganha a corrida", async () => {
    const onTimeout = vi.fn();
    const p = withDeadline(Promise.resolve("rápido"), 5000, "op", onTimeout);
    await expect(p).resolves.toBe("rápido");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("rejeita no deadline e dispara onTimeout (mata socket pendurado)", async () => {
    const onTimeout = vi.fn();
    const never = new Promise<string>(() => {}); // nunca resolve
    const p = withDeadline(never, 30_000, "IMAP host", onTimeout);
    const settled = p.catch((e: unknown) => e); // captura p/ evitar unhandled

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1); // 30s exatos
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/deadline de 30000ms estourado/);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("erro no onTimeout não vaza (cleanup defensivo)", async () => {
    const onTimeout = vi.fn(() => {
      throw new Error("close() explodiu");
    });
    const never = new Promise<string>(() => {});
    const p = withDeadline(never, 1000, "op", onTimeout);
    const settled = p.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1000);
    const err = await settled;
    // O erro propagado é o do DEADLINE, não o do cleanup (engolido).
    expect((err as Error).message).toMatch(/deadline de 1000ms/);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
