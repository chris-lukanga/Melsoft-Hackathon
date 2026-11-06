import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import { db } from '@/lib/db';
import { authorizeAssessment, authorizeResult, checkOrigin, currentUser, hashToken, HttpError, newSession, requireTeacher, requireUser, userDTO, verifyPassword } from '@/lib/auth';
import { getAssessmentDTO, json, resultDTO, issueDTO } from '@/lib/dto';
import { assessmentInputSchema, validateInput } from '@/lib/validation';
import { createAssessment, createDemoAssessment } from '@/lib/assessment-service';
import { extractDocumentText, MAX_FILE_BYTES, parseRosterCsv, parseSubmissionCsv } from '@/lib/extraction';
import { calculateGradebook, criterionScoreSchema, reviewDeterministic } from '@/lib/tools';
import { cancelRun, executeRun, startRun } from '@/lib/workflow';
import { exportCsv, printableReport, refreshReport } from '@/lib/reports';
import type { Criterion, CriterionScore } from '@/lib/types';
import type { User } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const loginAttempts = new Map<string,{count:number;reset:number}>();
const ok = (data: unknown, status = 200) => NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(request:Request) {
  const text=await request.text();
  if(text.length>8_000_000) throw new HttpError(413,'The request is too large. Split the assessment into smaller batches.');
  try{return JSON.parse(text||'{}') as unknown;}catch{throw new HttpError(400,'Request must contain valid JSON.');}
}
async function audit(user:User,assessmentId:string,action:string,detail:unknown) {
  await db.auditLog.create({data:{userId:user.id,assessmentId,action,detailJson:JSON.stringify(detail)}});
}
async function noActiveRun(assessmentId:string) {
  const active=await db.run.findFirst({where:{assessmentId,status:{in:['running','queued']}}});
  if(active) throw new HttpError(409,'Wait for this run to finish, or cancel it before editing or approving results.');
}
async function validateForApproval(user:User,resultId:string) {
  const result=await authorizeResult(user,resultId);
  await noActiveRun(result.submission.assessmentId);
  const issues=await db.issue.findMany({where:{assessmentId:result.submission.assessmentId,resolved:false,blocking:true,OR:[{submissionId:null},{submissionId:result.submissionId}]}});
  if(issues.length) throw new HttpError(409,`Resolve blocking issues before approval: ${issues.map(i=>i.message).join(' ')}`);
  const check=reviewDeterministic({rubric:json<Criterion[]>(result.submission.assessment.rubricJson,[]),scores:json<CriterionScore[]>(result.scoresJson,[]),sourceText:result.submission.sourceText,extractionStatus:result.submission.extractionStatus,total:result.total,maxTotal:result.maxTotal,percentage:result.percentage});
  if(!check.valid) throw new HttpError(409,`This result failed validation: ${check.issues.map(i=>i.message).join(' ')}`);
  return result;
}
async function handle(request:Request,context:{params:Promise<{path:string[]}>}) {
  try {
    checkOrigin(request);
    const {path}=await context.params;
    const route=path.join('/');
    const method=request.method;
    if(route==='auth/login'&&method==='POST') {
      const input=z.object({email:z.string().email().max(200),password:z.string().min(1).max(200)}).parse(await body(request));
      const key=input.email.toLowerCase();
      const attempts=loginAttempts.get(key);
      if(attempts&&attempts.reset>Date.now()&&attempts.count>=10) throw new HttpError(429,'Too many sign-in attempts. Try again in a minute.');
      loginAttempts.set(key,{count:attempts&&attempts.reset>Date.now()?attempts.count+1:1,reset:Date.now()+60000});
      if(process.env.DEMO_AUTH!=='true'&&key.endsWith('@teachmate.local')) throw new HttpError(403,'Synthetic demo sign-in is disabled on this server.');
      const user=await db.user.findUnique({where:{email:key}});
      if(!user||!verifyPassword(input.password,user.passwordHash)) throw new HttpError(401,'Email or password is incorrect.');
      loginAttempts.delete(key);
      const token=await newSession(user.id);
      (await cookies()).set('teachmate_session',token,{httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol==='https:',path:'/',maxAge:43200});
      return ok({user:userDTO(user)});
    }
    if(route==='auth/logout'&&method==='POST') {
      const token=(await cookies()).get('teachmate_session')?.value;
      if(token) await db.session.deleteMany({where:{id:hashToken(token)}});
      (await cookies()).delete('teachmate_session');
      return ok({success:true});
    }
    if(route==='me'&&method==='GET') {
      const user=await currentUser();
      return ok({user:user?userDTO(user):null,liveConfigured:Boolean(process.env.LLM_API_KEY&&process.env.LLM_MODEL),demoAuth:process.env.DEMO_AUTH==='true'});
    }
    const user=await requireUser();
    if(route==='learner'&&method==='GET') {
      if(user.role!=='learner') throw new HttpError(403,'Open the learner view using a learner account.');
      const submissions=await db.submission.findMany({where:{learnerId:user.id,result:{status:'published'}},include:{learner:true,result:true,assessment:{include:{class:true}}},orderBy:{assessment:{createdAt:'desc'}}});
      return ok({user:userDTO(user),results:submissions.map(s=>({assessmentTitle:s.assessment.title,className:s.assessment.class.name,subject:s.assessment.class.subject,instructions:s.assessment.instructions,submission:{id:s.id,learnerId:s.learnerId,learner:userDTO(user),sourceText:s.sourceText,extractionStatus:s.extractionStatus,filename:s.filename,result:s.result?resultDTO(s.result):null,issues:[]}}))});
    }
    if(path[0]==='results'&&path.length===2&&method==='GET') return ok(resultDTO(await authorizeResult(user,path[1])));
    requireTeacher(user);
    if(route==='dashboard'&&method==='GET') {
      const classes=await db.classroom.findMany({where:{teacherId:user.id},include:{learners:{orderBy:{name:'asc'}}}});
      const assessments=await db.assessment.findMany({where:{class:{teacherId:user.id}},orderBy:{createdAt:'desc'},select:{id:true}});
      return ok({user:userDTO(user),classes:classes.map(c=>({id:c.id,name:c.name,subject:c.subject,learners:c.learners.map(userDTO)})),assessments:await Promise.all(assessments.map(a=>getAssessmentDTO(a.id))),liveConfigured:Boolean(process.env.LLM_API_KEY&&process.env.LLM_MODEL),demoAuth:process.env.DEMO_AUTH==='true'});
    }
    if(route==='assessments/preview'&&method==='POST') {
      const input=assessmentInputSchema.parse(await body(request));
      if(!await db.classroom.findFirst({where:{id:input.classId,teacherId:user.id}})) throw new HttpError(404,'Class not found.');
      return ok(validateInput(input));
    }
    if(route==='assessments/demo'&&method==='POST') return ok(await getAssessmentDTO((await createDemoAssessment(user)).id),201);
    if(route==='assessments'&&method==='POST') return ok(await getAssessmentDTO((await createAssessment(user,assessmentInputSchema.parse(await body(request)))).id),201);
    if(route==='uploads'&&method==='POST') {
      if(Number(request.headers.get('content-length')??0)>MAX_FILE_BYTES+100000) throw new HttpError(413,'Files must be 5 MB or smaller.');
      const form=await request.formData();const file=form.get('file');
      const kind=z.enum(['rubric','instructions','submission','submissions','roster']).parse(form.get('kind')??'submission');
      if(!(file instanceof File)) throw new HttpError(400,'Choose a file to upload.');
      if(file.size>MAX_FILE_BYTES) throw new HttpError(413,'Files must be 5 MB or smaller.');
      const filename=file.name.replace(/[^a-zA-Z0-9_. ()-]/g,'_').slice(0,180);
      if(!/\.(txt|csv|pdf)$/i.test(filename)) throw new HttpError(400,'Upload TXT, CSV or a text-based PDF.');
      if(['submissions','roster'].includes(kind)&&!filename.toLowerCase().endsWith('.csv')) throw new HttpError(400,'Structured submissions and rosters require CSV.');
      const bytes=Buffer.from(await file.arrayBuffer());const extracted=await extractDocumentText(bytes,filename);const token=randomBytes(32).toString('base64url');
      await db.pendingUpload.deleteMany({where:{createdAt:{lt:new Date(Date.now()-86400000)}}});
      await db.pendingUpload.create({data:{id:hashToken(token),userId:user.id,filename,kind,mimeType:file.type||'application/octet-stream',bytes,text:extracted.text,status:extracted.status}});
      return ok({filename,...extracted,uploadToken:token,...(kind==='submissions'?parseSubmissionCsv(extracted.text):{}),...(kind==='roster'?{roster:parseRosterCsv(extracted.text)}:{})});
    }
    if(path[0]==='documents'&&path.length===2&&method==='GET') {
      const doc=await db.document.findFirst({where:{id:path[1],assessment:{class:{teacherId:user.id}}}});
      if(!doc) throw new HttpError(404,'Document not found.');
      return new Response(new Uint8Array(doc.bytes),{headers:{'Content-Type':doc.mimeType,'Content-Disposition':`attachment; filename="${doc.filename.replaceAll('"','_')}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(path[0]==='assessments'&&path.length>=2) {
      const assessment=await authorizeAssessment(user,path[1]);const id=assessment.id;
      if(path.length===2&&method==='GET') return ok(await getAssessmentDTO(id));
      if(path.length===2&&method==='DELETE') {
        for(const run of await db.run.findMany({where:{assessmentId:id,status:{in:['queued','running']}}})) await cancelRun(run.id);
        await db.assessment.delete({where:{id}});return ok({deleted:true});
      }
      if(path[2]==='run'&&method==='POST') {
        const {retry}=z.object({retry:z.boolean().optional()}).parse(await body(request));const run=await startRun(id,retry??false);
        void executeRun(run.id).catch(()=>{});return ok({runId:run.id},202);
      }
      if(path[2]==='approve'&&method==='POST') {
        await noActiveRun(id);
        const results=await db.result.findMany({where:{submission:{assessmentId:id},status:{in:['draft','needs_review']}}});
        let approved=0;const skipped:{id:string;reason:string}[]=[];
        for(const r of results) {try {await validateForApproval(user,r.id);await db.result.update({where:{id:r.id},data:{status:'approved',approvedAt:new Date()}});approved++;}catch(error){if(error instanceof HttpError)skipped.push({id:r.id,reason:error.message});else throw error;}}
        await audit(user,id,'batch_approved',{approved,skipped});await refreshReport(id);return ok({approved,skipped});
      }
      if(path[2]==='publish'&&method==='POST') {
        await noActiveRun(id);const results=await db.result.findMany({where:{submission:{assessmentId:id},status:'approved'}});
        if(!results.length) throw new HttpError(409,'Approve at least one eligible result before publishing.');
        for(const r of results) await validateForApproval(user,r.id);
        const published=await db.result.updateMany({where:{id:{in:results.map(r=>r.id)},status:'approved'},data:{status:'published',publishedAt:new Date()}});
        await db.assessment.update({where:{id},data:{status:'published'}});await audit(user,id,'feedback_published',{count:published.count});await refreshReport(id);return ok({published:published.count});
      }
      if(path[2]==='export'&&method==='GET') {
        const format=new URL(request.url).searchParams.get('format')??'csv';if(!['csv','print'].includes(format)) throw new HttpError(400,'Choose csv or print format.');
        if(format==='print') return new Response(await printableReport(id),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'"}});
        return new Response(await exportCsv(id),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="teachmate-${id}.csv"`,'Cache-Control':'no-store'}});
      }
      if(path[2]==='audit'&&method==='GET') return ok(await db.auditLog.findMany({where:{assessmentId:id},orderBy:{createdAt:'desc'},select:{id:true,action:true,detailJson:true,createdAt:true,user:{select:{name:true}}}}));
    }
    if(path[0]==='runs'&&path[2]==='cancel'&&method==='POST') {
      const run=await db.run.findUnique({where:{id:path[1]}});if(!run) throw new HttpError(404,'Run not found.');await authorizeAssessment(user,run.assessmentId);await cancelRun(run.id);return ok({cancelled:true});
    }
    if(path[0]==='results'&&path.length>=2) {
      const result=await authorizeResult(user,path[1]);const assessmentId=result.submission.assessmentId;await noActiveRun(assessmentId);
      if(path.length===2&&method==='PATCH') {
        const input=z.object({scores:z.array(criterionScoreSchema).min(1).max(30).optional(),feedback:z.string().trim().min(1).max(6000).optional()}).parse(await body(request));
        if(!input.scores&&!input.feedback) throw new HttpError(400,'Provide scores or feedback to save.');
        const scores=input.scores??json<CriterionScore[]>(result.scoresJson,[]);const totals=calculateGradebook({scores});
        const check=reviewDeterministic({rubric:json<Criterion[]>(result.submission.assessment.rubricJson,[]),scores,sourceText:result.submission.sourceText,extractionStatus:result.submission.extractionStatus,...totals});
        if(!check.valid) throw new HttpError(400,check.issues.map(i=>i.message).join(' '));
        const updated=await db.$transaction(async tx=>{
          const r=await tx.result.update({where:{id:result.id},data:{scoresJson:JSON.stringify(scores),feedback:input.feedback??result.feedback,...totals,teacherEdited:true,status:'draft',approvedAt:null,publishedAt:null,version:{increment:1}}});
          await tx.outputVersion.create({data:{resultId:r.id,version:r.version,source:'teacher',payloadJson:JSON.stringify({scores,feedback:r.feedback,...totals})}});
          await tx.issue.updateMany({where:{submissionId:result.submissionId,resolved:false,code:{in:['score_out_of_bounds','criterion_coverage','criterion_mismatch','unsupported_evidence','missing_evidence','incorrect_total','blank_invented_evidence','unknown_criterion']}},data:{resolved:true,resolution:'Teacher supplied a replacement result that passed deterministic validation.'}});
          await tx.auditLog.create({data:{userId:user.id,assessmentId,action:'result_edited',detailJson:JSON.stringify({resultId:r.id,version:r.version,before:{scores:json(result.scoresJson,[]),feedback:result.feedback,total:result.total},after:{scores,feedback:r.feedback,total:r.total}})}});return r;
        });await refreshReport(assessmentId);return ok(resultDTO(updated));
      }
      if(path[2]==='approve'&&method==='POST') {
        await validateForApproval(user,result.id);const updated=await db.result.update({where:{id:result.id},data:{status:'approved',approvedAt:new Date()}});
        await audit(user,assessmentId,'result_approved',{resultId:result.id,version:result.version});await refreshReport(assessmentId);return ok(resultDTO(updated));
      }
      if(path[2]==='revise'&&method==='POST') {
        const {reason}=z.object({reason:z.string().trim().min(3).max(2000)}).parse(await body(request));
        if(result.teacherEdited) throw new HttpError(409,'This result contains a saved teacher decision. Edit it directly; regeneration preserves teacher decisions.');
        const run=await db.run.findFirst({where:{assessmentId},orderBy:{startedAt:'desc'}});if(!run) throw new HttpError(409,'Run the assessment first.');
        await db.result.update({where:{id:result.id},data:{status:'draft',approvedAt:null,publishedAt:null}});
        await db.runTask.updateMany({where:{runId:run.id,key:`assess:${result.submissionId}`},data:{status:'failed',error:`Teacher revision: ${reason}`,dataJson:JSON.stringify({revisionReason:reason})}});
        await db.run.update({where:{id:run.id},data:{status:'failed',finishedAt:null,error:`Teacher requested revision: ${reason}`}});await audit(user,assessmentId,'revision_requested',{resultId:result.id,reason});
        const restarted=await startRun(assessmentId,true);void executeRun(restarted.id).catch(()=>{});return ok({runId:restarted.id},202);
      }
    }
    if(path[0]==='issues'&&path[2]==='resolve'&&method==='POST') {
      const issue=await db.issue.findUnique({where:{id:path[1]}});if(!issue) throw new HttpError(404,'Issue not found.');await authorizeAssessment(user,issue.assessmentId);await noActiveRun(issue.assessmentId);
      const {resolution}=z.object({resolution:z.string().trim().min(5).max(2000)}).parse(await body(request));
      const protectedCodes=['missing','unreadable','extraction','rubric','maximum','unconfirmed_blank','conflicting_blank','unmarkable','failed','score_out_of_bounds','criterion_coverage','criterion_mismatch','unsupported_evidence','missing_evidence','incorrect_total','blank_invented_evidence','unknown_criterion'];
      if(issue.blocking&&protectedCodes.some(code=>issue.code.includes(code))) throw new HttpError(409,'This issue needs corrected source material or a valid edited result; an acknowledgement cannot override it.');
      const updated=await db.issue.update({where:{id:issue.id},data:{resolved:true,resolution}});await audit(user,issue.assessmentId,'issue_resolved',{issueId:issue.id,resolution});return ok(issueDTO(updated));
    }
    throw new HttpError(404,'Endpoint not found.');
  } catch(error) {
    if(error instanceof HttpError) return ok({error:error.message},error.status);
    if(error instanceof ZodError) return ok({error:error.issues.map(i=>`${i.path.join('.')||'Input'}: ${i.message}`).join('; ')},400);
    return ok({error:'The operation could not be completed. Your saved work is retained; check the inputs and try again.'},500);
  }
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
