import { db } from './db';
import { hashToken, HttpError } from './auth';
import { assessmentInputSchema, validateInput } from './validation';
import { parseSubmissionCsv, parseRosterCsv } from './extraction';
import { createHash } from 'node:crypto';
import { DEMO_ASSESSMENT, DEMO_SUBMISSIONS } from './demo';
import type { User } from '@prisma/client';
import type { z } from 'zod';

export async function createAssessment(user: User, input: z.infer<typeof assessmentInputSchema>) {
  const classroom = await db.classroom.findFirst({where:{id:input.classId,teacherId:user.id},include:{learners:true}});
  if (!classroom) throw new HttpError(404,'Class not found.');
  const learnerIds = new Set(classroom.learners.map(l=>l.id));
  const uploads = input.uploads?.length ? await db.pendingUpload.findMany({where:{id:{in:input.uploads.map(u=>hashToken(u.token))},userId:user.id,createdAt:{gt:new Date(Date.now()-86400000)}}}) : [];
  if (uploads.length !== new Set(input.uploads?.map(u=>u.token)??[]).size) throw new HttpError(400,'An upload has expired or is unavailable. Upload it again.');
  const submissions = [...input.submissions];
  for (const spec of input.uploads??[]) {
    const upload = uploads.find(u=>u.id===hashToken(spec.token))!;
    if (upload.kind !== spec.kind) throw new HttpError(400,'Upload type does not match.');
    if (spec.kind==='rubric') { if (upload.status!=='readable') throw new HttpError(400,'Rubric extraction is incomplete. Provide text or an OCR-processed PDF.'); input.rubricText=upload.text; }
    if (spec.kind==='instructions') { if (upload.status!=='readable') throw new HttpError(400,'Instructions extraction is incomplete. Provide readable text.'); input.instructions=upload.text; }
    if (spec.kind==='submissions') {
      const parsed = parseSubmissionCsv(upload.text);
      if(parsed.errors.length) throw new HttpError(400,parsed.errors.join(' '));
      submissions.push(...parsed.rows.map(r=>({learnerId:r.learnerId,text:r.response,status:r.status,filename:upload.filename})));
    }
    if (spec.kind==='submission') {
      if (!spec.learnerId) throw new HttpError(400,'Select the learner for each uploaded submission.');
      const existing = submissions.find(s=>s.learnerId===spec.learnerId && s.filename===upload.filename);
      if (!existing) submissions.push({learnerId:spec.learnerId,text:upload.text,status:upload.status==='readable'?'received':upload.status==='blank'?'blank':upload.status==='unreadable'?'unreadable':'failed',filename:upload.filename});
    }
    if(spec.kind==='roster') {
      const roster=parseRosterCsv(upload.text);
      if(roster.errors.length) throw new HttpError(400,roster.errors.join(' '));
      if(roster.rows.some(r=>!learnerIds.has(r.learnerId))) throw new HttpError(400,'Roster contains a learner outside this class. Use the IDs shown in your class roster.');
    }
  }
  if(submissions.some(s=>!learnerIds.has(s.learnerId))) throw new HttpError(400,'Every submission must belong to a learner in this class.');
  const validation = validateInput({...input,submissions});
  const first = new Map<string,typeof submissions[number]>();
  const duplicates: string[] = [];
  for(const s of submissions) { if(first.has(s.learnerId)) duplicates.push(s.learnerId); else first.set(s.learnerId,s); }
  const assessment = await db.$transaction(async tx=>{
    const a=await tx.assessment.create({data:{title:input.title,classId:input.classId,goal:input.goal,instructions:input.instructions,rubricText:input.rubricText,feedbackPreferences:input.feedbackPreferences??'',mode:input.mode,faultInjection:input.faultInjection??false,rubricJson:JSON.stringify(validation.rubric)}});
    for(const learner of classroom.learners) {
      const s=first.get(learner.id);
      const status=s?.status ?? (s?.text.trim() ? 'received' : 'missing');
      const stored=await tx.submission.create({data:{assessmentId:a.id,learnerId:learner.id,sourceText:s?.text??'',extractionStatus:status,filename:s?.filename}});
      if(duplicates.includes(learner.id)) await tx.issue.create({data:{assessmentId:a.id,submissionId:stored.id,code:'duplicate_upload',message:`Duplicate upload for ${learner.name} was excluded. The first submitted answer is retained; no duplicate gradebook row was created.`,blocking:false}});
      if(s && !s.text.trim() && (!s.status||s.status==='received')) await tx.issue.create({data:{assessmentId:a.id,submissionId:stored.id,code:'unconfirmed_blank',message:'Confirm whether this empty answer is blank or missing before marking.',blocking:true}});
    }
    for(const spec of input.uploads??[]) {
      const upload=uploads.find(u=>u.id===hashToken(spec.token))!;
      await tx.document.create({data:{assessmentId:a.id,kind:spec.kind,learnerId:spec.learnerId,filename:upload.filename,mimeType:upload.mimeType,bytes:upload.bytes,text:upload.text,status:upload.status,hash:createHash('sha256').update(upload.bytes).digest('hex')}});
    }
    if(uploads.length) await tx.pendingUpload.deleteMany({where:{id:{in:uploads.map(u=>u.id)}}});
    await tx.auditLog.create({data:{assessmentId:a.id,userId:user.id,action:'assessment_created',detailJson:JSON.stringify({mode:input.mode,submissionCount:first.size,uploadCount:uploads.length})}});
    return a;
  });
  return assessment;
}
export async function createDemoAssessment(user:User,classId?:string) {
  const classroom=await db.classroom.findFirst({where:{teacherId:user.id,...(classId?{id:classId}:{})},include:{learners:true}});
  if(!classroom) throw new HttpError(404,'No assigned class found.');
  const submissions=DEMO_SUBMISSIONS.filter(s=>classroom.learners.some(l=>l.id===s.learnerId)).map(s=>({learnerId:s.learnerId,text:s.response,status:s.status}));
  if(submissions[0]) submissions.push({...submissions[0]});
  return createAssessment(user,{...DEMO_ASSESSMENT,classId:classroom.id,mode:'demo',faultInjection:true,submissions});
}
