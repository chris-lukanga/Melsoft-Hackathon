import Papa from "papaparse";
import { createRequire } from "node:module";

export type ExtractionStatus = "readable" | "blank" | "unreadable" | "failed";
export interface ExtractionResult {
  text: string;
  status: ExtractionStatus;
  warnings: string[];
  pages?: number;
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

function normalize(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

/** Files are assessment data. Extraction never executes content or follows links. */
export async function extractDocumentText(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { text: "", status: "failed", warnings: ["This file exceeds the 5 MB limit."] };
  }
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") {
    try {
      // The package index runs a bundled debug fixture under ESM. Use its parser directly.
      const pdf = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as typeof import("pdf-parse");
      const pageLengths: number[] = [];
      const result = await pdf(buffer, {
        pagerender: async (page: { getTextContent: (options: object) => Promise<{ items: { str?: string }[] }> }) => {
          const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
          const text = content.items.map(item => item.str ?? "").join(" ");
          pageLengths.push(text.replace(/\s/g, "").length);
          return text;
        },
      });
      const text = normalize(result.text);
      const emptyPages = pageLengths.reduce((sum, length) => sum + (length < 5 ? 1 : 0), 0);
      if (!text || emptyPages > 0 || pageLengths.length !== result.numpages) {
        return {
          text,
          pages: result.numpages,
          status: "unreadable",
          warnings: [
            `Text could not be reliably extracted from ${emptyPages || result.numpages} of ${result.numpages} page(s). A scanned or blank page may be present. Provide text, a text-based PDF, or an OCR version before marking. Partial extraction will not be marked.`,
          ],
        };
      }
      if (text.length > MAX_TEXT_CHARS) return { text: "", status: "failed", pages: result.numpages, warnings: ["Extracted text exceeds 60,000 characters. Split this document into smaller files."] };
      return { text, pages: result.numpages, status: "readable", warnings: [] };
    } catch {
      return { text: "", status: "failed", warnings: ["PDF extraction failed. The file may be damaged or encrypted. Upload a readable text-based PDF or paste its text; this failure will not become a zero mark."] };
    }
  }
  if (extension !== "txt" && extension !== "csv") {
    return { text: "", status: "failed", warnings: ["Supported files are UTF-8 TXT, CSV and text-based PDF."] };
  }
  try {
    const text = normalize(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    if (text.length > MAX_TEXT_CHARS) return { text: "", status: "failed", warnings: ["Text exceeds 60,000 characters. Split it into smaller files."] };
    return { text, status: text ? "readable" : "blank", warnings: [] };
  } catch {
    return { text: "", status: "failed", warnings: ["The file is not valid UTF-8 text. Save it as UTF-8 TXT or CSV and upload it again."] };
  }
}

export interface SubmissionCsvRow {
  learnerId: string;
  response: string;
  status: "received" | "blank" | "missing";
}

export function parseSubmissionCsv(text: string): { rows: SubmissionCsvRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: header => header.trim().toLowerCase() });
  const errors = parsed.errors.map(error => `CSV row ${(error.row ?? 0) + 2}: ${error.message}`);
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("learner_id") || !fields.includes("response")) {
    errors.push("Submission CSV requires learner_id and response headers. An optional status column accepts received, blank or missing.");
    return { rows: [], errors };
  }
  if (parsed.data.length > 100) errors.push("A CSV can contain at most 100 submissions.");
  const rows = parsed.data.slice(0, 100).map((row, index) => {
    const learnerId = (row.learner_id ?? "").trim();
    const response = (row.response ?? "").trim();
    const requested = (row.status ?? "").trim().toLowerCase();
    if (!learnerId) errors.push(`CSV row ${index + 2} is missing learner_id.`);
    if (requested && !["received", "blank", "missing"].includes(requested)) errors.push(`CSV row ${index + 2} has an invalid status.`);
    if (requested === "blank" && response) errors.push(`CSV row ${index + 2} is marked blank but contains a response.`);
    if (requested === "missing" && response) errors.push(`CSV row ${index + 2} is marked missing but contains a response.`);
    const status = requested === "missing" ? "missing" : response ? "received" : "blank";
    return { learnerId, response, status } as SubmissionCsvRow;
  });
  return { rows, errors };
}

export function parseRosterCsv(text: string): { rows: { learnerId: string; name: string; email: string }[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: header => header.trim().toLowerCase() });
  const errors = parsed.errors.map(error => error.message);
  if (!["learner_id", "name"].every(header => parsed.meta.fields?.includes(header))) {
    return { rows: [], errors: ["Roster CSV requires learner_id and name headers; email is optional."] };
  }
  const seen = new Set<string>();
  const rows = parsed.data.map((row, index) => {
    const learnerId = row.learner_id?.trim() ?? "";
    const name = row.name?.trim() ?? "";
    if (!learnerId || !name) errors.push(`Roster row ${index + 2} requires a learner ID and name.`);
    if (seen.has(learnerId)) errors.push(`Roster row ${index + 2} duplicates learner ${learnerId}.`);
    seen.add(learnerId);
    return { learnerId, name, email: row.email?.trim() ?? "" };
  });
  return { rows, errors };
}
