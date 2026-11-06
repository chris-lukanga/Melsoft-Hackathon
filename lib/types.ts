export type Mode = 'demo' | 'live';
export type Stage = 'Goal' | 'Plan' | 'Act' | 'Check' | 'Correct' | 'Deliver';
export interface Criterion { id: string; name: string; maxScore: number; description: string }
export interface CriterionScore { criterionId: string; name: string; maxScore: number; score: number; evidence: string; justification: string; uncertainty?: string }
export interface UserDTO { id: string; name: string; email: string; role: string; classId: string | null }
export interface ClassDTO { id: string; name: string; subject: string; learners: UserDTO[] }
export interface IssueDTO { id: string; code: string; message: string; blocking: boolean; resolved: boolean; resolution: string | null; submissionId: string | null }
export interface ResultDTO { id: string; scores: CriterionScore[]; feedback: string; total: number; maxTotal: number; percentage: number; status: string; reviewerFlags: string[]; teacherEdited: boolean; version: number; publishedAt: string | null }
export interface SubmissionDTO { id: string; learnerId: string; learner: UserDTO; sourceText: string; extractionStatus: string; filename: string | null; result: ResultDTO | null; issues: IssueDTO[] }
export interface TaskDTO { id: string; key: string; title: string; status: string; attempts: number; error: string | null }
export interface EventDTO { id: string; stage: string; level: string; message: string; detail: string; createdAt: string }
export interface PlanStep { key: string; title: string; dependencies: string[]; completionCriteria: string; tool: string }
export interface RunDTO { id: string; status: string; stage: string; plan: PlanStep[]; tasks: TaskDTO[]; events: EventDTO[]; toolCount: number; modelCalls: number; error: string | null; startedAt: string; finishedAt: string | null }
export interface ClassReport { assessed: number; approved: number; published: number; average: number; maxTotal: number; distribution: { label: string; count: number }[]; criteria: { name: string; average: number; maxScore: number }[]; strengths: string[]; difficulties: string[]; summary: string }
export interface AssessmentDTO { id: string; title: string; classId: string; class: { name: string; subject: string }; goal: string; instructions: string; rubricText: string; feedbackPreferences: string; mode: Mode; faultInjection: boolean; status: string; rubric: Criterion[]; report: ClassReport | null; createdAt: string; submissions: SubmissionDTO[]; runs: RunDTO[]; issues: IssueDTO[]; documents: {id: string; kind: string; filename: string; status: string}[] }
export interface DashboardDTO { user: UserDTO; classes: ClassDTO[]; assessments: AssessmentDTO[]; liveConfigured: boolean; demoAuth: boolean }
export interface SubmissionInput { learnerId: string; text: string; status?: 'received' | 'blank' | 'missing' | 'unreadable' | 'failed'; filename?: string }
export interface AssessmentInput { title: string; classId: string; goal: string; instructions: string; rubricText: string; feedbackPreferences?: string; mode: Mode; faultInjection?: boolean; submissions: SubmissionInput[] }
