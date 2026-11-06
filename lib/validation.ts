import { z } from 'zod';
import { parseRubricText } from './tools';
import type { Criterion } from './types';
export const submissionInputSchema = z.object({ learnerId: z.string().min(1), text: z.string().max(100000), status: z.enum(['received','blank','missing','unreadable','failed']).optional(), filename: z.string().max(255).optional() });
export const assessmentInputSchema = z.object({
  title: z.string().trim().min(1).max(180), classId: z.string().min(1), goal: z.string().trim().min(5).max(12000),
  instructions: z.string().max(40000), rubricText: z.string().max(40000), feedbackPreferences: z.string().max(4000).optional(),
  mode: z.enum(['demo','live']), faultInjection: z.boolean().optional(), submissions: z.array(submissionInputSchema).max(100),
  uploads: z.array(z.object({token:z.string().min(20),kind:z.enum(['rubric','instructions','submission','submissions','roster']),learnerId:z.string().optional()})).max(100).optional(),
});
export function validateInput(input: z.infer<typeof assessmentInputSchema>) {
  const issues: {code:string;message:string;blocking:boolean}[] = [];
  let rubric: Criterion[] = [];
  if (!input.instructions.trim()) issues.push({code:'missing_instructions',message:'Add the assessment questions and instructions before marking.',blocking:true});
  if (!input.rubricText.trim()) issues.push({code:'missing_rubric',message:'Add the rubric with a maximum mark for every criterion.',blocking:true});
  else {
    try { rubric = parseRubricText(input.rubricText); }
    catch { issues.push({code:'rubric_format',message: input.mode === 'live' ? 'The live planner will parse this rubric and check its maximum marks before marking.' : 'Use one rubric criterion per line: Criterion | maximum marks | description.',blocking:input.mode !== 'live'}); }
  }
  if (input.mode === 'live' && !process.env.LLM_API_KEY) issues.push({code:'provider_missing',message:'Live mode requires LLM_API_KEY and LLM_MODEL on the server. Demo results will never be substituted.',blocking:true});
  if (input.mode === 'live' && input.faultInjection) issues.push({code:'fault_mode',message:'Fault injection is available only in the labelled demo mode.',blocking:true});
  if (!input.submissions.length && !input.uploads?.length) issues.push({code:'missing_submissions',message:'Add at least one submission. Unprovided learners will be marked missing, without a zero.',blocking:true});
  const seen = new Set<string>();
  for (const s of input.submissions) {
    if (seen.has(s.learnerId)) issues.push({code:'duplicate_upload',message:`Duplicate upload for ${s.learnerId}; the first submission is retained.`,blocking:false});
    seen.add(s.learnerId);
    if (['unreadable','failed'].includes(s.status??'')) issues.push({code:'unreadable_submission',message:`${s.learnerId}: provide readable text or OCR before this submission can be marked.`,blocking:false});
    if (!s.text.trim() && (!s.status || s.status==='received')) issues.push({code:'unconfirmed_blank',message:`${s.learnerId}: confirm whether this is a blank answer or a missing submission.`,blocking:true});
  }
  if (rubric.length) {
    const total = rubric.reduce((sum,c)=>sum+c.maxScore,0);
    const expected = input.instructions.match(/(?:out of|maximum(?:\s+of)?|total(?:\s+marks)?\s*[:=])\s*(\d+(?:\.\d+)?)/i);
    if (expected && Number(expected[1])!==total) issues.push({code:'conflicting_maximum',message:`Instructions specify ${expected[1]} marks, but rubric criteria total ${total}. Correct the maximum before marking.`,blocking:true});
  }
  return {valid:!issues.some(i=>i.blocking),issues,rubric,submissionCount:seen.size};
}
