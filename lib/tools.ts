import { z } from "zod";
import type { ClassReport, Criterion, CriterionScore } from "./types";
import { extractDocumentText } from "./extraction";

export const MAX_CORRECTIONS = 2;
export const criterionSchema = z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), maxScore: z.number().finite().positive().max(1000), description: z.string().min(1).max(3000) }).strict();
export const criterionScoreSchema = z.object({ criterionId: z.string().min(1), name: z.string().min(1), maxScore: z.number().finite().positive(), score: z.number().finite().min(0), evidence: z.string().max(10000), justification: z.string().min(1).max(4000), uncertainty: z.string().max(2000).optional() }).strict();
export const assessmentOutputSchema = z.object({ scores: z.array(criterionScoreSchema).min(1).max(30), feedback: z.string().min(1).max(6000), reviewerFlags: z.array(z.string().min(1).max(2000)).max(30).default([]) }).strict();
export const reviewOutputSchema = z.object({ flags: z.array(z.object({ criterionId: z.string().optional(), message: z.string().min(1).max(2000), blocking: z.boolean() }).strict()).max(30), feedbackSupported: z.boolean(), consistent: z.boolean(), requiresTeacherReview: z.boolean() }).strict();
export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;
export type ModelReview = z.infer<typeof reviewOutputSchema>;

function slug(text: string, index: number) { return `${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "criterion"}-${index + 1}`; }

