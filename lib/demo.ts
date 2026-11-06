/** Entirely fictional people and source material for the visibly labelled demo. */
export const DEMO_CLASS = { id: "class-8a", name: "Grade 8A", subject: "English", grade: "8" };

export const DEMO_LEARNERS = [
  { id: "learner-01", name: "Amara Ndlovu", email: "learner01@teachmate.local" },
  { id: "learner-02", name: "Liam Jacobs", email: "learner02@teachmate.local" },
  { id: "learner-03", name: "Zoe Mokoena", email: "learner03@teachmate.local" },
  { id: "learner-04", name: "Ethan Naidoo", email: "learner04@teachmate.local" },
  { id: "learner-05", name: "Naledi Khumalo", email: "learner05@teachmate.local" },
  { id: "learner-06", name: "Oliver Petersen", email: "learner06@teachmate.local" },
  { id: "learner-07", name: "Mia Dlamini", email: "learner07@teachmate.local" },
  { id: "learner-08", name: "Noah Williams", email: "learner08@teachmate.local" },
  { id: "learner-09", name: "Ava Molefe", email: "learner09@teachmate.local" },
  { id: "learner-10", name: "Sipho Botha", email: "learner10@teachmate.local" },
];

export const DEMO_ASSESSMENT = {
  title: "The Bridge — reading response",
  goal: "Mark these Grade 8 English responses using the rubric. Write constructive individual feedback, compile the marks and prepare a class summary. Flag anything that needs my attention.",
  instructions: `Read this passage and answer the question in a short paragraph.\n\nAfter a storm washed away the footbridge, Lindiwe could no longer take the short path to school. She collected fallen branches, but the gap was too wide to cross alone. The next morning she asked her neighbours to help. Mr Dube brought strong planks and the other children carried ropes. By sunset, the community had built a safe bridge together. Lindiwe smiled: the bridge was stronger because everyone had contributed.\n\nQuestion: What does Lindiwe learn about cooperation? Support your interpretation with two relevant details from the passage. Write clearly in complete sentences. Total: 10 marks.`,
  rubricText: `Understanding | 4 | Explains that cooperation combines different contributions and achieves more than working alone. Full marks require a clear explanation of the lesson.\nEvidence | 4 | Uses two relevant details from the passage to support the interpretation, awarding up to 2 marks per detail. Accurate paraphrase is acceptable.\nExpression | 2 | Clear, connected complete sentences. Award 1 for meaning that is understandable but unclear or fragmented, and 2 for coherent expression.\nTotal: 10`,
  feedbackPreferences: "Use a supportive tone. Give one specific strength and one practical next step. Do not infer a diagnosis or the cause of a learner's difficulty.",
};

export const DEMO_SUBMISSIONS = [
  { learnerId: "learner-01", status: "received", response: "Lindiwe learns that cooperation lets people achieve something they cannot do alone. Her fallen branches were not enough to cross the wide gap, but Mr Dube brought strong planks while the children carried ropes. These different contributions made the bridge stronger and safe for everyone." },
  { learnerId: "learner-02", status: "received", response: "Lindiwe learns that working together can solve a problem. She could not cross the gap alone. When her neighbours helped, they built the bridge by sunset. Everyone had a part to play." },
  { learnerId: "learner-03", status: "received", response: "The lesson is that people can combine their skills and materials to do more together. Mr Dube brings planks and the children bring ropes. Lindiwe's branches alone could not make a safe crossing, so help from the community was essential." },
  { learnerId: "learner-04", status: "received", response: "She learns that cooperation is useful. The neighbours help build a bridge. It is stronger because everyone helped." },
  { learnerId: "learner-05", status: "received", response: "Lindiwe learns that asking for help is a strength because different people can contribute different things. Mr Dube supplies strong planks and the children carry ropes. Together they finish the bridge even though she could not cross the gap alone." },
  { learnerId: "learner-06", status: "received", response: "The bridge was broken. Lindiwe went to school. People had ropes. teamwork good." },
  { learnerId: "learner-07", status: "received", response: "Lindiwe discovers that teamwork makes a difficult job possible. At first, she has only fallen branches and the gap is too wide. After she asks her neighbours, they add planks and ropes and finish a safe bridge by sunset. Cooperation brings together what each person can offer." },
  { learnerId: "learner-08", status: "received", response: "She learned to build bridges because there was a storm. She collected branches. The bridge was strong." },
  { learnerId: "learner-09", status: "received", response: "The bridge is stronger because everyone contributed, but Lindiwe did the important part herself. Maybe the neighbours were just watching when it was finished. She learned to trust herself, or perhaps to ask for help." },
  { learnerId: "learner-10", status: "blank", response: "" },
] as const;

/** Fixtures are keyed by exact source text, never by learner name or position. */
export const DEMO_SCORE_FIXTURES = DEMO_SUBMISSIONS.map((submission, index) => ({
  response: submission.response,
  scores: [[4, 4, 2], [4, 3, 2], [4, 4, 2], [3, 2, 2], [4, 4, 2], [1, 1, 1], [4, 4, 2], [1, 1, 2], [2, 1, 2], [0, 0, 0]][index],
  ambiguous: index === 8,
}));
