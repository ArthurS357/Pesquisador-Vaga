import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_CHARS, sanitizeJobDescription } from "../../core/sanitizer";

/** Conteúdo interno do bloco fenced (sem os marcadores nem o trim das bordas). */
function inner(out: string): string {
  return out.replace(/^\n```\[UNTRUSTED_INGEST]\n/, "").replace(/\n```\n$/, "");
}

describe("sanitizeJobDescription — strip de tags", () => {
  it("remove markup cru deixando só o texto", () => {
    const out = sanitizeJobDescription("<p>Vaga <b>Sênior</b> de <i>Node</i></p>");
    expect(inner(out)).toBe("Vaga Sênior de Node");
  });

  it("remove blocos <script>/<style> com corpo e tudo", () => {
    const out = sanitizeJobDescription(
      "<style>.x{color:red}</style>Olá<script>alert('xss')</script> mundo",
    );
    const text = inner(out);
    expect(text).toBe("Olá mundo");
    expect(text).not.toMatch(/alert|color:red/);
  });

  it("remove comentários HTML", () => {
    expect(inner(sanitizeJobDescription("antes<!-- segredo -->depois"))).toBe("antes depois");
  });
});

describe("sanitizeJobDescription — INVARIANTE de segurança", () => {
  it("NUNCA des-escapa &lt;script&gt; para markup executável", () => {
    const out = sanitizeJobDescription("texto &lt;script&gt;alert(1)&lt;/script&gt; fim");
    const text = inner(out);
    // O angle-bracket real jamais reaparece a partir da entidade codificada.
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("</script>");
    // Permanece inerte como entidade textual.
    expect(text).toContain("&lt;script&gt;");
  });

  it("&amp;lt; não colapsa em &lt; executável (decode de &amp; é o último passo)", () => {
    const text = inner(sanitizeJobDescription("a &amp;lt; b"));
    expect(text).toBe("a &lt; b"); // vira entidade textual, não '<'
    expect(text).not.toContain("<");
  });
});

describe("sanitizeJobDescription — decode seguro de entidades inertes", () => {
  it("desfaz &amp; &quot; &#39; &nbsp;", () => {
    const text = inner(sanitizeJobDescription("R&amp;D &quot;top&quot; it&#39;s&nbsp;ok"));
    expect(text).toBe('R&D "top" it\'s ok');
  });
});

describe("sanitizeJobDescription — colapso de whitespace", () => {
  it("múltiplos espaços/quebras viram um espaço só", () => {
    expect(inner(sanitizeJobDescription("linha1\n\n\n   linha2\t\tlinha3"))).toBe(
      "linha1 linha2 linha3",
    );
  });
});

describe("sanitizeJobDescription — teto de contexto", () => {
  it(`corta em ${MAX_DESCRIPTION_CHARS} chars`, () => {
    const huge = "x".repeat(MAX_DESCRIPTION_CHARS + 5000);
    const text = inner(sanitizeJobDescription(huge));
    expect(text.length).toBe(MAX_DESCRIPTION_CHARS);
  });
});

describe("sanitizeJobDescription — fencing e vazio", () => {
  it("embrulha o texto limpo nos marcadores de fronteira", () => {
    const out = sanitizeJobDescription("desc");
    expect(out).toBe("\n```[UNTRUSTED_INGEST]\ndesc\n```\n");
  });

  it("retorna string vazia quando não sobra texto (adapter mapeia p/ null)", () => {
    expect(sanitizeJobDescription("<br><hr>   <!--x-->")).toBe("");
    expect(sanitizeJobDescription("")).toBe("");
  });
});
