import { db } from './db';
import { userDTO } from './auth';
import type { AssessmentDTO, ClassReport, Criterion, CriterionScore, IssueDTO, PlanStep } from './types';
import type { Issue, Result } from '@prisma/client';
export function json<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
export const issueDTO = (i: Issue): IssueDTO => ({ id: i.id, code: i.code, message: i.message, blocking: i.blocking, resolved: i.resolved, resolution: i.resolution, submissionId: i.submissionId });
export const resultDTO = (r: Result) => ({ id: r.id, scores: json<CriterionScore[]>(r.scoresJson, []), feedback: r.feedback, total: r.total, maxTotal: r.maxTotal, percentage: r.percentage, status: r.status, reviewerFlags: json<string[]>(r.reviewerFlagsJson, []), teacherEdited: r.teacherEdited, version: r.version, publishedAt: r.publishedAt?.toISOString() ?? null });
export const assessmentInclude = {
  class: true,
  submissions: { include: { learner: true, result: true, issues: true }, orderBy: { learnerId: 'asc' as const } },
  runs: { include: { tasks: true, events: { orderBy: { createdAt: 'asc' as const } } }, orderBy: { startedAt: 'desc' as const } },
  issues: true,
  documents: { select: { id: true, kind: true, filename: true, status: true } },
};
export async function getAssessmentDTO(id: string): Promise<AssessmentDTO> {
  const a = await db.assessment.findUniqueOrThrow({ where: { id }, include: assessmentInclude });
  return {
    id: a.id, title: a.title, classId: a.classId, class: { name: a.class.name, subject: a.class.subject },
    goal: a.goal, instructions: a.instructions, rubricText: a.rubricText, feedbackPreferences: a.feedbackPreferences,
    mode: a.mode as 'demo' | 'live', faultInjection: a.faultInjection, status: a.status, rubric: json<Criterion[]>(a.rubricJson, []),
    report: a.reportJson === '{}' ? null : json<ClassReport | null>(a.reportJson, null), createdAt: a.createdAt.toISOString(),
    submissions: a.submissions.map(s => ({ id: s.id, learnerId: s.learnerId, learner: userDTO(s.learner), sourceText: s.sourceText, extractionStatus: s.extractionStatus, filename: s.filename, result: s.result ? resultDTO(s.result) : null, issues: s.issues.map(issueDTO) })),
    runs: a.runs.map(r => ({ id: r.id, status: r.status, stage: r.stage, plan: json<PlanStep[]>(r.planJson, []), toolCount: r.toolCount, modelCalls: r.modelCalls, error: r.error, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
      tasks: r.tasks.map(t => ({ id: t.id, key: t.key, title: t.title, status: t.status, attempts: t.attempts, error: t.error })),
      events: r.events.map(e => ({ id: e.id, stage: e.stage, level: e.level, message: e.message, detail: e.detail, createdAt: e.createdAt.toISOString() })) })),
    issues: a.issues.map(issueDTO), documents: a.documents,
  };
}
