import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import type { User } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function userDTO(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, classId: user.classId };
}
export async function currentUser() {
  const token = (await cookies()).get('teachmate_session')?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  return user;
}
export function requireTeacher(user: User) {
  if (user.role !== 'teacher') throw new HttpError(403, 'This action requires a teacher account.');
}
export async function authorizeAssessment(user: User, assessmentId: string) {
  requireTeacher(user);
  const assessment = await db.assessment.findFirst({ where: { id: assessmentId, class: { teacherId: user.id } } });
  if (!assessment) throw new HttpError(404, 'Assessment not found.');
  return assessment;
}
export async function authorizeResult(user: User, resultId: string, publishedOnly = false) {
  const result = await db.result.findFirst({
    where: { id: resultId, ...(user.role === 'teacher'
      ? { submission: { assessment: { class: { teacherId: user.id } } } }
      : { submission: { learnerId: user.id }, status: 'published' }) },
    include: { submission: { include: { assessment: true } } },
  });
  if (!result || (publishedOnly && result.status !== 'published')) throw new HttpError(404, 'Result not found.');
  return result;
}
export async function newSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12) } });
  return token;
}
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, 'Cross-origin requests are not permitted.');
}
