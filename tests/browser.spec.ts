import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO_ASSESSMENT, DEMO_SUBMISSIONS, DEMO_CLASS } from '../lib/demo';
import type { AssessmentDTO, ResultDTO } from '../lib/types';
import Papa from 'papaparse';

const password = 'TeachMate-demo-2026';

async function signIn(request: APIRequestContext, email = 'teacher@teachmate.local') {
  const response = await request.post('/api/auth/login', { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function completed(request: APIRequestContext, id: string) {
  let current: AssessmentDTO | undefined;
  await expect.poll(async () => {
    const response = await request.get(`/api/assessments/${id}`);
    expect(response.ok()).toBeTruthy();
    current = await response.json() as AssessmentDTO;
    return current.runs[0]?.status;
  }, { timeout: 60_000 }).toMatch(/^(completed|needs_review|failed|needs_input)$/);
  expect(current!.runs[0].error ?? current!.runs[0].status).not.toMatch(/failed|needs_input/);
  return current!;
}

test('upload → persisted run → checked correction → teacher edit → approval → publish → private learner result → export', async ({ request, playwright }) => {
  await signIn(request);
  const uploaded = await request.post('/api/uploads', { multipart: {
    kind: 'rubric', file: { name: 'rubric.txt', mimeType: 'text/plain', buffer: Buffer.from(DEMO_ASSESSMENT.rubricText) },
  } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const upload = await uploaded.json() as { uploadToken: string; status: string };
  expect(upload.status).toBe('readable');
  const input = { ...DEMO_ASSESSMENT, title: `Browser workflow ${Date.now()}`, classId: DEMO_CLASS.id,
    mode: 'demo', faultInjection: true,
    submissions: [...DEMO_SUBMISSIONS.map(s => ({ learnerId: s.learnerId, text: s.response, status: s.status })),
      { learnerId: DEMO_SUBMISSIONS[0].learnerId, text: DEMO_SUBMISSIONS[0].response, status: 'received' }],
    uploads: [{ token: upload.uploadToken, kind: 'rubric' }],
  };
  const preview = await request.post('/api/assessments/preview', { data: input });
  expect(preview.ok(), await preview.text()).toBeTruthy();
  const validation = await preview.json();
  expect(validation.valid).toBe(true);
  expect(validation.issues.some((issue: { code: string }) => issue.code === 'duplicate_upload')).toBe(true);
  const created = await request.post('/api/assessments', { data: input });
  expect(created.ok(), await created.text()).toBeTruthy();
  let assessment = await created.json() as AssessmentDTO;
  const id = assessment.id;
  const learner = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const otherLearner = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    expect(assessment.submissions).toHaveLength(10);
    expect(assessment.documents).toHaveLength(1);
    expect(assessment.issues.some(issue => issue.code === 'duplicate_upload')).toBe(true);
    expect((await request.get(`/api/documents/${assessment.documents[0].id}`)).ok()).toBeTruthy();
    expect((await request.post(`/api/assessments/${id}/run`, { data: {} })).ok()).toBeTruthy();
    assessment = await completed(request, id);
    expect(assessment.submissions.filter(s => s.result)).toHaveLength(10);
    expect(assessment.runs[0].events.some(event => /inject/i.test(event.message + event.detail))).toBe(true);
    expect(assessment.runs[0].events.some(event => event.stage === 'Correct')).toBe(true);
    const first = assessment.submissions.find(s => s.learnerId === 'learner-01')!;
    const ambiguous = assessment.submissions.find(s => s.learnerId === 'learner-09')!;
    const blank = assessment.submissions.find(s => s.learnerId === 'learner-10')!;
    expect(blank.result!.total).toBe(0);
    await signIn(learner, 'learner01@teachmate.local');
    await signIn(otherLearner, 'learner02@teachmate.local');
    const privateBefore = await learner.get('/api/learner');
    expect(privateBefore.ok()).toBeTruthy();
    expect((await privateBefore.json()).results.some((r: { assessmentTitle: string }) => r.assessmentTitle === input.title)).toBe(false);
    expect((await learner.get(`/api/results/${first.result!.id}`)).status()).toBe(404);
    expect((await learner.get(`/api/documents/${assessment.documents[0].id}`)).status()).toBeGreaterThanOrEqual(400);
    expect((await learner.get(`/api/assessments/${id}`)).status()).toBeGreaterThanOrEqual(400);
    const blankExport = await request.get(`/api/assessments/${id}/export?format=csv`);
    expect((await blankExport.text()).trim().split(/\r?\n/)).toHaveLength(1);

    const scores = first.result!.scores.map((score, i) => i === 0 ? { ...score, score: score.score - 1, justification: 'Teacher reviewed the criterion and adjusted the suggested mark.' } : score);
    const editedResponse = await request.patch(`/api/results/${first.result!.id}`, { data: { scores, feedback: 'Teacher-reviewed feedback: a clear response; add detail to your explanation.' } });
    expect(editedResponse.ok(), await editedResponse.text()).toBeTruthy();
    const edit = await editedResponse.json() as ResultDTO;
    expect(edit.teacherEdited).toBe(true);
    expect(edit.version).toBeGreaterThan(first.result!.version);
    expect(edit.total).toBe(scores.reduce((sum, score) => sum + score.score, 0));
    const audit = await request.get(`/api/assessments/${id}/audit`);
    expect(audit.ok()).toBeTruthy();
    expect((await audit.json()).some((entry: { action: string; detailJson: string }) => entry.action === 'result_edited' && entry.detailJson.includes(first.result!.id))).toBe(true);
    const blockedApproval = await request.post(`/api/results/${ambiguous.result!.id}/approve`, { data: {} });
    expect(blockedApproval.status()).toBeGreaterThanOrEqual(400);
    expect((await request.post(`/api/results/${first.result!.id}/approve`, { data: {} })).ok()).toBeTruthy();
    const batch = await request.post(`/api/assessments/${id}/approve`, { data: {} });
    expect(batch.ok(), await batch.text()).toBeTruthy();
    const batchResult = await batch.json();
    expect(batchResult.skipped.length).toBeGreaterThanOrEqual(1);
    const published = await request.post(`/api/assessments/${id}/publish`, { data: {} });
    expect(published.ok(), await published.text()).toBeTruthy();
    expect((await published.json()).published).toBeGreaterThan(0);
    const own = await (await learner.get('/api/learner')).json();
    const visible = own.results.find((r: { assessmentTitle: string }) => r.assessmentTitle === input.title);
    expect(visible).toBeTruthy();
    expect(visible.submission.learnerId).toBe('learner-01');
    expect(visible.submission.result.total).toBe(edit.total);
    expect(visible.submission.result.status).toBe('published');
    const other = await (await otherLearner.get('/api/learner')).json();
    expect(other.results.every((r: { submission: { learnerId: string } }) => r.submission.learnerId === 'learner-02')).toBe(true);
    expect((await otherLearner.get(`/api/results/${first.result!.id}`)).status()).toBeGreaterThanOrEqual(400);
    const csv = await (await request.get(`/api/assessments/${id}/export?format=csv`)).text();
    expect(csv).toContain('Teacher-reviewed feedback');
    expect(csv).not.toContain(ambiguous.learner.name);
    const exportedRows = Papa.parse<string[]>(csv.replace(/^\uFEFF/, '')).data;
    const exportedFirst = exportedRows.find(row => row[0] === 'learner-01')!;
    expect(Number(exportedFirst[exportedRows[0].indexOf('Total')])).toBe(edit.total);
    const print = await request.get(`/api/assessments/${id}/export?format=print`);
    expect(print.ok()).toBeTruthy();
    expect(await print.text()).toContain('Teacher-reviewed feedback');

    expect((await request.post(`/api/assessments/${id}/run`, { data: { retry: true } })).ok()).toBeTruthy();
    const retried = await completed(request, id);
    expect(retried.submissions.filter(s => s.result)).toHaveLength(10);
    const retained = retried.submissions.find(s => s.learnerId === first.learnerId)!.result!;
    expect(retained.feedback).toBe('Teacher-reviewed feedback: a clear response; add detail to your explanation.');
    expect(retained.total).toBe(edit.total);
    expect(retained.status).toBe('published');
  } finally {
    await learner.dispose();
    await otherLearner.dispose();
    const deletion = await request.delete(`/api/assessments/${id}`);
    expect(deletion.ok(), await deletion.text()).toBeTruthy();
    expect((await request.get(`/api/assessments/${id}`)).status()).toBe(404);
  }
});

test('main teacher screens render, remain usable on mobile, and show actual saved work', async ({ request, page }, testInfo) => {
  await signIn(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /dashboard|teaching|welcome|good/i }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  const created = await request.post('/api/assessments/demo', { data: {} });
  expect(created.ok()).toBeTruthy();
  const a = await created.json() as AssessmentDTO;
  try {
    expect((await request.post(`/api/assessments/${a.id}/run`, { data: {} })).ok()).toBeTruthy();
    await completed(request, a.id);
    for (const view of ['workspace', 'review', 'reports']) {
      await page.goto(`/?assessment=${a.id}&view=${view}`);
      await expect(page.getByText(a.title).first()).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${view}.png`), fullPage: true });
    }
    await page.goto('/?view=new');
    await expect(page.getByRole('heading', { name: /new assignment|new assessment/i }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('new-assignment.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('mobile-dashboard.png'), fullPage: true });
  } finally {
    await request.delete(`/api/assessments/${a.id}`);
  }
});
