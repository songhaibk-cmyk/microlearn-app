import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BookOpen, Check, ChevronRight, CircleAlert, ClipboardList, GraduationCap, KeyRound, LoaderCircle, LogOut, Plus, School, ShieldCheck, Users } from 'lucide-react';
import { browserAuth, isSupabaseConfigured, requireSupabase, supabase } from './services/supabase';
import { recommendNextTask } from './services/adaptiveRecommendation';

type Role = 'student' | 'teacher' | 'school_admin';
type Profile = { id: string; full_name: string; email: string; role: Role; school_id: string | null };
type SchoolRow = { id: string; name: string; teacher_join_code: string };
type ClassRow = { id: string; name: string; grade: number; academic_year: string; join_code: string; school_id: string };
type TaskRow = { id: string; class_id: string; title: string; objective: string; skill_tag: string; difficulty: number; estimated_minutes: number; content: { prompt: string; options: string[]; explanation: string }; created_at: string };
type AttemptRow = { id: string; task_id: string; student_id: string; score: number; answer: string; hints_used: number; active_seconds: number; created_at: string };
type TeacherLink = { class_id: string; teacher_id: string };
type TeacherRow = { id: string; full_name: string; email: string };

const gradeOptions = [10, 11, 12];
const year = new Date().getFullYear();
const schoolYear = `${year}–${year + 1}`;

function makeCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [school, setSchool] = useState<SchoolRow | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [teacherLinks, setTeacherLinks] = useState<TeacherLink[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [activeClassId, setActiveClassId] = useState('');
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState(10);
  const [joinCode, setJoinCode] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [teacherCode, setTeacherCode] = useState('');
  const [assignTeacherId, setAssignTeacherId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskObjective, setTaskObjective] = useState('');
  const [skillTag, setSkillTag] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskOptions, setTaskOptions] = useState('');
  const [taskAnswer, setTaskAnswer] = useState('');
  const [taskDifficulty, setTaskDifficulty] = useState(1);
  const [taskExplanation, setTaskExplanation] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [studentAnswer, setStudentAnswer] = useState('');
  const [result, setResult] = useState<{ score: number; explanation: string } | null>(null);

  const loadWorkspace = useCallback(async (userId: string) => {
    const client = requireSupabase();
    const { data: userProfile, error: profileError } = await client.from('profiles').select('id,full_name,role,school_id').eq('id', userId).maybeSingle();
    if (profileError) throw profileError;
    setProfile(userProfile as Profile | null);
    if (!userProfile?.school_id) {
      setSchool(null); setClasses([]); setTasks([]); setAttempts([]); setTeachers([]); setTeacherLinks([]); setStudentNames({});
      return;
    }

    const [schoolResult, classResult, taskResult, attemptResult] = await Promise.all([
      client.from('schools').select('id,name,teacher_join_code').eq('id', userProfile.school_id).maybeSingle(),
      client.from('classes').select('*').order('created_at', { ascending: false }),
      userProfile.role === 'student'
        ? client.from('student_tasks').select('*').order('created_at', { ascending: false })
        : client.from('tasks').select('*').order('created_at', { ascending: false }),
      client.from('task_attempts').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    for (const response of [schoolResult, classResult, taskResult, attemptResult]) if (response.error) throw response.error;
    const loadedClasses = (classResult.data || []) as ClassRow[];
    const loadedTasks = (taskResult.data || []) as TaskRow[];
    const loadedAttempts = (attemptResult.data || []) as AttemptRow[];
    setSchool(schoolResult.data as SchoolRow | null);
    setClasses(loadedClasses); setTasks(loadedTasks); setAttempts(loadedAttempts);
    setActiveClassId((current) => current && loadedClasses.some((row) => row.id === current) ? current : loadedClasses[0]?.id || '');

    const [teacherResult, linkResult, enrollmentResult] = await Promise.all([
      userProfile.role === 'school_admin'
        ? client.rpc('school_teacher_directory')
        : Promise.resolve({ data: [], error: null } as any),
      userProfile.role === 'school_admin' || userProfile.role === 'teacher'
        ? client.from('class_teachers').select('class_id,teacher_id')
        : Promise.resolve({ data: [], error: null } as any),
      userProfile.role === 'school_admin' || userProfile.role === 'teacher'
        ? client.from('enrollments').select('student_id')
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (teacherResult.error) throw teacherResult.error;
    if (linkResult.error) throw linkResult.error;
    if (enrollmentResult.error) throw enrollmentResult.error;
    setTeachers((teacherResult.data || []) as TeacherRow[]);
    setTeacherLinks((linkResult.data || []) as TeacherLink[]);

    if ((enrollmentResult.data || []).length) {
      const ids = [...new Set((enrollmentResult.data || []).map((row: any) => row.student_id))];
      const { data: students, error: studentsError } = await client.from('profiles').select('id,full_name').in('id', ids);
      if (studentsError) throw studentsError;
      setStudentNames(Object.fromEntries((students || []).map((row: any) => [row.id, row.full_name])));
    } else setStudentNames({});
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let mounted = true;
    const client = requireSupabase();
    const start = async () => {
      try {
        const { data } = await browserAuth().getSession();
        if (!mounted) return;
        setSession(data.session);
        if (data.session?.user) await loadWorkspace(data.session.user.id);
      } catch (cause) { if (mounted) setError(messageOf(cause)); }
      finally { if (mounted) setLoading(false); }
    };
    void start();
    const { data: listener } = browserAuth().onAuthStateChange((_event: string, nextSession: any) => {
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setSchool(null); setClasses([]); setTasks([]); setAttempts([]); setLoading(false); }
      else { window.setTimeout(() => void loadWorkspace(nextSession.user.id).catch((cause) => setError(messageOf(cause))), 0); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [loadWorkspace]);

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    if (session?.user) await loadWorkspace(session.user.id);
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const client = requireSupabase();
      if (authMode === 'register') {
        const { data, error: authError } = await browserAuth().signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() } } });
        if (authError) throw authError;
        if (!data.session) setNotice('Tài khoản đã tạo. Hãy mở email xác nhận, sau đó đăng nhập.');
        else setNotice('Đã tạo tài khoản. Hãy hoàn tất bước tham gia trường/lớp để bắt đầu.');
      } else {
        const { error: authError } = await browserAuth().signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    });
  };

  const createSchool = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const client = requireSupabase();
      const code = makeCode(10);
      const { error: rpcError } = await client.rpc('create_school', { p_name: schoolName.trim(), p_teacher_join_code: code });
      if (rpcError) throw rpcError;
      await refresh();
    }, 'Đã tạo trường. Bạn là quản trị viên đầu tiên; hãy lưu mã mời giáo viên trong phần quản lý trường.');
  };

  const joinSchool = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error: rpcError } = await requireSupabase().rpc('join_school_as_teacher', { p_teacher_join_code: teacherCode.trim().toUpperCase() });
      if (rpcError) throw rpcError;
      await refresh();
    }, 'Đã tham gia trường với vai trò giáo viên. Quản trị viên có thể phân công lớp cho bạn.');
  };

  const joinClass = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error: rpcError } = await requireSupabase().rpc('join_class_by_code', { p_join_code: joinCode.trim().toUpperCase() });
      if (rpcError) throw rpcError;
      setJoinCode(''); await refresh();
    }, 'Đã tham gia lớp học.');
  };

  const createClass = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!profile?.school_id) throw new Error('Tài khoản chưa thuộc trường nào.');
      const client = requireSupabase();
      const { data: newClassId, error: createError } = await client.rpc('create_class', {
        p_name: className.trim(), p_grade: grade, p_academic_year: schoolYear, p_join_code: makeCode(8),
      });
      if (createError) throw createError;
      if (newClassId) setActiveClassId(newClassId);
      setClassName(''); await refresh();
    }, 'Đã tạo lớp và cấp quyền quản lý cho bạn.');
  };

  const assignTeacher = (event: FormEvent) => {
    event.preventDefault();
    if (!activeClassId || !assignTeacherId) return;
    void run(async () => {
      const { error: rpcError } = await requireSupabase().rpc('assign_teacher_to_class', { p_class_id: activeClassId, p_teacher_id: assignTeacherId });
      if (rpcError) throw rpcError;
      await refresh();
    }, 'Đã phân công giáo viên vào lớp.');
  };

  const createTask = (event: FormEvent) => {
    event.preventDefault();
    if (!activeClassId) return;
    void run(async () => {
      const options = taskOptions.split('\n').map((item) => item.trim()).filter(Boolean);
      if (options.length < 2 || !options.includes(taskAnswer.trim())) throw new Error('Hãy nhập ít nhất hai lựa chọn và đáp án phải trùng chính xác một lựa chọn.');
      const { error: insertError } = await requireSupabase().rpc('create_class_task', {
        p_class_id: activeClassId, p_title: taskTitle.trim(), p_objective: taskObjective.trim(), p_skill_tag: skillTag.trim(), p_difficulty: taskDifficulty,
        p_content: { prompt: taskPrompt.trim(), options, explanation: taskExplanation.trim() }, p_answer: taskAnswer.trim(),
      });
      if (insertError) throw insertError;
      setTaskTitle(''); setTaskObjective(''); setSkillTag(''); setTaskPrompt(''); setTaskOptions(''); setTaskAnswer(''); setTaskExplanation('');
      await refresh();
    }, 'Đã giao nhiệm vụ cho lớp.');
  };

  const submitAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTask || !profile) return;
    void run(async () => {
      const { data, error: insertError } = await requireSupabase().rpc('submit_task_attempt', {
        p_task_id: selectedTask.id, p_answer: studentAnswer.trim(), p_hints_used: 0, p_active_seconds: 0,
      });
      if (insertError) throw insertError;
      const submission = Array.isArray(data) ? data[0] : data;
      setResult({ score: Number(submission.score), explanation: submission.explanation || selectedTask.content.explanation });
      await refresh();
    });
  };

  const signOut = () => { void run(async () => { const { error: signOutError } = await browserAuth().signOut(); if (signOutError) throw signOutError; }); };
  const activeClass = classes.find((item) => item.id === activeClassId);
  const classTasks = useMemo(() => tasks.filter((task) => task.class_id === activeClassId), [tasks, activeClassId]);
  const classAttempts = useMemo(() => attempts.filter((attempt) => classTasks.some((task) => task.id === attempt.task_id)), [attempts, classTasks]);
  const completedCount = attempts.filter((attempt) => attempt.student_id === profile?.id).length;

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (loading) return <div className="min-h-screen grid place-items-center bg-[#f4f7f5]"><LoaderCircle className="animate-spin text-emerald-700" /></div>;
  if (!session) return <AuthScreen {...{ authMode, setAuthMode, email, setEmail, password, setPassword, fullName, setFullName, submitAuth, busy, error, notice }} />;

  return (
    <div className="min-h-screen bg-[#f4f7f5] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <a href="#top" className="flex items-center gap-3 no-underline">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-white"><BookOpen size={22} /></span>
            <span><strong className="block text-lg tracking-tight text-slate-900">MicroLearn</strong><span className="text-xs text-slate-500">Vật lý 10 · Học theo năng lực</span></span>
          </a>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><strong className="block text-sm">{profile?.full_name || session.user.email}</strong><span className="text-xs text-slate-500">{roleLabel(profile?.role)}{school ? ` · ${school.name}` : ''}</span></div>
            <button onClick={signOut} title="Đăng xuất" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><LogOut size={18} /></button>
          </div>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        {(error || notice) && <div className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><CircleAlert size={18} className="mt-0.5 shrink-0" /><p>{error || notice}</p><button className="ml-auto" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
        {!profile ? <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950">Hồ sơ chưa được tạo. Hãy chạy migration Supabase trong thư mục <code>supabase/migrations</code>, sau đó đăng xuất và đăng nhập lại.</div>
          : !profile.school_id ? <SchoolOnboarding {...{ profile, schoolName, setSchoolName, createSchool, teacherCode, setTeacherCode, joinSchool, joinCode, setJoinCode, joinClass, busy }} />
          : profile.role === 'student' ? <StudentWorkspace {...{ classes, tasks, attempts, profile, joinCode, setJoinCode, joinClass, selectedTask, setSelectedTask, studentAnswer, setStudentAnswer, result, setResult, submitAnswer, busy, completedCount, refresh }} />
          : <TeacherWorkspace {...{ profile, school, classes, tasks, attempts, teachers, teacherLinks, studentNames, activeClassId, setActiveClassId, activeClass, classTasks, classAttempts, className, setClassName, grade, setGrade, createClass, taskTitle, setTaskTitle, taskObjective, setTaskObjective, skillTag, setSkillTag, taskPrompt, setTaskPrompt, taskOptions, setTaskOptions, taskAnswer, setTaskAnswer, taskExplanation, setTaskExplanation, taskDifficulty, setTaskDifficulty, createTask, assignTeacherId, setAssignTeacherId, assignTeacher, busy, run, refresh }} />}
      </main>
    </div>
  );
}

