import { notFound } from "next/navigation";
import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import Link from "next/link";
import { prisma } from "@/db/prisma";
import { coverLetterFilename } from "@/core/generator";
import { JOB_STATUS } from "@/app/status";

// Lê o arquivo em cada request (carta pode ser regerada).
export const dynamic = "force-dynamic";

/** Escapa entidades HTML. Roda ANTES dos regex de markdown. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Remove bloco YAML frontmatter (---\n...\n---). */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(end + 4).trimStart();
}

/**
 * Markdown → HTML mínimo. Zero deps.
 * Cobre o que o Ollama gera para cartas de apresentação em prosa.
 *
 * Segurança: esc() primeiro → tags brutas do Ollama viram entidades.
 * Só <p>, <strong>, <em>, <br> são injetadas — por nós, não pelo input.
 */
function renderMarkdown(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = esc(para.trim());
      if (!safe) return "";
      const html = safe
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // ── Barreira 1: só chars válidos de CUID (sem slashes, pontos, sequências ..) ──
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) notFound();

  const job = await prisma.job.findUnique({
    where: { id },
    select: { company: true, sourceId: true, title: true, status: true },
  });
  if (!job) notFound();

  // coverLetterFilename usa slugify (→ só [a-z0-9-]), não aceita traversal.
  const relPath = coverLetterFilename(job.company, job.sourceId);

  // ── Barreira 2: path resolvido deve ficar dentro de output/cover-letters/ ──
  const safeBase = resolve(process.cwd(), "output", "cover-letters");
  const absPath = resolve(process.cwd(), relPath);
  if (!absPath.startsWith(safeBase + sep)) notFound();

  let raw: string;
  try {
    raw = await readFile(absPath, "utf-8");
  } catch {
    // Arquivo ausente: Ollama offline quando disparou, ou ainda gerando.
    return (
      <main style={pageStyle}>
        <Link href="/">← Voltar</Link>
        <h1 style={{ marginTop: "1rem" }}>Carta não encontrada</h1>
        <p>
          <strong>{job.title}</strong> @ {job.company}
        </p>
        <p style={{ color: "var(--danger)" }}>
          Arquivo não existe: <code>{relPath}</code>
        </p>
        {job.status === JOB_STATUS.GENERATING && (
          <p>Status GENERATING — geração em andamento. Recarregue em instantes.</p>
        )}
      </main>
    );
  }

  const html = renderMarkdown(stripFrontmatter(raw));

  return (
    <main style={pageStyle}>
      <Link href="/">← Voltar ao painel</Link>
      <h1 style={{ marginTop: "1rem" }}>Cover Letter</h1>
      <h2 style={{ fontWeight: "normal", color: "var(--text-dim)", marginTop: 0 }}>
        {job.title} @ {job.company}
      </h2>
      <hr />
      <article
        style={{ lineHeight: 1.7, maxWidth: 660 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 780,
  margin: "0 auto",
  padding: "1.5rem",
  fontFamily: "system-ui, sans-serif",
};
