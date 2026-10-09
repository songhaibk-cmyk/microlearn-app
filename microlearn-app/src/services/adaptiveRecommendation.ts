export type AdaptiveTask = { id: string; title: string; skill_tag: string; difficulty: number };
export type AdaptiveAttempt = { task_id: string; student_id: string; score: number; created_at: string };

export function recommendNextTask<T extends AdaptiveTask>(tasks: T[], attempts: AdaptiveAttempt[], studentId: string) {
  if (!tasks.length) return null;
  const ownAttempts = attempts
    .filter((attempt) => attempt.student_id === studentId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latestByTask = new Map<string, AdaptiveAttempt>();
  for (const attempt of ownAttempts) if (!latestByTask.has(attempt.task_id)) latestByTask.set(attempt.task_id, attempt);
  const available = tasks.filter((task) => !latestByTask.has(task.id));
  const candidates = available.length ? available : tasks;
  const skillScores = new Map<string, number[]>();

  for (const attempt of ownAttempts) {
    const skill = tasks.find((task) => task.id === attempt.task_id)?.skill_tag || '';
    if (!skill) continue;
    const scores = skillScores.get(skill) || [];
    if (scores.length < 3) scores.push(attempt.score);
    skillScores.set(skill, scores);
  }

  const mastery = Object.fromEntries([...skillScores.entries()].map(([skill, scores]) => [
    skill,
    Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
  ]));
  const weakest = Object.entries(mastery).filter(([, score]) => score < 70).sort((a, b) => a[1] - b[1])[0];
  const latestTask = ownAttempts.length ? tasks.find((task) => task.id === ownAttempts[0].task_id) : undefined;
  const latestScore = ownAttempts[0]?.score;

  if (weakest) {
    const task = candidates.filter((item) => item.skill_tag === weakest[0]).sort((a, b) => a.difficulty - b.difficulty)[0];
    if (task) return { task, mastery, reason: `Kết quả gần đây ở kỹ năng “${weakest[0]}” đang ở mức ${weakest[1]}%. Hệ thống ưu tiên bài cùng kỹ năng để củng cố.` };
  }

  if (latestTask && latestScore >= 85) {
    const harder = candidates.filter((item) => item.skill_tag === latestTask.skill_tag && item.difficulty > latestTask.difficulty).sort((a, b) => a.difficulty - b.difficulty)[0];
    if (harder) return { task: harder, mastery, reason: `Bạn vừa đạt ${latestScore}% ở “${latestTask.skill_tag}”. Thử bước tiếp theo khó hơn trong cùng kỹ năng.` };
  }

  const task = [...candidates].sort((a, b) => a.difficulty - b.difficulty)[0];
  if (!task) return null;
  return {
    task,
    mastery,
    reason: ownAttempts.length ? 'Bài tiếp theo được chọn theo thứ tự độ khó hiện có và tiến độ của bạn.' : 'Bắt đầu từ nhiệm vụ có độ khó thấp để hệ thống ghi nhận năng lực ban đầu.',
  };
}
