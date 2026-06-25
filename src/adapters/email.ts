import { Job, JobAdapter, AdapterContext } from "../core/types";
import { hashSourceId, resolveTrackingUrl } from "../core/utils";
import { CircuitBreaker, withDeadline } from "../core/circuit-breaker";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";

export type EmailParser = (html: string, subject: string, date: Date) => Job[];

// O e-mail de "alerta de vaga" do LinkedIn (jobalerts-noreply@linkedin.com) lista
// vagas recomendadas. Cada vaga é um <table> contendo:
//   <a href=".../comm/jobs/view/<id>...">Título da vaga</a>   (texto = só o título)
//   <p>Empresa · Localização</p>                              (contém " · ")
//   <p class="job-card-flavor__detail">Recrutando agora</p>   (ruído)
// O mesmo href aparece em 2-3 anchors (logo vazio, bloco completo, título).
// Usamos o anchor cujo texto NÃO contém " · " como título e o agrupamos por id.

// Títulos que são cabeçalho/CTA do e-mail, nunca uma vaga.
const LINKEDIN_JUNK_TITLE = /(seu alerta de vaga|veja todas as vagas|ver vaga|recrutando agora)/i;

// Separa "Empresa · Localização". Retorna company sempre; location pode ser null.
function splitCompanyLocation(text: string): { company: string; location: string | null } {
  const idx = text.indexOf(" · ");
  if (idx === -1) return { company: text.trim(), location: null };
  return {
    company: text.slice(0, idx).trim(),
    location: text.slice(idx + 3).trim() || null,
  };
}

export function parseLinkedInJobAlert(html: string, date: Date): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];
  const seen = new Set<string>();

  $('a[href*="/jobs/view/"]').each((_, el) => {
    const $a = $(el);
    const link = $a.attr("href") || "";
    const title = $a.text().replace(/\s+/g, " ").trim();

    // Pula logo (texto vazio) e o anchor de bloco completo (contém " · ").
    if (!title || title.includes(" · ")) return;
    if (LINKEDIN_JUNK_TITLE.test(title)) return;

    // Agrupa por id da vaga — cada vaga só deve render uma vez.
    const idMatch = link.match(/\/jobs\/view\/(\d+)/);
    const id = idMatch?.[1] ?? link;
    if (seen.has(id)) return;
    seen.add(id);

    // "Empresa · Localização" mora num <p> dentro do mesmo card (<table>).
    let company = "LinkedIn";
    let location: string | null = null;
    const card = $a.closest("table");
    card.find("p").each((_, p) => {
      if (location !== null || company !== "LinkedIn") return;
      const t = $(p).text().replace(/\s+/g, " ").trim();
      if (t.includes(" · ")) {
        const split = splitCompanyLocation(t);
        company = split.company || "LinkedIn";
        location = split.location;
      }
    });

    console.log(`[EmailAlertAdapter] 📧 LinkedIn: extraída vaga "${title}" @ ${company}${location ? ` · ${location}` : ""}`);

    jobs.push({
      source: "linkedin-email",
      // sourceId determinístico: company + title + location são estáveis entre
      // e-mails; o applyUrl carrega params de tracking voláteis (não usar).
      sourceId: hashSourceId(company, title, location ?? ""),
      company,
      title,
      location,
      description: null,
      applyUrl: link,
      updatedAt: date,
    });
  });

  return jobs;
}

export const parseGupyAlert: EmailParser = (html, subject, date) => {
  const jobs: Job[] = [];
  const $ = cheerio.load(html);

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();
    // Cobre /jobs/ e /job/. Links embrulhados em tracking (click.gupy.io/...)
    // não casam aqui — o fallback genérico no adapter cobre esse caso.
    if (!link || !/\.gupy\.io\/jobs?\//i.test(link)) return;

    const companyMatch = link.match(/https?:\/\/([^.]+)\.gupy\.io/);
    const company = companyMatch?.[1] ?? "Gupy";

    jobs.push({
      source: "gupy-email",
      sourceId: hashSourceId(company, text, link),
      company,
      title: text || "Nova Vaga",
      location: null,
      description: null,
      applyUrl: link,
      updatedAt: date,
    });
  });

  return jobs;
};

