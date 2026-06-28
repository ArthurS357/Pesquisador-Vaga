import { describe, expect, it } from "vitest";
import { strictParse } from "../../core/llm-judge";

/**
 * strictParse com thinking mode: a resposta crua vem como `<think>…</think>{json}`.
 * O foco destes testes é a extração robusta do JSON final.
 */
describe("strictParse", () => {
  it("extrai o JSON após o bloco <think>…</think>", () => {
    const raw = `<think>This is a backend role, remote in Brazil, strong match.</think>
{"score": 85, "lens": "backend", "reasoning": "Direct backend role."}`;
    const r = strictParse(raw);
    expect(r).not.toBeNull();
    expect(r?.score).toBe(85);
    expect(r?.lens).toBe("backend");
  });

  it("não é envenenado por chaves { } dentro do <think>", () => {
    // O modelo rascunha o JSON dentro do raciocínio — o match guloso pegaria o
    // primeiro `{` (no think) e quebraria. O strip de <think> precede a extração.
    const raw = `<think>Draft: {"score": 10} but actually it's a strong fit.</think>
{"score": 90, "lens": "fullstack", "reasoning": "Strong full stack match."}`;
    const r = strictParse(raw);
    expect(r?.score).toBe(90);
    expect(r?.lens).toBe("fullstack");
  });

  it("tolera <think> truncado (sem fechamento) retornando null", () => {
    const raw = `<think>Reasoning got cut off by num_predict and never produced JSON`;
    expect(strictParse(raw)).toBeNull();
  });

  it("clampa score fora de 0-100 e normaliza lens inválida para generic", () => {
    const raw = `{"score": 150, "lens": "wizard", "reasoning": "x"}`;
    const r = strictParse(raw);
    expect(r?.score).toBe(100);
    expect(r?.lens).toBe("generic");
  });

  it("retorna null quando score não é número", () => {
    expect(strictParse(`{"score": "high", "lens": "backend", "reasoning": "x"}`)).toBeNull();
  });

  it("aceita JSON puro sem bloco de thinking", () => {
    const r = strictParse(`{"score": 55, "lens": "data", "reasoning": "Partial overlap."}`);
    expect(r?.score).toBe(55);
    expect(r?.lens).toBe("data");
  });
});