function roleLabel(role?: Role) { return role === 'school_admin' ? 'Quản trị trường' : role === 'teacher' ? 'Giáo viên' : 'Học sinh'; }

function SetupScreen() {
  return <div className="min-h-screen bg-[#f4f7f5] px-4 py-16"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm"><School className="mb-4 text-emerald-700" size={32} /><h1 className="text-2xl font-bold">Cấu hình MicroLearn</h1><p className="mt-2 text-slate-600">Thêm URL và khóa công khai Supabase vào tệp <code>.env.local</code> để bật đăng nhập và lưu dữ liệu.</p><pre className="mt-5 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-emerald-200">VITE_SUPABASE_URL=https://...supabase.co<br />VITE_SUPABASE_ANON_KEY=...</pre><p className="mt-4 text-sm text-slate-500">Chỉ dùng anon/publishable key ở trình duyệt. Không đưa service-role key vào frontend.</p></div></div>;
}

function AuthScreen(props: any) {
  const { authMode, setAuthMode, email, setEmail, password, setPassword, fullName, setFullName, submitAuth, busy, error, notice } = props;
  return <div className="min-h-screen bg-[#eaf2ee] px-4 py-12"><div className="mx-auto grid max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-xl md:grid-cols-[1.05fr_.95fr]">
    <section className="flex flex-col justify-between bg-emerald-900 p-8 text-white sm:p-12"><div><span className="inline-flex rounded-2xl bg-white/10 p-3"><GraduationCap size={26} /></span><h1 className="mt-10 max-w-md text-4xl font-bold leading-tight">Mỗi bước học nhỏ tạo nên tiến bộ lớn.</h1><p className="mt-4 max-w-md text-emerald-100">Không gian học Vật lý có nhiệm vụ ngắn, theo dõi tiến độ và lộ trình phù hợp cho từng học sinh.</p></div><div className="mt-12 flex items-center gap-2 text-sm text-emerald-100"><ShieldCheck size={18} /> Tài khoản và dữ liệu lớp được phân quyền</div></section>
    <section className="p-7 sm:p-10"><p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">MicroLearn · Vật lý 10</p><h2 className="mt-2 text-2xl font-bold">{authMode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h2><p className="mt-2 text-sm text-slate-500">{authMode === 'login' ? 'Tiếp tục lộ trình học của bạn.' : 'Tài khoản mới bắt đầu ở vai trò học sinh. Giáo viên tham gia trường bằng mã mời.'}</p>
      {(error || notice) && <p className={`mt-5 rounded-xl p-3 text-sm ${error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{error || notice}</p>}
      <form onSubmit={submitAuth} className="mt-6 space-y-4">{authMode === 'register' && <Field label="Họ và tên"><input required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={inputStyle} placeholder="Nguyễn An" /></Field>}
        <Field label="Email"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputStyle} placeholder="ban@example.com" /></Field>
        <Field label="Mật khẩu"><input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} className={inputStyle} placeholder="Tối thiểu 8 ký tự" /></Field>
        <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy && <LoaderCircle size={17} className="animate-spin" />}{authMode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}<ChevronRight size={17} /></button>
      </form><button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="mt-5 text-sm font-semibold text-emerald-800">{authMode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}</button>
    </section></div></div>;
}

function SchoolOnboarding(props: any) {
  const { profile, schoolName, setSchoolName, createSchool, teacherCode, setTeacherCode, joinSchool, joinCode, setJoinCode, joinClass, busy } = props;
  return <section className="mx-auto max-w-3xl"><Heading eyebrow="Thiết lập không gian lớp học" title={`Xin chào ${profile.full_name}`} description="Hãy kết nối tài khoản với một trường để tạo lớp, phân công giáo viên và giao nhiệm vụ." />
    <div className="mt-6 grid gap-5 md:grid-cols-3"><form onSubmit={createSchool} className="rounded-3xl border border-slate-200 bg-white p-6"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><School size={21} /></div><h3 className="text-lg font-bold">Tạo trường mới</h3><p className="mt-1 text-sm text-slate-500">Bạn sẽ trở thành quản trị viên đầu tiên của trường.</p><input required value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className={`${inputStyle} mt-5`} placeholder="Tên trường" /><button disabled={busy} className={`${primaryButton} mt-3`}>Tạo trường</button></form>
      <form onSubmit={joinSchool} className="rounded-3xl border border-slate-200 bg-white p-6"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-800"><KeyRound size={21} /></div><h3 className="text-lg font-bold">Tham gia trường</h3><p className="mt-1 text-sm text-slate-500">Dành cho giáo viên được trường mời.</p><input required value={teacherCode} onChange={(e) => setTeacherCode(e.target.value)} className={`${inputStyle} mt-5 uppercase`} placeholder="Mã mời giáo viên" /><button disabled={busy} className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800">Tham gia trường</button></form>
      <form onSubmit={joinClass} className="rounded-3xl border border-slate-200 bg-white p-6"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><GraduationCap size={21} /></div><h3 className="text-lg font-bold">Tham gia lớp</h3><p className="mt-1 text-sm text-slate-500">Dành cho học sinh có mã lớp từ giáo viên.</p><input required value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className={`${inputStyle} mt-5 uppercase`} placeholder="Mã tham gia lớp" /><button disabled={busy} className="mt-3 w-full rounded-xl bg-amber-600 px-4 py-3 font-semibold text-white hover:bg-amber-700">Vào lớp học</button></form></div>
  </section>;
}

function TeacherWorkspace(props: any) {
  const { profile, school, classes, tasks, attempts, teachers, teacherLinks, studentNames, activeClassId, setActiveClassId, activeClass, classTasks, classAttempts, className, setClassName, grade, setGrade, createClass, taskTitle, setTaskTitle, taskObjective, setTaskObjective, skillTag, setSkillTag, taskPrompt, setTaskPrompt, taskOptions, setTaskOptions, taskAnswer, setTaskAnswer, taskExplanation, setTaskExplanation, taskDifficulty, setTaskDifficulty, createTask, assignTeacherId, setAssignTeacherId, assignTeacher, busy, run, refresh } = props;
  const isAdmin = profile.role === 'school_admin';
  const totalStudents = new Set(attempts.map((attempt: AttemptRow) => attempt.student_id)).size;
  return <div><Heading eyebrow={school.name} title={isAdmin ? 'Quản lý trường học' : 'Lớp học của tôi'} description={isAdmin ? 'Tạo lớp, phân quyền giáo viên và theo dõi hoạt động học tập.' : 'Quản lý nhiệm vụ và theo dõi tiến độ trong các lớp được phân công.'} />
    <div className="mt-6 grid gap-3 sm:grid-cols-3"><Stat icon={<School />} label="Lớp bạn truy cập" value={classes.length} /><Stat icon={<ClipboardList />} label="Nhiệm vụ đã giao" value={tasks.length} /><Stat icon={<Users />} label="Học sinh có hoạt động" value={totalStudents} /></div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-5"><section className="rounded-3xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Danh sách lớp</h3><div className="mt-3 space-y-2">{classes.length ? classes.map((item: ClassRow) => <button key={item.id} onClick={() => setActiveClassId(item.id)} className={`w-full rounded-xl p-3 text-left ${activeClassId === item.id ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'hover:bg-slate-50'}`}><strong className="block text-sm">{item.name}</strong><span className="text-xs text-slate-500">Khối {item.grade} · {item.academic_year}</span></button>) : <p className="text-sm text-slate-500">Chưa có lớp được phân công.</p>}</div></section>
        {(profile.role === 'teacher' || isAdmin) && <form onSubmit={createClass} className="rounded-3xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Tạo lớp</h3><input required value={className} onChange={(e) => setClassName(e.target.value)} className={`${inputStyle} mt-3`} placeholder="Tên lớp, ví dụ 10A1" /><select value={grade} onChange={(e) => setGrade(Number(e.target.value))} className={`${inputStyle} mt-2`}>{gradeOptions.map((item) => <option key={item} value={item}>Khối {item}</option>)}</select><button disabled={busy} className={`${primaryButton} mt-2`}><Plus size={16} /> Tạo lớp</button></form>}
        {isAdmin && <section className="rounded-3xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Mã mời giáo viên</h3><p className="mt-2 text-sm text-slate-500">Chia sẻ mã này riêng với giáo viên trong trường.</p><code className="mt-3 block rounded-xl bg-slate-100 p-3 text-center text-lg font-bold tracking-[.2em]">{school.teacher_join_code}</code><button onClick={() => void run(async () => { const { error: rpcError } = await requireSupabase().rpc('rotate_teacher_join_code', { p_new_code: makeCode(10) }); if (rpcError) throw rpcError; await refresh(); }, 'Đã đổi mã mời. Mã cũ không còn hiệu lực.')} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold">Tạo mã mới</button></section>}
      </aside>
      <div className="space-y-6">{activeClass ? <>
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-emerald-900 p-6 text-white"><div><p className="text-sm text-emerald-200">Đang quản lý</p><h2 className="mt-1 text-2xl font-bold">{activeClass.name}</h2><p className="mt-1 text-sm text-emerald-100">Khối {activeClass.grade} · Năm học {activeClass.academic_year}</p></div><div className="rounded-2xl bg-white/10 px-4 py-3"><span className="block text-xs text-emerald-100">Mã tham gia của học sinh</span><strong className="font-mono text-xl tracking-[.18em]">{activeClass.join_code}</strong></div></section>
        {isAdmin && <section className="rounded-3xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Phân công giáo viên</h3><div className="mt-3 flex flex-wrap gap-2">{teacherLinks.filter((row: TeacherLink) => row.class_id === activeClassId).map((row: TeacherLink) => <span key={row.teacher_id} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm text-blue-900">{teachers.find((teacher: TeacherRow) => teacher.id === row.teacher_id)?.full_name || 'Giáo viên'}<button title="Gỡ phân công" onClick={() => void run(async () => { const { error: rpcError } = await requireSupabase().rpc('remove_teacher_from_class', { p_class_id: activeClassId, p_teacher_id: row.teacher_id }); if (rpcError) throw rpcError; await refresh(); }, 'Đã gỡ phân công giáo viên.')} className="font-bold text-blue-700">×</button></span>)}</div><form onSubmit={assignTeacher} className="mt-4 flex flex-col gap-2 sm:flex-row"><select required value={assignTeacherId} onChange={(e) => setAssignTeacherId(e.target.value)} className={inputStyle}><option value="">Chọn giáo viên trong trường</option>{teachers.map((teacher: TeacherRow) => <option key={teacher.id} value={teacher.id}>{teacher.full_name} · {teacher.email}</option>)}</select><button disabled={busy || !assignTeacherId} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Phân công lớp</button></form></section>}
        <div className="grid gap-6 xl:grid-cols-2"><form onSubmit={createTask} className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="text-lg font-bold">Tạo nhiệm vụ học tập</h3><p className="mt-1 text-sm text-slate-500">Nhiệm vụ sẽ hiển thị cho học sinh đã tham gia lớp.</p><div className="mt-4 space-y-3"><input required value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className={inputStyle} placeholder="Tên nhiệm vụ" /><input value={skillTag} onChange={(e) => setSkillTag(e.target.value)} className={inputStyle} placeholder="Kỹ năng, ví dụ: Đổi đơn vị" /><select value={taskDifficulty} onChange={(e) => setTaskDifficulty(Number(e.target.value))} className={inputStyle}><option value={1}>Mức 1 · Củng cố</option><option value={2}>Mức 2 · Cơ bản</option><option value={3}>Mức 3 · Nâng cao</option><option value={4}>Mức 4 · Vận dụng</option></select><textarea required value={taskObjective} onChange={(e) => setTaskObjective(e.target.value)} className={inputStyle} rows={2} placeholder="Mục tiêu học tập" /><textarea required value={taskPrompt} onChange={(e) => setTaskPrompt(e.target.value)} className={inputStyle} rows={3} placeholder="Câu hỏi trắc nghiệm" /><textarea required value={taskOptions} onChange={(e) => setTaskOptions(e.target.value)} className={inputStyle} rows={4} placeholder={'Các lựa chọn, mỗi lựa chọn một dòng\nVí dụ: 10 m/s'} /><input required value={taskAnswer} onChange={(e) => setTaskAnswer(e.target.value)} className={inputStyle} placeholder="Đáp án đúng (trùng chính xác một lựa chọn)" /><textarea value={taskExplanation} onChange={(e) => setTaskExplanation(e.target.value)} className={inputStyle} rows={2} placeholder="Giải thích sau khi trả lời" /><button disabled={busy} className={primaryButton}><Plus size={16} /> Giao nhiệm vụ</button></div></form>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">Bài tập của lớp</h3><p className="text-sm text-slate-500">{classTasks.length} nhiệm vụ</p></div><BookOpen className="text-emerald-700" /></div><div className="mt-4 space-y-3">{classTasks.map((task: TaskRow) => <article key={task.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{task.title}</h4><p className="mt-1 text-sm text-slate-500">{task.objective}</p></div><span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">{task.skill_tag || 'Vật lý'}</span></div></article>)}{classTasks.length === 0 && <Empty text="Chưa có nhiệm vụ. Tạo nhiệm vụ đầu tiên ở biểu mẫu bên cạnh." />}</div></section></div>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="text-lg font-bold">Kết quả học tập gần đây</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Học sinh</th><th className="pb-3">Nhiệm vụ</th><th className="pb-3">Điểm</th><th className="pb-3">Ngày nộp</th></tr></thead><tbody className="divide-y divide-slate-100">{classAttempts.slice(0, 20).map((attempt: AttemptRow) => <tr key={attempt.id}><td className="py-3">{studentNames[attempt.student_id] || 'Học sinh'}</td><td className="py-3">{classTasks.find((task: TaskRow) => task.id === attempt.task_id)?.title || 'Nhiệm vụ'}</td><td className="py-3 font-semibold">{attempt.score}%</td><td className="py-3 text-slate-500">{new Date(attempt.created_at).toLocaleDateString('vi-VN')}</td></tr>)}</tbody></table>{classAttempts.length === 0 && <Empty text="Chưa có học sinh nộp bài." />}</div></section>
      </> : <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center"><School className="mx-auto text-slate-400" /><h3 className="mt-3 text-lg font-bold">Chưa có lớp để hiển thị</h3><p className="mt-1 text-sm text-slate-500">Tạo lớp mới hoặc nhờ quản trị viên phân công lớp cho bạn.</p></div>}</div>
    </div>
  </div>;
}

function StudentWorkspace(props: any) {
  const { classes, tasks, attempts, profile, joinCode, setJoinCode, joinClass, selectedTask, setSelectedTask, studentAnswer, setStudentAnswer, result, setResult, submitAnswer, busy, completedCount } = props;
  const [classFilter, setClassFilter] = useState('');
  const visibleClasses: ClassRow[] = classes.filter((item: ClassRow) => !classFilter || item.id === classFilter);
  const visibleTasks: TaskRow[] = tasks.filter((task: TaskRow) => visibleClasses.some((item) => item.id === task.class_id));
  const recommendation = recommendNextTask(visibleTasks, attempts, profile.id);
  const orderedTasks = recommendation ? [...visibleTasks].sort((a, b) => Number(b.id === recommendation.task.id) - Number(a.id === recommendation.task.id)) : visibleTasks;
  const attemptedTaskIds = new Set(attempts.filter((attempt: AttemptRow) => attempt.student_id === profile.id).map((attempt: AttemptRow) => attempt.task_id));
  return <div><Heading eyebrow="Không gian học tập" title={`Chào ${profile.full_name}`} description="Chọn nhiệm vụ ngắn, luyện tập theo từng kỹ năng và theo dõi tiến độ của bạn." />
    <div className="mt-6 grid gap-3 sm:grid-cols-3"><Stat icon={<School />} label="Lớp đã tham gia" value={classes.length} /><Stat icon={<ClipboardList />} label="Nhiệm vụ của bạn" value={visibleTasks.length} /><Stat icon={<Check />} label="Lượt đã nộp" value={completedCount} /></div>
    {classes.length === 0 && <form onSubmit={joinClass} className="mt-6 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row"><div className="flex-1"><h3 className="font-bold">Tham gia lớp bằng mã</h3><p className="text-sm text-slate-500">Nhận mã từ giáo viên của bạn.</p></div><input required value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className={`${inputStyle} sm:max-w-xs uppercase`} placeholder="Mã lớp" /><button disabled={busy} className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Tham gia</button></form>}
    {classes.length > 0 && <div className="mt-6 flex flex-wrap items-center gap-2">{classes.map((item: ClassRow) => <button key={item.id} onClick={() => setClassFilter(classFilter === item.id ? '' : item.id)} className={`rounded-full px-4 py-2 text-sm font-medium ${!classFilter || classFilter === item.id ? 'bg-emerald-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{item.name}</button>)}<form onSubmit={joinClass} className="ml-auto flex w-full gap-2 sm:w-auto"><input required value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className={`${inputStyle} uppercase sm:w-40`} placeholder="Mã lớp mới" /><button className="rounded-xl border border-slate-300 bg-white px-3 font-semibold">+</button></form></div>}
    {recommendation && <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="text-xs font-bold uppercase tracking-wide text-emerald-800">Gợi ý theo tiến độ của bạn</span><h2 className="mt-1 text-xl font-bold">{recommendation.task.title}</h2><p className="mt-1 max-w-3xl text-sm text-emerald-950">{recommendation.reason}</p></div><button onClick={() => { setSelectedTask(recommendation.task); setStudentAnswer(''); setResult(null); }} className="rounded-xl bg-emerald-800 px-4 py-2.5 font-semibold text-white">Bắt đầu gợi ý</button></div>{Object.keys(recommendation.mastery).length > 0 && <div className="mt-4 flex flex-wrap gap-2">{Object.entries(recommendation.mastery).map(([skill, score]) => <span key={skill} className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-700">{skill}: {score}%</span>)}</div>}</section>}
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{orderedTasks.map((task) => <article key={task.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{task.skill_tag || 'Vật lý'} · Mức {task.difficulty}</span><span className="text-xs text-slate-500">~{task.estimated_minutes} phút</span></div><h3 className="mt-4 text-lg font-bold">{task.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{task.objective}</p><button onClick={() => { setSelectedTask(task); setStudentAnswer(''); setResult(null); }} className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white">{attemptedTaskIds.has(task.id) ? 'Làm lại nhiệm vụ' : 'Bắt đầu'}<ChevronRight size={17} /></button></article>)}{visibleTasks.length === 0 && <div className="md:col-span-2 xl:col-span-3"><Empty text="Lớp này chưa có nhiệm vụ. Giáo viên sẽ đăng bài tại đây." /></div>}</div>
    {selectedTask && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null); }}><section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><div><span className="text-sm font-semibold text-emerald-700">{selectedTask.skill_tag}</span><h2 className="mt-1 text-2xl font-bold">{selectedTask.title}</h2></div><button onClick={() => setSelectedTask(null)} className="rounded-full bg-slate-100 px-3 py-1">×</button></div><p className="mt-5 rounded-2xl bg-slate-50 p-4 leading-7">{selectedTask.content.prompt}</p><form onSubmit={submitAnswer} className="mt-5 space-y-3">{selectedTask.content.options.map((option: string) => <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${studentAnswer === option ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}><input type="radio" name="task-answer" value={option} checked={studentAnswer === option} onChange={() => setStudentAnswer(option)} />{option}</label>)}<button disabled={busy || !studentAnswer || Boolean(result)} className={primaryButton}>{busy ? 'Đang lưu…' : 'Nộp câu trả lời'}</button></form>{result && <div className={`mt-5 rounded-2xl p-4 ${result.score ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950'}`}><strong>{result.score ? 'Chính xác! Bạn đạt 100%.' : 'Chưa chính xác, hãy xem lại kiến thức.'}</strong><p className="mt-1 text-sm">{result.explanation}</p></div>}</section></div>}
  </div>;
}

const inputStyle = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const primaryButton = 'flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60';
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-medium text-slate-700">{label}<span className="mt-1.5 block">{children}</span></label>; }
function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div><p className="text-sm font-semibold text-emerald-700">{eyebrow}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{title}</h1><p className="mt-2 max-w-3xl text-slate-600">{description}</p></div>; }
function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) { return <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800">{icon}</span><div><strong className="block text-xl">{value}</strong><span className="text-xs text-slate-500">{label}</span></div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">{text}</div>; }