// Títulos de anchors que nunca são vagas (CTA, rodapé, ajuda, categoria, slogan).
const INFOJOBS_JUNK_TITLE: RegExp[] = [
  /^candidatar-me$/i,
  /^cancelar o recebimento/i,
  /^precisa de ajuda\??$/i,
  /^milhares de vagas/i,
  /^informática,\s*ti,\s*telecomunicações/i,
];
// Sinais de bloco salário/localização (não é título de vaga sozinho).
const INFOJOBS_LOCATION_NOISE = /(R\$|CEP|Presencial|CLT|Período Integral)/i;
// Código numérico da vaga ("11429998 - Cargo" ou id na URL).
const INFOJOBS_JOB_CODE = /\b\d{5,}\b/;
// Só links de vaga real têm /vaga-de- ou /vaga- no path.
const INFOJOBS_VAGA_URL = /\/vaga(-de)?-/i;

// Exportadas para teste unitário (funções puras). Não use fora do parser InfoJobs.
export function isInfoJobsJunkTitle(title: string): boolean {
  if (title.length < 3) return true;
  if (INFOJOBS_JUNK_TITLE.some((re) => re.test(title))) return true;
  // Bloco de localização/salário sem código de vaga → ruído.
  return INFOJOBS_LOCATION_NOISE.test(title) && !INFOJOBS_JOB_CODE.test(title);
}

// Id base da vaga: "__11716514.aspx" → "11716514". Agrupa anchors da mesma vaga.
export function infoJobsJobId(url: string): string | null {
  const m = url.match(/__(\d+)/) ?? url.match(/(\d{6,})\.aspx/i);
  return m?.[1] ?? null;
}

// Prefere título com código+cargo ("11429998 - Técnico...") > com código > qualquer.
function infoJobsTitleScore(title: string): number {
  if (/^\d+\s*[-–]\s*\S/.test(title)) return 3;
  if (INFOJOBS_JOB_CODE.test(title)) return 2;
  return 1;
}

export function extractInfoJobsCompany(parentText: string): string | null {
  const named = parentText.match(/A empresa\s+(.+?)\s+est[áa]\s+selecionando/i);
  if (named) return named[1]?.trim() ?? null;
  const fallback = parentText.match(/^([^\n\r|–\-]{2,50})/);
  return fallback?.[1]?.trim() ?? null;
}

// InfoJobs envia alertas de emprego com links contendo /vagas/ ou formato
// /vaga-de-[slug]_i[id].aspx. Estrutura exata do HTML varia por campanha —
// se InfoJobs mudar o template do e-mail, revisar esta função.
export const parseInfoJobsAlert: EmailParser = (html, _subject, date) => {
  const $ = cheerio.load(html);
  type Acc = { title: string; titleScore: number; link: string; company: string };
  const groups = new Map<string, Acc>();

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();
    if (!link || !/infojobs\.com\.br/i.test(link)) return;
    if (!INFOJOBS_VAGA_URL.test(link)) {
      console.log(`[EmailAlertAdapter] 🚫 InfoJobs descartado (URL não-vaga): "${text || link}"`);
      return;
    }
    if (isInfoJobsJunkTitle(text)) {
      console.log(`[EmailAlertAdapter] 🚫 InfoJobs descartado (título lixo): "${text}"`);
      return;
    }

    const key = infoJobsJobId(link) ?? link;
    const parentText = $(el).closest("td, div, li").text().replace(text, "").trim();
    const company = extractInfoJobsCompany(parentText) ?? "InfoJobs";
    const titleScore = infoJobsTitleScore(text);

    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { title: text, titleScore, link, company });
      return;
    }
    if (titleScore > prev.titleScore) {
      prev.title = text;
      prev.titleScore = titleScore;
      prev.link = link;
    }
    if (prev.company === "InfoJobs" && company !== "InfoJobs") prev.company = company;
  });

  const jobs: Job[] = [];
  for (const acc of groups.values()) {
    if (!acc.title || !acc.company) continue;
    console.log(`[EmailAlertAdapter] 📦 InfoJobs vaga: "${acc.title}" @ ${acc.company}`);
    jobs.push({
      source: "infojobs-email",
      sourceId: hashSourceId(acc.company, acc.title, acc.link),
      company: acc.company,
      title: acc.title,
      location: null,
      description: null,
      applyUrl: acc.link,
      updatedAt: date,
    });
  }

  return jobs;
};

