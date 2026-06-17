import { Job, JobAdapter, AdapterContext } from "../core/types";
import { fetchWithTimeout, hashSourceId, resolveTrackingUrl } from "../core/utils";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";

export type EmailParser = (html: string, subject: string, date: Date) => Job[];

export const parseLinkedInDigest: EmailParser = (html, subject, date) => {
  const jobs: Job[] = [];
  const $ = cheerio.load(html);

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();
    if (!link || !link.includes("linkedin.com/jobs/view/")) return;

    const titleMatch = text.match(/(.+) at (.+)/);
    const title = titleMatch ? titleMatch[1].trim() : text;
    const company = titleMatch ? titleMatch[2].trim() : "LinkedIn";

    jobs.push({
      source: "linkedin-email",
      // sourceId determinístico: company + title + url-base (sem params de tracking)
      sourceId: hashSourceId(company, title, link),
      company,
      title: title || "Nova Vaga",
      location: null,
      description: null,
      applyUrl: link,
      updatedAt: date,
    });
  });

  return jobs;
};

export const parseGupyAlert: EmailParser = (html, subject, date) => {
  const jobs: Job[] = [];
  const $ = cheerio.load(html);

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();
    if (!link || !link.includes(".gupy.io/jobs/")) return;

    const companyMatch = link.match(/https?:\/\/([^.]+)\.gupy\.io/);
    const company = companyMatch ? companyMatch[1] : "Gupy";

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

function isInfoJobsJunkTitle(title: string): boolean {
  if (title.length < 3) return true;
  if (INFOJOBS_JUNK_TITLE.some((re) => re.test(title))) return true;
  // Bloco de localização/salário sem código de vaga → ruído.
  return INFOJOBS_LOCATION_NOISE.test(title) && !INFOJOBS_JOB_CODE.test(title);
}

// Id base da vaga: "__11716514.aspx" → "11716514". Agrupa anchors da mesma vaga.
function infoJobsJobId(url: string): string | null {
  const m = url.match(/__(\d+)/) ?? url.match(/(\d{6,})\.aspx/i);
  return m ? m[1] : null;
}

// Prefere título com código+cargo ("11429998 - Técnico...") > com código > qualquer.
function infoJobsTitleScore(title: string): number {
  if (/^\d+\s*[-–]\s*\S/.test(title)) return 3;
  if (INFOJOBS_JOB_CODE.test(title)) return 2;
  return 1;
}

function extractInfoJobsCompany(parentText: string): string | null {
  const named = parentText.match(/A empresa\s+(.+?)\s+est[áa]\s+selecionando/i);
  if (named) return named[1].trim();
  const fallback = parentText.match(/^([^\n\r|–\-]{2,50})/);
  return fallback ? fallback[1].trim() : null;
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
    const company = companyMatch ? companyMatch[1].trim() : "Vagas.com";

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
  const namePart = from.split("<")[0].replace(/"/g, "").trim();
  const bracket = namePart.match(/[[(]\s*([^\])]+?)\s*[\])]/);
  const raw = (bracket ? bracket[1] : namePart).replace(/["[\]()]/g, "").trim();
  if (!raw) return "";
  // Já tem maiúscula (ex.: "UMC") → preserva. Tudo minúsculo → Title Case.
  return /[A-Z]/.test(raw) ? raw : raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstJobLink(html: string): string {
  const $ = cheerio.load(html);
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

// Fallback para remetentes sem parser dedicado (Zallpy, UMC, recrutadores).
// Extrai 1 vaga do assunto + remetente. Descrição = texto puro (sem HTML).
export function parseGenericJobEmail(from: string, subject: string, body: string, date: Date): Job[] {
  const title = cleanSubjectToTitle(subject);
  const company = companyFromSender(from);
  if (!title || !company) return [];

  const applyUrl = firstJobLink(body);
  const text = cheerio.load(body).root().text().replace(/\s+/g, " ").trim();
  const description = text ? text.slice(0, 2000) : null;

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

export function emailAlertAdapter(config: { host: string; port: number; user: string; pass: string }): JobAdapter {
  return {
    name: `Email Alerts (${config.user})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      const jobs: Job[] = [];

      console.log(`[EmailAlertAdapter] 📧 Iniciando (user=${config.user || "(vazio)"})`);

      if (!config.host || !config.user || !config.pass) {
        console.warn(`[EmailAlertAdapter] ⚠️  Credenciais IMAP ausentes — pulando adapter.`);
        return jobs;
      }

      // IMAP_ALLOW_SELF_SIGNED=true: escape hatch quando antivírus faz SSL inspection
      // e --use-system-ca não está disponível (ex: Node < 22).
      // Preferência: NODE_OPTIONS=--use-system-ca (injetado via cross-env no package.json).
      const rejectUnauthorized = process.env.IMAP_ALLOW_SELF_SIGNED !== "true";
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

      try {
        console.log(`[EmailAlertAdapter] 🔌 Conectando a ${config.host}:${config.port}...`);
        await client.connect();
        console.log(`[EmailAlertAdapter] ✅ Conectado ao IMAP`);

        const lock = await client.getMailboxLock("INBOX");
        try {
          const totalMessages = (client.mailbox as { exists?: number } | null)?.exists ?? 0;
          console.log(`[EmailAlertAdapter] 📬 INBOX contém ${totalMessages} e-mail(s)`);

          if (totalMessages === 0) {
            console.log(`[EmailAlertAdapter] 📭 INBOX vazio — nenhuma vaga extraída.`);
          } else {
            let processed = 0;
            for await (const message of client.fetch("1:*", { source: true, envelope: true })) {
              if (!message.source) continue;
              processed++;

              try {
                const parsed = await simpleParser(message.source);
                const html = parsed.html || parsed.textAsHtml || "";
                const subject = parsed.subject || "";
                const date = parsed.date || new Date();
                const sender = parsed.from?.text?.toLowerCase() || "";

                let parsedJobs: Job[] = [];
                if (subject.toLowerCase().includes("linkedin") || sender.includes("linkedin.com")) {
                  parsedJobs = parseLinkedInDigest(html, subject, date);
                } else if (subject.toLowerCase().includes("gupy") || sender.includes("gupy")) {
                  parsedJobs = parseGupyAlert(html, subject, date);
                } else if (sender.includes("@infojobs.com.br") || subject.toLowerCase().includes("infojobs")) {
                  parsedJobs = parseInfoJobsAlert(html, subject, date);
                } else if (sender.includes("@vagas.com.br") || subject.toLowerCase().includes("vagas.com")) {
                  parsedJobs = parseVagasComAlert(html, subject, date);
                } else {
                  parsedJobs = parseGenericJobEmail(parsed.from?.text ?? sender, subject, html, date);
                  if (parsedJobs.length === 0) {
                    console.log(`[EmailAlertAdapter]   ↷ ignorado — sem vaga extraível: "${sender}" / assunto: "${subject}"`);
                  }
                }

                if (parsedJobs.length > 0) {
                  console.log(`[EmailAlertAdapter]   ✦ ${parsedJobs.length} vaga(s) extraída(s) de "${subject}"`);
                }

                // Resolve redirect links de tracking antes de persistir
                for (const job of parsedJobs) {
                  const isTrackingUrl =
                    job.applyUrl.includes("linkedin.com/comm/") ||
                    job.applyUrl.includes("click.") ||
                    job.applyUrl.includes("redirect");
                  if (isTrackingUrl) {
                    job.applyUrl = await resolveTrackingUrl(job.applyUrl);
                  }
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
        console.error(`[EmailAlertAdapter] ❌ Erro na conexão IMAP:`, err);
      } finally {
        await client.logout();
      }

      console.log('📦 Vagas extraídas (brutas):', JSON.stringify(jobs, null, 2));
      return jobs;
    }
  };
}
