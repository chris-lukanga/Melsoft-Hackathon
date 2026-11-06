import { db } from './db';
import { json } from './dto';
import type { ClassReport, Criterion, CriterionScore } from './types';
import { generateClassReport } from './tools';

export async function refreshReport(assessmentId: string): Promise<ClassReport> {
  const assessment = await db.assessment.findUniqueOrThrow({ where: { id: assessmentId }, include: { submissions: { include: { result: true } } } });
  const results = assessment.submissions.flatMap(s => s.result ? [s.result] : []);
  const report = generateClassReport({ results: results.map(r=>({scores:json<CriterionScore[]>(r.scoresJson,[]),total:r.total,maxTotal:r.maxTotal,percentage:r.percentage,status:r.status})),submissionCount:assessment.submissions.length });
  await db.assessment.update({where:{id:assessmentId},data:{reportJson:JSON.stringify(report)}});
  return report;
}
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"','""')}"`;
}
export async function exportCsv(assessmentId: string) {
  const assessment = await db.assessment.findUniqueOrThrow({where:{id:assessmentId},include:{submissions:{include:{learner:true,result:true},orderBy:{learnerId:'asc'}}}});
  const criteria = json<Criterion[]>(assessment.rubricJson,[]);
  const rows: (string|number)[][] = [['Learner ID','Learner','Status',...criteria.map(c=>`${c.name} / ${c.maxScore}`),'Total','Maximum','Percentage','Feedback']];
  for (const s of assessment.submissions) {
    const r = s.result;
    if (!r || !['approved','published'].includes(r.status)) continue;
    const scores = json<CriterionScore[]>(r.scoresJson,[]);
    rows.push([s.learnerId,s.learner.name,r.status,...criteria.map(c=>scores.find(x=>x.criterionId===c.id)?.score??''),r.total,r.maxTotal,r.percentage,r.feedback]);
  }
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function printableReport(assessmentId: string) {
  const a = await db.assessment.findUniqueOrThrow({where:{id:assessmentId},include:{class:true,submissions:{include:{learner:true,result:true}}}});
  const approved = a.submissions.filter(s=>s.result&&['approved','published'].includes(s.result.status));
  const average = approved.length ? Math.round(approved.reduce((sum,s)=>sum+s.result!.percentage,0)/approved.length*10)/10:0;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(a.title)} · TeachMate</title><style>body{font:15px/1.6 system-ui;max-width:850px;margin:40px auto;color:#14233c}section{break-inside:avoid;border-top:1px solid #ddd;margin-top:30px}small{color:#526175}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}.feedback{white-space:pre-wrap}@media print{button{display:none}body{margin:12mm}}</style><body><button onclick="window.print()">Print report</button><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(a.class.name)} · ${escapeHtml(a.class.subject)} · ${escapeHtml(a.mode.toUpperCase())} mode</p><p>${approved.length} approved results · Average ${average}%</p><small>Teacher-approved results only. Observations describe this assessment; they do not establish causes of learning difficulties.</small>${approved.map(s=>`<section><h2>${escapeHtml(s.learner.name)}</h2><p>${s.result!.total}/${s.result!.maxTotal} · ${s.result!.percentage}% · ${escapeHtml(s.result!.status)}</p><table><thead><tr><th>Criterion</th><th>Score</th><th>Evidence</th></tr></thead><tbody>${json<CriterionScore[]>(s.result!.scoresJson,[]).map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${c.score}/${c.maxScore}</td><td>${escapeHtml(c.evidence)}</td></tr>`).join('')}</tbody></table><p class="feedback">${escapeHtml(s.result!.feedback)}</p></section>`).join('')}</body></html>`;
}