// Vagas.com envia alertas com links no padrão /vagas-de-[slug]+[id].html ou
// /vaga-de-[title]+[id].html. Estrutura exata varia — revisar se o template mudar.
export const parseVagasComAlert: EmailParser = (html, _subject, date) => {
  const jobs: Job[] = [];
  const $ = cheerio.load(html);

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();
    if (!link || !/vagas\.com\.br/i.test(link)) return;
    if (text.length < 3) return;

    const parentText = $(el).closest("td, div, li").text().replace(text, "").trim();
    const companyMatch = parentText.match(/^([^\n\r|–\-]{2,50})/);
    const company = companyMatch?.[1]?.trim() ?? "Vagas.com";

    jobs.push({
      source: "vagascom-email",
      sourceId: hashSourceId(company, text, link),
      company,
      title: text,
      location: null,
      description: null,
      applyUrl: link,
      updatedAt: date,
    });
  });

  return jobs;
};

// Prefixos comuns de assunto de e-mail de vaga (removidos do título).
const SUBJECT_PREFIX = /^(oportunidade para|vaga:?|vaga de|nova vaga:?|contrata-se:?)\s+/i;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
// Pistas de que um link é de vaga (path ou domínio de ATS).
const JOB_LINK_HINT = /\/(vaga|vagas|job|jobs|career|careers|oportunidade)/i;
const JOB_DOMAIN_HINT = /(gupy\.io|solides\.com|kenoby\.com|vagas\.com)/i;

function cleanSubjectToTitle(subject: string): string {
  // Normaliza whitespace antes do prefixo — senão espaço líder quebra o ^.
  return subject.replace(EMOJI, "").replace(/\s+/g, " ").trim().replace(SUBJECT_PREFIX, "").trim();
}

// "victória neves [ zallpy ]" <e@x> → "Zallpy". Prefere conteúdo entre [ ]/( ).
function companyFromSender(from: string): string {
  const namePart = (from.split("<")[0] ?? "").replace(/"/g, "").trim();
  const bracket = namePart.match(/[[(]\s*([^\])]+?)\s*[\])]/);
  const raw = (bracket?.[1] ?? namePart).replace(/["[\]()]/g, "").trim();
  if (!raw) return "";
  // Já tem maiúscula (ex.: "UMC") → preserva. Tudo minúsculo → Title Case.
  return /[A-Z]/.test(raw) ? raw : raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstJobLink($: ReturnType<typeof cheerio.load>): string {
  let fallback = "";
  let found = "";
  $("a").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href");
    if (!href || !/^https?:/i.test(href)) return;
    if (JOB_LINK_HINT.test(href) || JOB_DOMAIN_HINT.test(href)) {
      found = href;
      return;
    }
    if (!fallback) fallback = href;
  });
  return found || fallback;
}

