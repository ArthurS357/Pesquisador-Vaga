/**
 * /api/collect — ponte fullstack para o motor de coleta CLI.
 *
 * GET  → status da coleta ({ running, startedAt }) para o card de comando.
 * POST → dispara `npm run collect` em background (fire-and-forget) e retorna
 *        de imediato. Não segura a request: a coleta roda no terminal do Node.
 */

import { NextResponse } from "next/server";
import { collectorStatus, startCollector } from "@/core/collector";

// Runtime Node (usa node:child_process) + sempre fresco (status muda a cada run).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(collectorStatus());
}

export function POST(): NextResponse {
  const result = startCollector();
  if (!result.started) {
    return NextResponse.json(
      { status: "already-running", ...collectorStatus() },
      { status: 409 },
    );
  }
  return NextResponse.json({ status: "dispatched", ...collectorStatus() });
}
