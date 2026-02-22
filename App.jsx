import { useState, useRef, useEffect, useCallback } from "react";

// ─── Constants ───
const TOPICS = [
  { id: "cvp", label: "CVP Analysis", icon: "📊", desc: "Cost-Volume-Profit relationships" },
  { id: "budgeting", label: "Master Budgeting", icon: "📋", desc: "Operating & financial budgets" },
  { id: "variance", label: "Variance Analysis", icon: "🔍", desc: "Standard costs & variances" },
  { id: "costing", label: "Product Costing", icon: "🏭", desc: "Job-order, process, ABC" },
  { id: "decisions", label: "Decision Making", icon: "⚖️", desc: "Relevant costs & special decisions" },
  { id: "performance", label: "Performance Eval", icon: "📈", desc: "ROI, RI, EVA, balanced scorecard" },
  { id: "pricing", label: "Transfer Pricing", icon: "🔄", desc: "Internal pricing strategies" },
  { id: "forensic", label: "Forensic Accounting", icon: "🕵️", desc: "Fraud detection & investigation" },
];

const MASTERY_LEVELS = [
  { value: 1, label: "Lost", color: "#c0392b", emoji: "😵" },
  { value: 2, label: "Shaky", color: "#e67e22", emoji: "😬" },
  { value: 3, label: "Getting It", color: "#f1c40f", emoji: "🤔" },
  { value: 4, label: "Solid", color: "#27ae60", emoji: "💪" },
  { value: 5, label: "Mastered", color: "#2ecc71", emoji: "🔥" },
];

const QUICK_PROMPTS = [
  "Walk me through step by step",
  "Give me a real-world example",
  "Quiz me on this",
  "What are common exam mistakes?",
  "How does this connect to other topics?",
];

const SYSTEM_PROMPT = `You are "The Lyrical Scholar" — a Managerial Accounting personal tutor for MBA students at Texas A&M University-Central Texas, created by Professor Anthony (Department Chair of Accounting & Finance).

YOUR TEACHING PHILOSOPHY:
- "To know accounting, you must DO accounting" — always include practice elements
- "The numbers tell a story" — frame every concept as narrative, not just math
- "Your learning language" — meet students where they are linguistically and culturally
- Student-version-first: when showing math, explain the intuition BEFORE the formula
- Use Named Principles to make concepts memorable (e.g., "The DoorDash Principle" for variable costs, "The Netflix Principle" for fixed costs, "The Parking Spot Principle" for opportunity costs, "The Cracked Phone Principle" for sunk costs)

YOUR STYLE:
- Use contemporary analogies from student life: streaming services, food delivery apps, social media, gaming, side hustles, campus life
- Be warm, encouraging, but academically rigorous — this is graduate-level work
- Use the "knowledge gem" approach: drop insider insights that go deeper than textbooks
- Integrate real company examples (Amazon, Tesla, Starbucks, Nike, Apple, etc.)
- When doing math: show the student-friendly intuition first, THEN the formal formula, THEN a worked example
- Use the Principle of Threes for organizing explanations
- End substantive explanations with a quick check question to confirm understanding
- If a student is struggling, break it down further — never make them feel bad for not knowing

QUIZ MODE INSTRUCTIONS:
When the student asks to be quizzed or you give a check question:
- Clearly mark it as a question
- Wait for their answer before revealing the solution
- After they answer, tell them if they're correct or incorrect and explain why
- Track difficulty: start with foundational, increase based on correct answers

FORMATTING:
- Use clear headers for major sections
- Bold key terms on first introduction
- Use tables for comparing concepts when helpful
- Keep explanations conversational but precise

BOUNDARIES:
- Stay within managerial/cost accounting, forensic accounting, and related MBA finance topics
- If asked about unrelated topics, gently redirect
- Never give direct answers to what appear to be exam questions — instead, guide through the process
- Encourage students to attempt problems before revealing solutions

Remember: You're building financial fluency. Every student deserves a tutor who genuinely cares about their success.`;

// ─── Storage Layer (localStorage for deployed version) ───
const storage = {
  get(key) {
    try {
      const val = localStorage.getItem(`tutor_${key}`);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },
  set(key, value) {
    try {
      localStorage.setItem(`tutor_${key}`, JSON.stringify(value));
      return true;
    } catch { return false; }
  },
  listStudents() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("tutor_student:")) keys.push(k.replace("tutor_", ""));
    }
    return keys;
  }
};