// Palavras-chave (PT + EN) que sinalizam e-mail de vaga. Sem nenhuma delas — e
// sem link de vaga no corpo — um e-mail genérico (newsletter, fatura, promo)
// NÃO vira vaga. Evita falso positivo no catch-all.
const JOB_KEYWORDS =
  /(vaga|oportunidade|emprego|contrata|desenvolvedor|programador|analista|engenheir|developer|engineer|est[áa]gi|tech lead|software|back[\s-]?end|front[\s-]?end|full[\s-]?stack|devops|dados|\bdata\b|\bqa\b|pleno|j[úu]nior|s[êe]nior|recruta|talent)/i;

// True se o corpo tem ao menos um link com pista de vaga (path/domínio de ATS).
// Não usa o fallback "qualquer link" do firstJobLink — exige sinal real.
function hasJobLink($: ReturnType<typeof cheerio.load>): boolean {
  let hit = false;
  $("a").each((_, el) => {
    if (hit) return;
    const href = $(el).attr("href");
    if (href && (JOB_LINK_HINT.test(href) || JOB_DOMAIN_HINT.test(href))) hit = true;
  });
  return hit;
}

// E-mail parece de vaga se o assunto bate keyword OU o corpo traz link de vaga.
export function looksLikeJobEmail(subject: string, body: string): boolean {
  return JOB_KEYWORDS.test(subject) || hasJobLink(cheerio.load(body));
}

// Fallback para remetentes sem parser dedicado (Zallpy, UMC, recrutadores).
// Extrai 1 vaga do assunto + remetente. Descrição = texto puro (sem HTML).
export function parseGenericJobEmail(from: string, subject: string, body: string, date: Date): Job[] {
  const title = cleanSubjectToTitle(subject);
  const company = companyFromSender(from);
  if (!title || !company) return [];

  // Uma única árvore DOM reaproveitada p/ detecção + extração (antes: 3-4 loads
  // da mesma string HTML por e-mail). Corta CPU/RAM de parsing.
  const $ = cheerio.load(body);
  if (!JOB_KEYWORDS.test(subject) && !hasJobLink($)) {
    console.log(`[EmailAlertAdapter]   ↷ genérico ignorado — sem sinal de vaga: assunto "${subject}"`);
    return [];
  }

  const applyUrl = firstJobLink($);
  const text = $.root().text().replace(/\s+/g, " ").trim();
  // Cheerio já devolveu texto cru (sem tags) → aqui só capamos e embrulhamos no
  // mesmo fence de isolamento de IA do sanitizer (Blueprint D) p/ blindar contra
  // prompt injection. Sem strip de tag de propósito (não há markup a remover).
  const description = text ? `\n\`\`\`[UNTRUSTED_INGEST]\n${text.slice(0, 2000)}\n\`\`\`\n` : null;

  console.log(`[EmailAlertAdapter] 📦 Genérico vaga: "${title}" @ ${company}`);
  return [
    {
      source: "email-generic",
      sourceId: hashSourceId(from, subject, applyUrl),
      company,
      title,
      location: null,
      description,
      applyUrl,
      updatedAt: date,
    },
  ];
}