/** Deliberately requires explicit criterion maxima, never guesses an implicit mark scheme. */
export function parseRubricText(text: string): Criterion[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("A rubric or marking memorandum with explicit criterion maxima is required.");
  let criteria: Criterion[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let value: unknown;
    try { value = JSON.parse(trimmed); } catch { throw new Error("The rubric JSON is invalid."); }
    const raw = Array.isArray(value) ? value : (value as { criteria?: unknown }).criteria;
    criteria = z.array(criterionSchema).min(1).max(30).parse(raw);
  } else {
    criteria = [];
    for (const raw of trimmed.split(/\r?\n/)) {
      const line = raw.trim().replace(/^[-*#]+\s*/, "");
      if (!line || /^total\b/i.test(line) || /^[-|:\s]+$/.test(line) || /^\|?\s*(?:criterion|criteria|name)\s*\|\s*(?:max(?:imum)?(?:\s*(?:marks?|score))?|marks?|score)\b/i.test(line)) continue;
      const parts = line.split("|").map(part => part.trim()).filter(Boolean);
      if (parts.length >= 2 && /^\d+(?:\.\d+)?(?:\s*(?:marks?|points?|pts?))?$/i.test(parts[1])) {
        criteria.push({ id: slug(parts[0], criteria.length), name: parts[0], maxScore: parseFloat(parts[1]), description: parts.slice(2).join(" | ") || parts[0] });
        continue;
      }
      const match = line.match(/^(.+?)\s*(?:\(|\[|:|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:marks?|points?|pts?)?\s*[)\]]?\s*[:–—-]?\s*(.*)$/i);
      if (match) criteria.push({ id: slug(match[1].trim(), criteria.length), name: match[1].trim(), maxScore: Number(match[2]), description: match[3].trim() || match[1].trim() });
      else throw new Error(`This rubric line could not be parsed safely: ${line.slice(0, 100)}. Use Name | maximum marks | description. No criteria have been silently omitted.`);
    }
    if (!criteria.length) throw new Error("No criterion maxima could be read. Use one line per criterion: Name | maximum marks | description, or supply rubric JSON.");
    criteria = z.array(criterionSchema).min(1).max(30).parse(criteria);
  }
  if (new Set(criteria.map(criterion => criterion.id)).size !== criteria.length || new Set(criteria.map(criterion => criterion.name.toLowerCase())).size !== criteria.length) throw new Error("Rubric criterion IDs and names must be unique.");
  const declared = [...trimmed.matchAll(/\btotal(?:\s+(?:marks?|points?))?\s*[:=]\s*(\d+(?:\.\d+)?)/gi)].map(match => Number(match[1]));
  const maximum = criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  if (declared.some(total => Math.abs(total - maximum) > 0.001)) throw new Error(`The declared rubric total conflicts with the criterion maxima (${maximum}). Clarify the maximum before marking.`);
  return criteria;
}

const submissionSchema = z.object({ id: z.string(), learnerId: z.string(), sourceText: z.string(), extractionStatus: z.enum(["received", "blank", "missing", "unreadable", "failed"]) });
export const validationInputSchema = z.object({ goal: z.string(), instructions: z.string(), rubricText: z.string(), rubric: z.array(criterionSchema), submissions: z.array(submissionSchema) });
export interface CheckIssue { code: string; message: string; blocking: boolean; criterionId?: string; }
export function validateAssessmentInputs(input: z.infer<typeof validationInputSchema>): { valid: boolean; issues: CheckIssue[] } {
  const issues: CheckIssue[] = [];
  if (!input.goal.trim()) issues.push({ code: "missing_goal", message: "Add the goal for this assessment.", blocking: true });
  if (!input.instructions.trim()) issues.push({ code: "missing_instructions", message: "Add the assessment instructions and questions.", blocking: true });
  if (!input.rubric.length) issues.push({ code: "missing_rubric", message: "A readable rubric with criterion maximum marks is required.", blocking: true });
  if (!input.submissions.length) issues.push({ code: "no_submissions", message: "Add at least one learner submission.", blocking: true });
  const total = input.rubric.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  const instructionTotals = [...input.instructions.matchAll(/\btotal(?:\s+(?:marks?|points?))?\s*[:=]\s*(\d+(?:\.\d+)?)/gi)].map(match => Number(match[1]));
  if (instructionTotals.some(maximum => Math.abs(maximum - total) > 0.001)) issues.push({ code: "conflicting_maximum", message: `The assessment instructions and rubric disagree on the maximum (${total} in the rubric). Clarify before marking.`, blocking: true });
  const ids = new Set<string>();
  for (const submission of input.submissions) {
    if (ids.has(submission.learnerId)) issues.push({ code: "duplicate_submission", message: `More than one submission is assigned to ${submission.learnerId}.`, blocking: true });
    ids.add(submission.learnerId);
    if (submission.extractionStatus === "received" && !submission.sourceText.trim()) issues.push({ code: "unconfirmed_blank", message: `Submission ${submission.id} has no text. Confirm it is blank before awarding zero.`, blocking: true });
    if (submission.extractionStatus === "blank" && submission.sourceText.trim()) issues.push({ code: "conflicting_blank", message: `Submission ${submission.id} is labelled blank but contains text.`, blocking: true });
  }
  return { valid: !issues.some(issue => issue.blocking), issues };
}

function rounded(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
export function calculateGradebook({ scores }: { scores: CriterionScore[] }) {
  const total = rounded(scores.reduce((sum, criterion) => sum + criterion.score, 0));
  const maxTotal = rounded(scores.reduce((sum, criterion) => sum + criterion.maxScore, 0));
  return { total, maxTotal, percentage: maxTotal > 0 ? rounded(total / maxTotal * 100) : 0 };
}

export function reviewDeterministic(input: { rubric: Criterion[]; scores: CriterionScore[]; sourceText: string; extractionStatus: string; total: number; maxTotal: number; percentage: number }): { valid: boolean; issues: CheckIssue[] } {
  const issues: CheckIssue[] = [];
  if (![input.total, input.maxTotal, input.percentage].every(Number.isFinite)) issues.push({ code: "incorrect_total", message: "The total, maximum and percentage must all be finite numbers.", blocking: true });
  if (!["received", "blank"].includes(input.extractionStatus)) issues.push({ code: "unmarkable_submission", message: "Missing, unreadable or failed submissions cannot receive a mark.", blocking: true });
  const seen = new Set<string>();
  for (const criterion of input.rubric) {
    const matches = input.scores.filter(score => score.criterionId === criterion.id);
    if (matches.length !== 1) { issues.push({ code: "criterion_coverage", criterionId: criterion.id, message: `Criterion ${criterion.name} must appear exactly once.`, blocking: true }); continue; }
    const score = matches[0];
    if (!Number.isFinite(score.score) || score.score < 0 || score.score > criterion.maxScore) issues.push({ code: "score_out_of_bounds", criterionId: criterion.id, message: `${criterion.name}: ${score.score} is outside 0–${criterion.maxScore}.`, blocking: true });
    if (score.maxScore !== criterion.maxScore || score.name !== criterion.name) issues.push({ code: "criterion_mismatch", criterionId: criterion.id, message: `${criterion.name} does not match the source rubric.`, blocking: true });
    if (score.evidence && !input.sourceText.includes(score.evidence)) issues.push({ code: "unsupported_evidence", criterionId: criterion.id, message: `${criterion.name} cites evidence that is absent from the learner response.`, blocking: true });
    if (score.score > 0 && !score.evidence.trim()) issues.push({ code: "missing_evidence", criterionId: criterion.id, message: `${criterion.name} has a positive score without supporting evidence.`, blocking: true });
    if (input.extractionStatus === "blank" && (score.score !== 0 || score.evidence)) issues.push({ code: "blank_invented_evidence", criterionId: criterion.id, message: "A confirmed blank answer must not contain invented evidence or positive marks.", blocking: true });
    seen.add(criterion.id);
  }
  if (input.scores.some(score => !seen.has(score.criterionId))) issues.push({ code: "unknown_criterion", message: "The result contains criteria absent from the rubric.", blocking: true });
  const calculated = calculateGradebook({ scores: input.scores });
  if (!issues.some(issue => issue.code === "incorrect_total") && (Math.abs(calculated.total - input.total) > 0.001 || Math.abs(calculated.maxTotal - input.maxTotal) > 0.001 || Math.abs(calculated.percentage - input.percentage) > 0.001)) issues.push({ code: "incorrect_total", message: `Stored total or percentage is incorrect. Expected ${calculated.total}/${calculated.maxTotal} (${calculated.percentage}%).`, blocking: true });
  return { valid: !issues.some(issue => issue.blocking), issues };
}

export interface ReportResult { scores: CriterionScore[]; total: number; maxTotal: number; percentage: number; status: string; }
export function generateClassReport(input: { results: ReportResult[]; submissionCount: number }): ClassReport {
  const results = input.results;
  const average = results.length ? rounded(results.reduce((sum, row) => sum + row.percentage, 0) / results.length) : 0;
  const distribution = [{ label: "0–29%", count: 0 }, { label: "30–49%", count: 0 }, { label: "50–69%", count: 0 }, { label: "70–100%", count: 0 }];
  for (const result of results) distribution[result.percentage < 30 ? 0 : result.percentage < 50 ? 1 : result.percentage < 70 ? 2 : 3].count++;
  const criterionIds = [...new Set(results.flatMap(row => row.scores.map(score => score.criterionId)))];
  const criteria = criterionIds.map(id => {
    const scores = results.flatMap(row => row.scores.filter(score => score.criterionId === id));
    return { name: scores[0].name, average: rounded(scores.reduce((sum, score) => sum + score.score, 0) / scores.length), maxScore: scores[0].maxScore };
  });
  const strengths = criteria.filter(criterion => criterion.average / criterion.maxScore >= 0.7).map(criterion => `${criterion.name}: average ${criterion.average}/${criterion.maxScore} across ${results.length} assessed responses.`);
  const difficulties = criteria.filter(criterion => criterion.average / criterion.maxScore < 0.7).map(criterion => {
    const below = results.filter(row => row.scores.some(score => score.name === criterion.name && score.score < score.maxScore * 0.7)).length;
    return `${criterion.name}: ${below} of ${results.length} assessed responses scored below 70% on this criterion; review the cited evidence before choosing follow-up teaching.`;
  });
  const approved = results.filter(row => ["approved", "published"].includes(row.status)).length;
  const published = results.filter(row => row.status === "published").length;
  return {
    assessed: results.length, approved, published, average, maxTotal: results[0]?.maxTotal ?? 0, distribution, criteria, strengths, difficulties,
    summary: `${results.length} of ${input.submissionCount} submissions have suggested marks. The mean is ${average}%; ${approved} results are approved and ${published} published. ${results.some(row => !["approved", "published"].includes(row.status)) ? "Draft results are included and require teacher approval. " : ""}These observations describe this assessment and do not establish the underlying cause of any learner's difficulty.`,
  };
}

export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const gradebookSchema = z.object({ total: z.number().finite(), maxTotal: z.number().finite(), percentage: z.number().finite() });
const checkIssueSchema = z.object({ code: z.string(), message: z.string(), blocking: z.boolean(), criterionId: z.string().optional() });
const reviewInputSchema = z.object({ rubric: z.array(criterionSchema), scores: z.array(criterionScoreSchema), sourceText: z.string(), extractionStatus: z.string(), total: z.number(), maxTotal: z.number(), percentage: z.number() });
const reportResultSchema = z.object({ scores: z.array(criterionScoreSchema), total: z.number(), maxTotal: z.number(), percentage: z.number(), status: z.string() });
const reportSchema: z.ZodType<ClassReport> = z.object({ assessed: z.number(), approved: z.number(), published: z.number(), average: z.number(), maxTotal: z.number(), distribution: z.array(z.object({ label: z.string(), count: z.number() })), criteria: z.array(z.object({ name: z.string(), average: z.number(), maxScore: z.number() })), strengths: z.array(z.string()), difficulties: z.array(z.string()), summary: z.string() });
const assessmentToolInput = z.object({ rubric: z.array(criterionSchema), instructions: z.string(), response: z.string(), pseudonym: z.string(), mode: z.enum(["demo", "live"]), feedbackPreferences: z.string() }).strict();

export const toolRegistry = {
  extract_document_text: { input: z.object({ filename: z.string().max(200), base64: z.string().max(7_000_000) }).strict(), output: z.object({ text: z.string(), status: z.enum(["readable", "blank", "unreadable", "failed"]), warnings: z.array(z.string()), pages: z.number().optional() }) },
  parse_rubric: { input: z.object({ text: z.string().max(60000) }).strict(), output: z.array(criterionSchema).min(1).max(30) },
  validate_assessment_inputs: { input: validationInputSchema.strict(), output: z.object({ valid: z.boolean(), issues: z.array(checkIssueSchema) }) },
  match_submission_to_learner: { input: z.object({ learnerId: z.string(), rosterIds: z.array(z.string()) }).strict(), output: z.object({ matched: z.boolean(), learnerId: z.string() }) },
  assess_response: { input: assessmentToolInput, output: assessmentOutputSchema },
  review_assessment: { input: reviewInputSchema.extend({ feedback: z.string().optional() }).strict(), output: z.object({ valid: z.boolean(), issues: z.array(checkIssueSchema) }) },
  calculate_gradebook: { input: z.object({ scores: z.array(criterionScoreSchema) }).strict(), output: gradebookSchema },
  generate_feedback: { input: z.object({ feedback: z.string().min(1).max(6000), sourceText: z.string(), scores: z.array(criterionScoreSchema) }).strict(), output: z.object({ feedback: z.string().min(1).max(6000) }) },
  generate_class_report: { input: z.object({ results: z.array(reportResultSchema), submissionCount: z.number().int().nonnegative() }).strict(), output: reportSchema },
  export_results: { input: z.object({ rows: z.array(z.object({ learnerId: z.string(), total: z.number(), maxTotal: z.number(), percentage: z.number(), status: z.string() })) }).strict(), output: z.object({ csv: z.string() }) },
} as const;
export const TOOL_NAMES = Object.keys(toolRegistry) as (keyof typeof toolRegistry)[];
export type ToolName = keyof typeof toolRegistry;
export const toolNameSchema = z.enum(TOOL_NAMES as [ToolName, ...ToolName[]]);

/** The only dispatcher. Model-proposed tool names and every argument/output are validated here. */
export async function executeRegisteredTool(name: string, input: unknown, handler?: (validated: never) => Promise<unknown> | unknown): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(toolRegistry, name)) throw new Error(`Tool ${name.slice(0, 80)} is not allowlisted.`);
  const tool = toolRegistry[name as ToolName];
  const validated = tool.input.parse(input);
  let output: unknown;
  if (handler) output = await handler(validated as never);
  else {
    switch (name) {
      case "extract_document_text": { const data = validated as z.infer<typeof toolRegistry.extract_document_text.input>; output = await extractDocumentText(Buffer.from(data.base64, "base64"), data.filename); break; }
      case "parse_rubric": output = parseRubricText((validated as { text: string }).text); break;
      case "validate_assessment_inputs": output = validateAssessmentInputs(validated as z.infer<typeof validationInputSchema>); break;
      case "match_submission_to_learner": { const data = validated as { learnerId: string; rosterIds: string[] }; output = { matched: data.rosterIds.includes(data.learnerId), learnerId: data.learnerId }; break; }
      case "calculate_gradebook": output = calculateGradebook(validated as { scores: CriterionScore[] }); break;
      case "review_assessment": output = reviewDeterministic(validated as z.infer<typeof reviewInputSchema>); break;
      case "generate_feedback": output = { feedback: (validated as unknown as { feedback: string }).feedback }; break;
      case "generate_class_report": output = generateClassReport(validated as { results: ReportResult[]; submissionCount: number }); break;
      case "export_results": { const rows = (validated as { rows: { learnerId: string; total: number; maxTotal: number; percentage: number; status: string }[] }).rows; output = { csv: "learner_id,total,max_total,percentage,status\r\n" + rows.map(row => [row.learnerId, row.total, row.maxTotal, row.percentage, row.status].map(csvCell).join(",")).join("\r\n") }; break; }
      default: throw new Error(`${name} requires a server-authorised worker handler.`);
    }
  }
  return tool.output.parse(output);
}
