/**
 * /api/cleanup — GET dry run counts · POST execute cleanup
 *
 * GET  /api/cleanup?blocked=1&lowScore=1&all=1&olderThan=30&source=<s>
 * POST /api/cleanup  body: { action: CleanupAction, source?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import {
  getCleanupCounts,
  executeCleanup,
  listSources,
  type CleanupFilters,
} from "@/core/db-clean-core";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type CleanupAction = "blocked" | "low-score" | "source" | "older-than" | "all";

interface PostBody {
  action: CleanupAction;
  source?: string;
  olderThan?: number;
}

const VALID_ACTIONS: CleanupAction[] = [
  "blocked",
  "low-score",
  "source",
  "older-than",
  "all",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function actionToFilters(action: CleanupAction, body: PostBody): CleanupFilters {
  switch (action) {
    case "blocked":    return { blocked: true };
    case "low-score":  return { lowScore: true };
    case "source":     return { source: body.source };
    case "older-than": return { olderThan: body.olderThan ?? 30 };
    case "all":        return { all: true };
  }
}

// ── GET — dry run counts ──────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const [blocked, lowScore, olderThan, sources] = await Promise.all([
      getCleanupCounts(prisma, { blocked: true }),
      getCleanupCounts(prisma, { lowScore: true }),
      getCleanupCounts(prisma, { olderThan: 30 }),
      listSources(prisma),
    ]);

    // Source counts: uma query por fonte presente no banco
    const sourceCounts = await Promise.all(
      sources.map(async (src) => {
        const result = await getCleanupCounts(prisma, { source: src });
        return { source: src, count: result.total };
      })
    );

    const allResult = await getCleanupCounts(prisma, { all: true });

    return NextResponse.json({
      blocked: blocked.total,
      lowScore: lowScore.total,
      olderThan: olderThan.total,
      all: allResult.total,
      sources: sourceCounts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[API /cleanup GET]", msg);
    return NextResponse.json({ error: "Erro ao consultar banco." }, { status: 500 });
  }
}

// ── POST — execute cleanup ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido (esperado JSON)." }, { status: 400 });
  }

  // Validação manual — sem nova dependência
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const action = raw["action"] as CleanupAction | undefined;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action inválida. Valores permitidos: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const postBody: PostBody = { action };

  if (action === "source") {
    if (typeof raw["source"] !== "string" || raw["source"].trim() === "") {
      return NextResponse.json({ error: "source é obrigatório para action=source." }, { status: 400 });
    }
    postBody.source = raw["source"].trim();
  }

  if (action === "older-than") {
    const days = raw["olderThan"];
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1) {
      return NextResponse.json({ error: "olderThan deve ser um inteiro >= 1." }, { status: 400 });
    }
    postBody.olderThan = days;
  }

  try {
    const filters = actionToFilters(action, postBody);
    const result = await executeCleanup(prisma, filters);

    return NextResponse.json({
      removed: result.total,
      skipped: result.skipped,
      criteria: result.criteria,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[API /cleanup POST]", msg);
    return NextResponse.json({ error: "Erro ao remover vagas." }, { status: 500 });
  }
}