// Formata uma data no padrão de busca IMAP (ex.: "10-Jun-2026").
const IMAP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatImapDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${IMAP_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// Fallback de primeira execução: olhar os últimos 7 dias de e-mails.
const DEFAULT_LOOKBACK_DAYS = 7;

// Deadline absoluto da sessão IMAP (connect→search→fetch). Estourou → close().
const IMAP_DEADLINE_MS = 30_000;
// Disjuntor de processo: 3 falhas consecutivas → OPEN 5min. Singleton p/ valer
// entre ticks do worker (cron) — fast-fail enquanto a fonte está caída.
const emailBreaker = new CircuitBreaker();

/**
 * Sessão IMAP: conecta, busca a janela e parseia. Re-lança erro de conexão p/ o
 * circuit breaker contabilizar a falha. `client.logout()` SEMPRE no `finally`
 * (engolido se o socket já caiu) — mata socket zumbi. Erros de parsing por
 * e-mail seguem isolados no try interno (não derrubam a sessão nem o breaker).
 */
async function imapSession(client: ImapFlow, ctx: AdapterContext | undefined): Promise<Job[]> {
  const jobs: Job[] = [];
  try {
    console.log(`[EmailAlertAdapter] 🔌 Conectando ao IMAP...`);
    await client.connect();
    console.log(`[EmailAlertAdapter] ✅ Conectado ao IMAP`);

    const lock = await client.getMailboxLock("INBOX");
    try {
      // Janela incremental: usa ctx.since (último e-mail persistido) ou,
      // na primeira run, os últimos DEFAULT_LOOKBACK_DAYS dias.
      const sinceDate = ctx?.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
      const days = Math.max(1, Math.round((Date.now() - sinceDate.getTime()) / 86_400_000));
      console.log(`[EmailAlertAdapter] 📅 Buscando e-mails desde ${formatImapDate(sinceDate)} (${days} dia(s))`);

      // IMAP SINCE tem granularidade de dia — pequena sobreposição é OK
      // (o dedupe por source:sourceId no engine remove repetições).
      const searchResult = await client.search({ since: sinceDate });
      const seqList = Array.isArray(searchResult) ? searchResult : [];
      console.log(`[EmailAlertAdapter] 📬 ${seqList.length} e-mail(s) no intervalo`);

      if (seqList.length === 0) {
        console.log(`[EmailAlertAdapter] 📭 Nenhum e-mail novo — nenhuma vaga extraída.`);
      } else {
        let processed = 0;
        for await (const message of client.fetch(seqList, { source: true, envelope: true })) {
          if (!message.source) continue;
          processed++;

          try {
            const parsed = await simpleParser(message.source);
            const html = parsed.html || parsed.textAsHtml || "";
            const subject = parsed.subject || "";
            const date = parsed.date || new Date();
            const sender = parsed.from?.text?.toLowerCase() || "";

            let parsedJobs: Job[] = [];
            // Parser dedicado de remetente que SÓ manda vaga (não LinkedIn).
            // Se ele retornar 0, vale tentar o genérico antes de perder o e-mail.
            let dedicatedJobOnly = false;
            const genericFrom = parsed.from?.text ?? sender;
            const subjectLc = subject.toLowerCase();

            if (subjectLc.includes("linkedin") || sender.includes("linkedin.com")) {
              parsedJobs = parseLinkedInJobAlert(html, date);
            } else if (subjectLc.includes("gupy") || sender.includes("gupy")) {
              parsedJobs = parseGupyAlert(html, subject, date);
              dedicatedJobOnly = true;
            } else if (sender.includes("@infojobs.com.br") || subjectLc.includes("infojobs")) {
              parsedJobs = parseInfoJobsAlert(html, subject, date);
              dedicatedJobOnly = true;
            } else if (sender.includes("@vagas.com.br") || subjectLc.includes("vagas.com")) {
              parsedJobs = parseVagasComAlert(html, subject, date);
              dedicatedJobOnly = true;
            } else {
              parsedJobs = parseGenericJobEmail(genericFrom, subject, html, date);
              if (parsedJobs.length === 0) {
                console.log(`[EmailAlertAdapter]   ↷ ignorado — sem vaga extraível: "${sender}" / assunto: "${subject}"`);
              }
            }

            // Template do remetente mudou ou link veio embrulhado em tracking →
            // parser dedicado vazio. Tenta o genérico (assunto + remetente).
            if (dedicatedJobOnly && parsedJobs.length === 0) {
              const fallback = parseGenericJobEmail(genericFrom, subject, html, date);
              if (fallback.length > 0) {
                console.log(`[EmailAlertAdapter]   ↻ fallback genérico p/ "${sender}" — parser dedicado retornou 0`);
                parsedJobs = fallback;
              }
            }

            if (parsedJobs.length > 0) {
              console.log(`[EmailAlertAdapter]   ✦ ${parsedJobs.length} vaga(s) extraída(s) de "${subject}"`);
            }

            // Resolve redirect links de tracking antes de persistir.
            // Paralelizado em lotes de 5 (HEADs concorrentes em vez de serial):
            // um alerta com dezenas de vagas não enfileira RTTs até estourar o
            // IMAP_DEADLINE_MS. Mutação de applyUrl in-place, igual à versão serial.
            const needsResolve = parsedJobs.filter(
              (job) =>
                job.applyUrl.includes("linkedin.com/comm/") ||
                job.applyUrl.includes("click.") ||
                job.applyUrl.includes("redirect"),
            );
            const RESOLVE_CHUNK = 5;
            for (let k = 0; k < needsResolve.length; k += RESOLVE_CHUNK) {
              const batch = needsResolve.slice(k, k + RESOLVE_CHUNK);
              await Promise.all(
                batch.map(async (job) => {
                  job.applyUrl = await resolveTrackingUrl(job.applyUrl);
                }),
              );
            }

            jobs.push(...parsedJobs);
          } catch (parseErr) {
            console.warn(`[EmailAlertAdapter] ⚠️  Falha no parsing do e-mail #${processed}:`, parseErr);
          }
        }

        console.log(`[EmailAlertAdapter] 📊 ${processed} e-mail(s) processado(s) → ${jobs.length} vaga(s) extraída(s)`);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    // Re-lança p/ o circuit breaker contar a falha de conexão/busca.
    console.error(`[EmailAlertAdapter] ❌ Erro na sessão IMAP:`, err);
    throw err;
  } finally {
    // Mata socket zumbi SEMPRE. logout() pode lançar se o socket já caiu → engole.
    try {
      await client.logout();
    } catch {
      /* socket já encerrado (deadline/erro) — nada a fazer */
    }
  }

  return jobs;
}

export function emailAlertAdapter(config: { host: string; port: number; user: string; pass: string }): JobAdapter {
  return {
    name: `Email Alerts (${config.user})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      console.log(`[EmailAlertAdapter] 📧 Iniciando (user=${config.user || "(vazio)"})`);

      if (!config.host || !config.user || !config.pass) {
        console.warn(`[EmailAlertAdapter] ⚠️  Credenciais IMAP ausentes — pulando adapter.`);
        return []; // credencial ausente não é falha de fonte → não conta no breaker
      }

      // IMAP_ALLOW_SELF_SIGNED=true: escape hatch quando antivírus faz SSL inspection
      // e --use-system-ca não está disponível (ex: Node < 22).
      // Preferência: NODE_OPTIONS=--use-system-ca (injetado via cross-env no package.json).
      const rejectUnauthorized = process.env.IMAP_ALLOW_SELF_SIGNED !== "true";
      const breakerKey = `imap:${config.host}:${config.user}`;

      // Circuit breaker (fast-fail se aberto) + deadline absoluto (mata socket no estouro).
      return emailBreaker.exec(breakerKey, () => {
        const client = new ImapFlow({
          host: config.host,
          port: config.port,
          secure: true,
          auth: { user: config.user, pass: config.pass },
          logger: false,
          tls: {
            servername: config.host, // SNI explícito — necessário quando proxy reescreve handshake
            rejectUnauthorized,
          },
        });

        return withDeadline(imapSession(client, ctx), IMAP_DEADLINE_MS, `IMAP ${config.host}`, () => {
          // Deadline estourou: força close() pra derrubar o socket pendurado.
          console.error(`[EmailAlertAdapter] ⏱️  Deadline ${IMAP_DEADLINE_MS}ms — forçando close do IMAP`);
          // close() é síncrono (retorna void). Se o socket já morreu, pode lançar
          // de forma síncrona → embrulha p/ não escapar do gancho de timeout.
          try {
            client.close();
          } catch {
            /* socket já encerrado (deadline/erro) — nada a fazer */
          }
        });
      });
    },
  };
}
