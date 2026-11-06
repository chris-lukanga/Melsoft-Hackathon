import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { DEMO_CLASS, DEMO_LEARNERS } from '../lib/demo';
import { createDemoAssessment } from '../lib/assessment-service';

async function main() {
  const passwordHash=hashPassword('TeachMate-demo-2026');
  const teacher=await db.user.upsert({where:{email:'teacher@teachmate.local'},update:{},create:{id:'teacher-demo',name:'Alex Morgan',email:'teacher@teachmate.local',role:'teacher',passwordHash}});
  await db.classroom.upsert({where:{id:DEMO_CLASS.id},update:{},create:{id:DEMO_CLASS.id,name:DEMO_CLASS.name,subject:DEMO_CLASS.subject,teacherId:teacher.id}});
  for(const learner of DEMO_LEARNERS) await db.user.upsert({where:{id:learner.id},update:{},create:{...learner,role:'learner',classId:DEMO_CLASS.id,passwordHash}});
  if(!await db.assessment.count({where:{classId:DEMO_CLASS.id}})) await createDemoAssessment(teacher,DEMO_CLASS.id);
  console.log('TeachMate synthetic class ready: teacher@teachmate.local; learners learner01@teachmate.local through learner10@teachmate.local. Password: TeachMate-demo-2026.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Seed failed');process.exitCode=1;}).finally(()=>db.$disconnect());
