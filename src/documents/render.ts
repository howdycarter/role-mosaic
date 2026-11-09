/**
 * The tailored documents as pages: plain HTML with system fonts, printed to PDF by the runner's
 * own Chrome over the DevTools protocol. No LaTeX, no library. Everything from the profile and
 * the writer is escaped before it reaches the page.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Page, type Target } from "../browser/cdp.js";
import { BROWSER, childEnv, DOCUMENTS } from "../config.js";
import type { QueueEntry } from "../jobs/queue.js";
import type { Profile } from "../profile/schema.js";
import type { Tailored } from "./tailor.js";
import { renderTemplate, type View } from "./template.js";
import { activeTemplate } from "./templates.js";

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** "2026-05" or "2026-05-01" as "May 2026"; anything else as it is. */
export const prettyMonth = (s: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(s.trim());
  if (!m) return s;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
};
const span = (start: string, end: string, current: boolean) => `${prettyMonth(start)} to ${current ? "present" : prettyMonth(end)}`;

const monthYear = (month: number | undefined, year: number | undefined) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][ (month ?? 0) - 1] ?? ""} ${year ?? ""}`.trim();

/** Everything a resume template may print, already in words: dates as "May 2026", the contact line joined. */
export function resumeView(profile: Profile, t: Tailored): View {
  const exp = t.experience.map((e) => {
    const src = profile.experience.find((x) => x.company.toLowerCase().includes(e.company.toLowerCase()) || e.company.toLowerCase().includes(x.company.toLowerCase()));
    return { title: e.title, company: e.company, location: src?.location ?? "", when: src ? span(src.start, src.end, src.current) : "", bullets: e.bullets };
  });
  const projects = t.projects.map((p) => {
    const src = profile.projects.find((x) => x.name.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(x.name.toLowerCase()));
    return { name: p.name, role: src?.role ?? "", link: src?.link ? src.link.replace(/^https?:\/\/(www\.)?/, "") : "", when: src ? span(src.start, src.end, /present|current|now/i.test(src.end) || !src.end) : "", bullets: p.bullets };
  });
  const education = profile.education.map((e) => ({ degree: e.degree, field: e.field, minor: e.minor ?? "", school: e.school, when: `${e.startYear ? `${e.startYear} to ` : ""}${e.status === "in_progress" ? "expected " : ""}${monthYear(e.gradMonth, e.gradYear)}` }));
  return {
    name: `${profile.name.first} ${profile.name.last}`,
    headline: t.headline,
    contact: contactText(profile),
    summary: t.summary,
    skills: t.skills.join(" \u00b7 "),
    skillList: t.skills,
    experience: exp,
    projects,
    education,
  };
}

/** Everything a cover letter template may print. */
export function coverView(profile: Profile, entry: { job: { company: string; title: string } }, t: Tailored): View {
  const letter = t.coverLetter;
  if (!letter) throw new Error("no cover letter was written");
  const name = `${profile.name.first} ${profile.name.last}`;
  const stripped = letter.closing.replace(new RegExp(`[,\\s]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?\\s*$`, "i"), "").trim();
  return {
    name,
    contact: contactText(profile),
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    company: entry.job.company,
    role: entry.job.title,
    greeting: letter.greeting,
    paragraphs: letter.paragraphs,
    closing: stripped ? (stripped.endsWith(",") ? stripped : `${stripped},`) : "Sincerely,",
  };
}

const contactText = (profile: Profile) => {
  const bits = [profile.email, `${profile.phone.countryCode} ${profile.phone.national}`, `${profile.address.city}, ${profile.address.regionCode || profile.address.region}`];
  const links = Object.entries(profile.links ?? {}).filter(([, v]) => typeof v === "string" && v) as [string, string][];
  for (const [, url] of links) bits.push(url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
  return bits.join(" \u00b7 ");
};

/** The resume through the template in use. */
export function resumeHtml(profile: Profile, t: Tailored): string {
  return renderTemplate(readFileSync(activeTemplate().resume, "utf8"), resumeView(profile, t));
}

/** The cover letter through the template in use. */
export function coverHtml(profile: Profile, entry: QueueEntry, t: Tailored): string {
  const template = activeTemplate();
  if (!existsSync(template.cover)) throw new Error(`the template ${template.name} has no cover.html`);
  return renderTemplate(readFileSync(template.cover, "utf8"), coverView(profile, entry, t));
}

/** How many pages a PDF holds, from its page objects. Enough to tell one page from two. */
export const pdfPages = (pdf: Buffer) => Math.max(1, (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length);

/** Apply a policy before any template content, including imported active HTML. */
export function privatePrintHtml(html: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">${html}`;
}

/** Prints in an isolated, sandboxed Chrome with scripts and network disabled before content loads. */
export async function printPdf(html: string, outFile: string): Promise<number> {
  const profile = mkdtempSync(path.join(tmpdir(), "mosaic-print-"));
  const child = spawn(BROWSER.chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], env: childEnv() });
  let page: Page | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("printing did not finish in time")), DOCUMENTS.printTimeoutMs); });
  const work = async () => {
    const port = await new Promise<string>((resolve, reject) => {
      let message = "";
      child.stderr.on("data", (b: Buffer) => {
        message = (message + b.toString()).slice(-8192);
        const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(message);
        if (match) resolve(match[1] as string);
      });
      child.on("error", () => reject(new Error("Could not start Chrome for private PDF printing")));
      child.on("close", () => reject(new Error("Chrome closed before printing was ready")));
    });
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    const targets = await response.json() as Target[];
    const target = targets.find(t => t.type === "page" && t.url === "about:blank");
    if (!target) throw new Error("Private print page unavailable");
    page = await Page.attach(target);
    // Browser-level controls are installed BEFORE loading any applicant or template content.
    await page.send("Emulation.setScriptExecutionDisabled", { value: true });
    await page.send("Network.setBlockedURLs", { urls: ["*"] });
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const frame = await page.mainFrame();
    await page.send("Page.setDocumentContent", { frameId: frame.id, html: privatePrintHtml(html) });
    const pdf = await page.send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
    const bytes = Buffer.from(pdf.data,"base64");
    if (bytes.subarray(0,5).toString() !== "%PDF-") throw new Error("Chrome did not return a PDF");
    // Atomic mode-safe replacement also repairs permissions on an older output file.
    const temporary = `${outFile}.${process.pid}.pdf.tmp`;
    writeFileSync(temporary,bytes,{mode:0o600,flag:"wx"});
    const { renameSync } = await import("node:fs");
    renameSync(temporary,outFile);
    return pdfPages(bytes);
  };
  try { return await Promise.race([work(),deadline]); }
  finally {
    if (timer) clearTimeout(timer);
    if (page) (page as Page).close();
    child.kill("SIGKILL");
    await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("close",()=>resolve()); });
    rmSync(profile,{recursive:true,force:true});
  }
}