const createEmptyProgress = (name, studentId) => ({
  name, studentId,
  createdAt: new Date().toISOString(),
  lastActive: new Date().toISOString(),
  totalSessions: 0,
  totalQuestions: 0,
  totalTimeMinutes: 0,
  quizScores: { correct: 0, incorrect: 0, total: 0 },
  topicData: TOPICS.reduce((acc, t) => {
    acc[t.id] = { questionsAsked: 0, timeMinutes: 0, mastery: 0, quizCorrect: 0, quizIncorrect: 0, lastStudied: null };
    return acc;
  }, {}),
  sessions: [],
});

// ─── Styles ───
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --maroon: #500000; --maroon-dark: #3a0000; --gold: #d4a574; --gold-light: #f0c896;
  --bg-primary: #0d0d1a; --bg-card: rgba(26,10,10,0.6); --text-primary: #f0e6d8;
  --text-secondary: rgba(232,224,216,0.6); --text-muted: rgba(232,224,216,0.35);
  --border: rgba(212,165,116,0.15); --border-hover: rgba(212,165,116,0.4);
}
body { background: var(--bg-primary); color: var(--text-primary); font-family: 'DM Sans', sans-serif; }
@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
@keyframes slideIn { from { opacity:0; transform:translateX(-20px); } to { opacity:1; transform:translateX(0); } }
.fade-up { animation: fadeUp 0.5s ease forwards; }
.slide-in { animation: slideIn 0.4s ease forwards; }
textarea:focus, input:focus { outline: none; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(212,165,116,0.2); border-radius: 3px; }
`;

// ─── Components ───

function LoginScreen({ onLogin }) {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [course, setCourse] = useState("5303");
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    if (!name.trim() || !studentId.trim()) return;
    setLoading(true);
    const key = `student:${studentId.trim().toLowerCase()}`;
    let progress = storage.get(key);
    if (!progress) {
      progress = createEmptyProgress(name.trim(), studentId.trim());
    }
    progress.lastActive = new Date().toISOString();
    progress.totalSessions += 1;
    progress.name = name.trim();
    progress.course = course;
    progress.sessions.push({ start: new Date().toISOString(), end: null, questions: 0, topics: [] });
    storage.set(key, progress);
    setLoading(false);
    onLogin({ name: name.trim(), studentId: studentId.trim(), course, progress });
  };

  const inputStyle = {
    width: "100%", padding: "14px 18px", background: "rgba(13,13,26,0.8)",
    border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-primary)",
    fontSize: 15, fontFamily: "'DM Sans', sans-serif", transition: "border 0.2s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg, #0d0d1a 0%, #1a0a0a 30%, #0d0d1a 60%, #0a0a1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="fade-up" style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, background: "linear-gradient(135deg, #d4a574, #b8860b)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px", boxShadow: "0 8px 32px rgba(212,165,116,0.25)" }}>📚</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>The Lyrical Scholar</h1>
        <p style={{ color: "var(--gold)", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 36, fontWeight: 500 }}>MBA Managerial Accounting Tutor</p>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 32, textAlign: "left" }}>
          <label style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" style={inputStyle} onFocus={e => e.target.style.borderColor = "var(--gold)"} onBlur={e => e.target.style.borderColor = "var(--border)"} />

          <label style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 8, marginTop: 20 }}>Student ID</label>
          <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="e.g., A12345678" style={inputStyle} onFocus={e => e.target.style.borderColor = "var(--gold)"} onBlur={e => e.target.style.borderColor = "var(--border)"} onKeyDown={e => { if (e.key === "Enter") handleLogin(); }} />

          <label style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 8, marginTop: 20 }}>Course</label>
          <div style={{ display: "flex", gap: 10 }}>
            {[["5303", "ACCT 5303 — Managerial"], ["5350", "ACCT 5350 — Forensic"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setCourse(val)} style={{
                flex: 1, padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif",
                background: course === val ? "linear-gradient(135deg, var(--maroon), var(--maroon-dark))" : "rgba(13,13,26,0.6)",
                border: course === val ? "1px solid var(--gold)" : "1px solid var(--border)",
                color: course === val ? "var(--gold-light)" : "var(--text-secondary)",
              }}>{lbl}</button>
            ))}
          </div>

          <button onClick={handleLogin} disabled={!name.trim() || !studentId.trim() || loading} style={{
            width: "100%", marginTop: 28, padding: "14px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 700, cursor: name.trim() && studentId.trim() ? "pointer" : "default", fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.5, transition: "all 0.2s",
            background: name.trim() && studentId.trim() ? "linear-gradient(135deg, var(--maroon), #800000)" : "rgba(80,0,0,0.3)",
            color: name.trim() && studentId.trim() ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: name.trim() && studentId.trim() ? "0 4px 20px rgba(80,0,0,0.4)" : "none",
          }}>
            {loading ? "Loading..." : "Start Studying"}
          </button>
        </div>

        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 20, letterSpacing: 0.5 }}>TAMU-CT Department of Accounting & Finance</p>
      </div>
    </div>
  );
}

function ProgressDashboard({ student, onClose, onExportCSV }) {
  const p = student.progress;
  const totalQuiz = p.quizScores.total;
  const quizPct = totalQuiz > 0 ? Math.round((p.quizScores.correct / totalQuiz) * 100) : 0;
  const avgMastery = (() => {
    const rated = Object.values(p.topicData).filter(t => t.mastery > 0);
    return rated.length ? (rated.reduce((s, t) => s + t.mastery, 0) / rated.length).toFixed(1) : "—";
  })();

  const statBoxStyle = {
    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 16px", textAlign: "center",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="fade-up" style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(145deg, #0d0d1a, #1a0a0a)", border: "1px solid var(--border)", borderRadius: 20, padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "var(--text-primary)" }}>Progress Dashboard</h2>
            <p style={{ color: "var(--gold)", fontSize: 13, marginTop: 4 }}>{p.name} • {p.studentId} • ACCT {p.course || "5303"}</p>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(212,165,116,0.1)", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--gold)" }}>{p.totalSessions}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>Sessions</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--gold)" }}>{p.totalQuestions}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>Questions</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 28, fontWeight: 700, color: totalQuiz > 0 ? (quizPct >= 70 ? "#2ecc71" : quizPct >= 50 ? "#f1c40f" : "#e74c3c") : "var(--gold)" }}>{totalQuiz > 0 ? `${quizPct}%` : "—"}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>Quiz Score</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--gold)" }}>{avgMastery}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>Avg Mastery</div>
          </div>
        </div>

        <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "var(--text-primary)", marginBottom: 14 }}>Topic Mastery</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {TOPICS.map(topic => {
            const td = p.topicData[topic.id];
            const ml = MASTERY_LEVELS.find(m => m.value === td.mastery);
            return (
              <div key={topic.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{topic.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{topic.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {td.questionsAsked} questions • {td.quizCorrect + td.quizIncorrect > 0 ? `${Math.round((td.quizCorrect / (td.quizCorrect + td.quizIncorrect)) * 100)}% quiz` : "No quizzes"}
                      {td.lastStudied ? ` • Last: ${new Date(td.lastStudied).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: "rgba(212,165,116,0.1)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(td.mastery / 5) * 100}%`, height: "100%", background: ml?.color || "var(--border)", borderRadius: 3, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 12, color: ml?.color || "var(--text-muted)", fontWeight: 600, minWidth: 60, textAlign: "right" }}>
                    {ml ? `${ml.emoji} ${ml.label}` : "Not rated"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onExportCSV} style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--gold)", background: "rgba(212,165,116,0.1)",
            color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          }}>Export Progress to CSV</button>
          <button onClick={onClose} style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, var(--maroon), #800000)",
            color: "var(--text-primary)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          }}>Back to Studying</button>
        </div>
      </div>
    </div>
  );
}

