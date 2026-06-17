import type { NextConfig } from "next";

/**
 * Painel de curadoria (Job Engine — Passo 6).
 * Roda 100% local (next dev). Não afeta os scripts CLI de coleta,
 * que continuam sendo executados via `tsx` fora do bundle do Next.
 */
const nextConfig: NextConfig = {
  // @prisma/client é dependência de servidor: nunca deve ir pro bundle do cliente.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
