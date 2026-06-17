import { collect } from "./core/engine";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { leverAdapter } from "./adapters/lever";
import { ashbyAdapter } from "./adapters/ashby";
import { emailAlertAdapter } from "./adapters/email";
import { prisma } from "./db/prisma";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// BOARDS — Lista de fontes ativas. Descomente/adicione empresas conforme necessário.
// Cada linha é um adapter configurado com o identificador da empresa na plataforma.
// ─────────────────────────────────────────────────────────────────────────────
const BOARDS = [
  // ── Greenhouse ─────────────────────────────────────────────────────────────
  greenhouseAdapter({ id: "stripe", name: "Stripe" }),
  // greenhouseAdapter({ id: "airbnb", name: "Airbnb" }),
  // greenhouseAdapter({ id: "shopify", name: "Shopify" }),
  // greenhouseAdapter({ id: "zendesk", name: "Zendesk" }),

  // ── Lever ──────────────────────────────────────────────────────────────────
  leverAdapter({ id: "netflix", name: "Netflix" }),
  // leverAdapter({ id: "figma", name: "Figma" }),
  // leverAdapter({ id: "linear", name: "Linear" }),
  // leverAdapter({ id: "attentive", name: "Attentive" }),

  // ── Ashby ──────────────────────────────────────────────────────────────────
  ashbyAdapter({ id: "discord", name: "Discord" }),
  // ashbyAdapter({ id: "notion", name: "Notion" }),
  // ashbyAdapter({ id: "reddit", name: "Reddit" }),
  // ashbyAdapter({ id: "mercury", name: "Mercury" }),

  // ── E-mail (LinkedIn / Gupy) ───────────────────────────────────────────────
  // Requer variáveis IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS no .env
  emailAlertAdapter({
    host: process.env.IMAP_HOST || "",
    port: Number(process.env.IMAP_PORT || 993),
    user: process.env.IMAP_USER || "",
    pass: process.env.IMAP_PASS || ""
  }),
];

/** Exportada para uso pelo worker.ts (cron) e testes. */
export async function runCollect(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Iniciando coleta de vagas...`);
    const jobs = await collect(BOARDS);

    console.log(`\n✓ ${jobs.length} vagas processadas\n`);
    for (const j of jobs.slice(0, 15)) {
      console.log(`• [${j.company}] ${j.title}`);
      console.log(`    ${j.location ?? "local não informado"} — ${j.applyUrl}`);
    }
    if (jobs.length > 15) console.log(`  ... e mais ${jobs.length - 15}`);
  } catch (e) {
    console.error("Falha geral na coleta:", e);
    // Não relança para não derrubar o worker — apenas loga
  } finally {
    await prisma.$disconnect();
  }
}