function MasteryRater({ topic, currentMastery, onRate }) {
  const [hovering, setHovering] = useState(null);
  return (
    <div className="fade-up" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", margin: "12px 0" }}>
      <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600, marginBottom: 10 }}>How confident are you with {topic.label}?</div>
      <div style={{ display: "flex", gap: 6 }}>
        {MASTERY_LEVELS.map(level => (
          <button key={level.value} onClick={() => onRate(topic.id, level.value)}
            onMouseEnter={() => setHovering(level.value)} onMouseLeave={() => setHovering(null)}
            style={{
              flex: 1, padding: "10px 4px", borderRadius: 8, cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif",
              background: currentMastery === level.value ? `${level.color}22` : hovering === level.value ? "rgba(212,165,116,0.1)" : "transparent",
              border: currentMastery === level.value ? `2px solid ${level.color}` : "1px solid var(--border)",
              color: currentMastery === level.value ? level.color : "var(--text-secondary)",
            }}>
            <div style={{ fontSize: 18 }}>{level.emoji}</div>
            <div style={{ fontSize: 10, marginTop: 4, fontWeight: 600 }}>{level.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function InstructorPanel({ onClose }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const keys = storage.listStudents();
    const data = [];
    for (const key of keys) {
      const s = storage.get(key);
      if (s) data.push(s);
    }
    data.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
    setStudents(data);
    setLoading(false);
  }, []);

  const exportAllCSV = () => {
    const rows = [["Student Name", "Student ID", "Course", "Sessions", "Questions", "Quiz Correct", "Quiz Incorrect", "Quiz %", "Avg Mastery", "Last Active",
      ...TOPICS.map(t => `${t.label} Mastery`), ...TOPICS.map(t => `${t.label} Questions`), ...TOPICS.map(t => `${t.label} Quiz%`)]];
    students.forEach(s => {
      const qTotal = s.quizScores.total;
      const qPct = qTotal > 0 ? Math.round((s.quizScores.correct / qTotal) * 100) : 0;
      const rated = Object.values(s.topicData).filter(t => t.mastery > 0);
      const avgM = rated.length ? (rated.reduce((sum, t) => sum + t.mastery, 0) / rated.length).toFixed(1) : "N/A";
      rows.push([
        s.name, s.studentId, `ACCT ${s.course || "5303"}`, s.totalSessions, s.totalQuestions, s.quizScores.correct, s.quizScores.incorrect, `${qPct}%`, avgM, new Date(s.lastActive).toLocaleDateString(),
        ...TOPICS.map(t => s.topicData[t.id]?.mastery || 0),
        ...TOPICS.map(t => s.topicData[t.id]?.questionsAsked || 0),
        ...TOPICS.map(t => { const d = s.topicData[t.id]; const tot = d.quizCorrect + d.quizIncorrect; return tot > 0 ? `${Math.round((d.quizCorrect / tot) * 100)}%` : "N/A"; }),
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tutor_progress_all_students_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.9)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="fade-up" style={{ maxWidth: 800, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(145deg, #0d0d1a, #1a0a0a)", border: "1px solid var(--border)", borderRadius: 20, padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "var(--text-primary)" }}>Instructor Dashboard</h2>
            <p style={{ color: "var(--gold)", fontSize: 13, marginTop: 4 }}>{students.length} students tracked</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={exportAllCSV} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--gold)", background: "rgba(212,165,116,0.1)", color: "var(--gold)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'" }}>Export All CSV</button>
            <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(212,165,116,0.1)", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>

        {loading ? <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40 }}>Loading student data...</p> : students.length === 0 ? <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40 }}>No student data yet. Students will appear here after their first session.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {students.map(s => {
              const qTotal = s.quizScores.total;
              const qPct = qTotal > 0 ? Math.round((s.quizScores.correct / qTotal) * 100) : null;
              const expanded = expandedId === s.studentId;
              return (
                <div key={s.studentId} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div onClick={() => setExpandedId(expanded ? null : s.studentId)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 10 }}>{s.studentId} • ACCT {s.course || "5303"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
                      <span style={{ color: "var(--text-secondary)" }}>{s.totalQuestions} Q's</span>
                      {qPct !== null && <span style={{ color: qPct >= 70 ? "#2ecc71" : qPct >= 50 ? "#f1c40f" : "#e74c3c", fontWeight: 600 }}>{qPct}%</span>}
                      <span style={{ color: "var(--text-muted)" }}>Last: {new Date(s.lastActive).toLocaleDateString()}</span>
                      <span style={{ color: "var(--gold)", fontSize: 16 }}>{expanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ padding: "0 20px 16px", borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: "14px 0" }}>
                        {TOPICS.map(t => {
                          const td = s.topicData[t.id];
                          const ml = MASTERY_LEVELS.find(m => m.value === td.mastery);
                          return (
                            <div key={t.id} style={{ padding: "10px", background: "rgba(13,13,26,0.5)", borderRadius: 8, textAlign: "center" }}>
                              <div style={{ fontSize: 16 }}>{t.icon}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", marginTop: 4 }}>{t.label}</div>
                              <div style={{ fontSize: 10, color: ml?.color || "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{ml?.label || "Unrated"}</div>
                              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>{td.questionsAsked} Q's</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [student, setStudent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [showTopics, setShowTopics] = useState(true);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showInstructor, setShowInstructor] = useState(false);
  const [showMastery, setShowMastery] = useState(null);
  const [sessionStart] = useState(Date.now());
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const saveProgress = useCallback((updater) => {
    if (!student) return;
    const key = `student:${student.studentId.toLowerCase()}`;
    const latest = storage.get(key) || student.progress;
    const updated = updater(latest);
    updated.lastActive = new Date().toISOString();
    const sessions = updated.sessions;
    if (sessions.length > 0) {
      sessions[sessions.length - 1].end = new Date().toISOString();
      sessions[sessions.length - 1].minutesElapsed = Math.round((Date.now() - sessionStart) / 60000);
    }
    storage.set(key, updated);
    setStudent(prev => ({ ...prev, progress: updated }));
  }, [student, sessionStart]);

  const sendMessage = async (content) => {
    if (!content.trim() || loading) return;
    const userMsg = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setShowTopics(false);

    saveProgress(p => {
      p.totalQuestions += 1;
      if (selectedTopic) {
        p.topicData[selectedTopic.id].questionsAsked += 1;
        p.topicData[selectedTopic.id].lastStudied = new Date().toISOString();
        const sess = p.sessions;
        if (sess.length > 0 && !sess[sess.length - 1].topics.includes(selectedTopic.id)) {
          sess[sess.length - 1].topics.push(selectedTopic.id);
        }
      }
      if (p.sessions.length > 0) p.sessions[p.sessions.length - 1].questions += 1;
      return p;
    });

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: SYSTEM_PROMPT + `\n\nCurrent student: ${student.name} (${student.studentId}), Course: ACCT ${student.course}. Current topic focus: ${selectedTopic?.label || "General"}`, messages: apiMessages }),
      });
      const data = await response.json();
      const assistantContent = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n") || "Having trouble responding. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: assistantContent }]);

      const lower = assistantContent.toLowerCase();
      if (lower.includes("correct!") || lower.includes("that's right") || lower.includes("well done") || lower.includes("exactly right") || lower.includes("great job")) {
        saveProgress(p => {
          p.quizScores.correct += 1; p.quizScores.total += 1;
          if (selectedTopic) p.topicData[selectedTopic.id].quizCorrect += 1;
          return p;
        });
      } else if (lower.includes("not quite") || lower.includes("incorrect") || lower.includes("that's not") || lower.includes("let's try again") || lower.includes("close, but")) {
        saveProgress(p => {
          p.quizScores.incorrect += 1; p.quizScores.total += 1;
          if (selectedTopic) p.topicData[selectedTopic.id].quizIncorrect += 1;
          return p;
        });
      }

      if (selectedTopic && newMessages.length >= 6 && newMessages.length % 6 === 0) {
        setShowMastery(selectedTopic);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection issue — please try again." }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const selectTopic = (topic) => {
    setSelectedTopic(topic);
    sendMessage(`I'd like to study ${topic.label} (${topic.desc}). Start by giving me a clear overview of the key concepts, why this matters for managers, and a real-world example to anchor my understanding.`);
  };

  const handleMasteryRate = (topicId, value) => {
    saveProgress(p => { p.topicData[topicId].mastery = value; return p; });
    setShowMastery(null);
  };

  const exportStudentCSV = () => {
    const p = student.progress;
    const rows = [["Metric", "Value"]];
    rows.push(["Name", p.name], ["Student ID", p.studentId], ["Course", `ACCT ${p.course || "5303"}`], ["Total Sessions", p.totalSessions], ["Total Questions", p.totalQuestions], ["Quiz Correct", p.quizScores.correct], ["Quiz Incorrect", p.quizScores.incorrect], ["Quiz %", p.quizScores.total > 0 ? `${Math.round((p.quizScores.correct / p.quizScores.total) * 100)}%` : "N/A"], ["Last Active", new Date(p.lastActive).toLocaleDateString()], [""], ["Topic", "Mastery", "Questions", "Quiz Correct", "Quiz Incorrect", "Last Studied"]);
    TOPICS.forEach(t => {
      const td = p.topicData[t.id]; const ml = MASTERY_LEVELS.find(m => m.value === td.mastery);
      rows.push([t.label, ml?.label || "Unrated", td.questionsAsked, td.quizCorrect, td.quizIncorrect, td.lastStudied ? new Date(td.lastStudied).toLocaleDateString() : "Never"]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${p.studentId}_progress_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const renderMarkdown = (text) => {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:0.9em;color:#e8d5b7">$1</code>')
      .replace(/^### (.+)$/gm, '<h4 style="color:var(--gold);margin:14px 0 6px;font-family:Playfair Display,serif;font-size:1.05em">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 style="color:var(--gold);margin:16px 0 8px;font-family:Playfair Display,serif;font-size:1.15em">$1</h3>')
      .replace(/^# (.+)$/gm, '<h2 style="color:var(--gold);margin:18px 0 10px;font-family:Playfair Display,serif;font-size:1.25em">$1</h2>')
      .replace(/\n/g, '<br/>');
  };

  if (!student) return <><style>{CSS}</style><LoginScreen onLogin={setStudent} /></>;

  const qTotal = student.progress.quizScores.total;
  const qPct = qTotal > 0 ? Math.round((student.progress.quizScores.correct / qTotal) * 100) : null;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg, #0d0d1a 0%, #1a0a0a 30%, #0d0d1a 60%, #0a0a1a 100%)", fontFamily: "'DM Sans', sans-serif", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <style>{CSS}</style>

      {showDashboard && <ProgressDashboard student={student} onClose={() => setShowDashboard(false)} onExportCSV={exportStudentCSV} />}
      {showInstructor && <InstructorPanel onClose={() => setShowInstructor(false)} />}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, var(--maroon) 0%, var(--maroon-dark) 40%, #2a0a0a 100%)", borderBottom: "1px solid var(--border)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, background: "linear-gradient(135deg, #d4a574, #b8860b)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 2px 12px rgba(212,165,116,0.3)" }}>📚</div>
          <div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>The Lyrical Scholar</div>
            <div style={{ fontSize: 11, color: "rgba(212,165,116,0.7)", fontWeight: 500, letterSpacing: 1.5, textTransform: "uppercase" }}>
              {student.name} • ACCT {student.course} {selectedTopic ? `• ${selectedTopic.label}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, marginRight: 8, fontSize: 12 }}>
            <span style={{ color: "var(--text-secondary)" }}><span style={{ color: "var(--gold)", fontWeight: 600 }}>{student.progress.totalQuestions}</span> Q's</span>
            {qPct !== null && <span style={{ color: qPct >= 70 ? "#2ecc71" : qPct >= 50 ? "#f1c40f" : "#e74c3c", fontWeight: 600 }}>{qPct}% quiz</span>}
          </div>
          <button onClick={() => setShowDashboard(true)} title="My Progress" style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(212,165,116,0.12)", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>📈</button>
          <button onClick={() => setShowInstructor(true)} title="Instructor View" style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(212,165,116,0.12)", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>🎓</button>
          <button onClick={() => { setMessages([]); setSelectedTopic(null); setShowTopics(true); }} title="New Topic" style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(212,165,116,0.12)", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'" }}>New Topic</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 840, width: "100%", margin: "0 auto", padding: "0 20px" }}>
        {showTopics && messages.length === 0 && (
          <div className="fade-up" style={{ padding: "40px 0 20px" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
                Welcome back, <span style={{ background: "linear-gradient(90deg, #d4a574, #f0c896, #d4a574)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{student.name.split(" ")[0]}</span>
              </h1>
              <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto" }}>Choose a topic to study or ask any question. Your progress is tracked automatically.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
              {TOPICS.map(topic => {
                const td = student.progress.topicData[topic.id];
                const ml = MASTERY_LEVELS.find(m => m.value === td.mastery);
                return (
                  <button key={topic.id} onClick={() => selectTopic(topic)} style={{
                    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.25s", position: "relative",
                  }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 22 }}>{topic.icon}</span>
                      {ml && <span style={{ fontSize: 10, color: ml.color, fontWeight: 700, background: `${ml.color}18`, padding: "2px 8px", borderRadius: 20 }}>{ml.label}</span>}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginTop: 10, marginBottom: 3 }}>{topic.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{topic.desc}</div>
                    {td.questionsAsked > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>{td.questionsAsked} questions studied</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: messages.length ? "20px 0" : "0" }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 14, animation: "fadeUp 0.3s ease" }}>
              <div style={{
                maxWidth: msg.role === "user" ? "75%" : "88%", padding: msg.role === "user" ? "12px 18px" : "18px 22px",
                borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: msg.role === "user" ? "linear-gradient(135deg, var(--maroon), var(--maroon-dark))" : "rgba(26,20,20,0.7)",
                border: msg.role === "user" ? "1px solid rgba(212,165,116,0.25)" : "1px solid rgba(212,165,116,0.08)",
                fontSize: 14, lineHeight: 1.7, color: msg.role === "user" ? "var(--text-primary)" : "#e0d8d0",
              }}>
                {msg.role === "assistant" ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} /> : msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", marginBottom: 14 }}>
              <div style={{ padding: "14px 22px", borderRadius: "16px 16px 16px 4px", background: "rgba(26,20,20,0.7)", border: "1px solid rgba(212,165,116,0.08)", display: "flex", alignItems: "center", gap: 6 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
                <span style={{ fontSize: 12, color: "rgba(212,165,116,0.5)", marginLeft: 8 }}>Preparing your lesson...</span>
              </div>
            </div>
          )}
          {showMastery && <MasteryRater topic={showMastery} currentMastery={student.progress.topicData[showMastery.id]?.mastery || 0} onRate={handleMasteryRate} />}
          <div ref={chatEndRef} />
        </div>

        {messages.length > 0 && !loading && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0", justifyContent: "center" }}>
            {QUICK_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => sendMessage(p)} style={{
                background: "rgba(212,165,116,0.06)", border: "1px solid var(--border)", color: "rgba(212,165,116,0.65)", padding: "5px 13px", borderRadius: 20, fontSize: 11, cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap", fontFamily: "'DM Sans'",
              }} onMouseEnter={e => { e.target.style.borderColor = "var(--border-hover)"; e.target.style.color = "var(--gold)"; }} onMouseLeave={e => { e.target.style.borderColor = "var(--border)"; e.target.style.color = "rgba(212,165,116,0.65)"; }}>
                {p}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: "14px 0 20px", position: "sticky", bottom: 0, background: "linear-gradient(to top, #0d0d1a 60%, transparent)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: "rgba(26,15,15,0.8)", border: "1px solid var(--border)", borderRadius: 14, padding: "6px 6px 6px 18px", backdropFilter: "blur(10px)" }}>
            <textarea ref={inputRef} value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={selectedTopic ? `Ask about ${selectedTopic.label}...` : "Ask any managerial accounting question..."}
              rows={1}
              style={{ flex: 1, background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "none", lineHeight: 1.5, padding: "8px 0", maxHeight: 120 }}
            />
            <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading} style={{
              width: 42, height: 42, borderRadius: 10, border: "none", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: input.trim() && !loading ? "pointer" : "default", transition: "all 0.2s",
              background: input.trim() && !loading ? "linear-gradient(135deg, var(--maroon), #800000)" : "rgba(80,0,0,0.3)",
              color: input.trim() && !loading ? "var(--text-primary)" : "var(--text-muted)",
            }}>↑</button>
          </div>
          <div style={{ textAlign: "center", fontSize: 10, color: "var(--text-muted)", marginTop: 8, letterSpacing: 0.5 }}>
            TAMU-CT Department of Accounting & Finance • Progress tracked automatically
          </div>
        </div>
      </div>
    </div>
  );
}
