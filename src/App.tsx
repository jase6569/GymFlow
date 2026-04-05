import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Dumbbell, 
  ShieldCheck, 
  AlertCircle, 
  ChevronRight, 
  Info, 
  Calendar, 
  Zap,
  ArrowLeft,
  History,
  Plus,
  Save,
  LogOut,
  User as UserIcon,
  CheckCircle2,
  Trophy,
  Activity,
  Flame,
  Clock,
  ChevronDown,
  ChevronUp,
  X
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { 
  auth, 
  db, 
  signInWithGoogle, 
  signOut, 
  handleFirestoreError, 
  OperationType 
} from "./firebase";
import { 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  Timestamp,
  deleteDoc
} from "firebase/firestore";
import { WORKOUT_ROUTINE, EXERCISE_LIBRARY } from "./constants";
import { WorkoutDay, WorkoutSession, LoggedExercise, LoggedSet, UserProfile, Exercise } from "./types";

import { GoogleGenAI } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Logo = ({ className }: { className?: string }) => (
  <div className={cn("relative flex items-center justify-center", className)}>
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {/* Market Flow Style Lines */}
      <motion.path
        d="M10 80 L30 60 L50 70 L70 40 L90 50"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
        className="text-blue-500/50"
      />
      <motion.path
        d="M10 70 L30 50 L50 60 L70 30 L90 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2, delay: 0.5, repeat: Infinity, repeatType: "reverse" }}
        className="text-blue-500"
      />
      {/* Gym Resemblance: Dumbbell in the middle */}
      <rect x="35" y="45" width="30" height="10" rx="2" fill="currentColor" className="text-white" />
      <rect x="30" y="40" width="10" height="20" rx="2" fill="currentColor" className="text-white" />
      <rect x="60" y="40" width="10" height="20" rx="2" fill="currentColor" className="text-white" />
    </svg>
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [selectedDay, setSelectedDay] = useState<WorkoutDay | null>(null);
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null);
  const [history, setHistory] = useState<WorkoutSession[]>([]);
  const [view, setView] = useState<"dashboard" | "session" | "history">("dashboard");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [customRoutines, setCustomRoutines] = useState<Record<string, string[]>>({});
  const [swappingExercise, setSwappingExercise] = useState<{ dayId: string, exerciseIdx: number } | null>(null);
  const [exerciseSearch, setExerciseSearch] = useState("");

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Sync user profile
        const userRef = doc(db, "users", currentUser.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            createdAt: serverTimestamp(),
          });
        } else {
          // Load custom routines if they exist on the user profile
          const data = userDoc.data();
          if (data.customRoutines) {
            setCustomRoutines(data.customRoutines);
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const saveCustomRoutines = async (newRoutines: Record<string, string[]>) => {
    if (!user) return;
    try {
      await setDoc(doc(db, "users", user.uid), { customRoutines: newRoutines }, { merge: true });
    } catch (error) {
      console.error("Error saving custom routines:", error);
    }
  };

  const swapExercise = (dayId: string, exerciseIdx: number, newExerciseId: string) => {
    const newRoutines = { ...customRoutines };
    const currentRoutine = newRoutines[dayId] || WORKOUT_ROUTINE.find(d => d.id === dayId)!.exercises.map(e => e.id);
    currentRoutine[exerciseIdx] = newExerciseId;
    newRoutines[dayId] = currentRoutine;
    setCustomRoutines(newRoutines);
    saveCustomRoutines(newRoutines);
    setSwappingExercise(null);
  };

  const getRoutineExercises = (day: WorkoutDay) => {
    const customIds = customRoutines[day.id];
    if (!customIds) return day.exercises;
    return customIds.map(id => EXERCISE_LIBRARY.find(e => e.id === id) || EXERCISE_LIBRARY[0]);
  };

  const analyzeProgress = async () => {
    if (!user || history.length === 0) return;
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const recentWorkouts = history.slice(0, 5).map(h => ({
        title: h.title,
        exercises: h.exercises.map(ex => ({
          name: ex.name,
          sets: ex.sets.map(s => `Weight: ${s.weight}kg, Reps: ${s.reps}, Target: ${s.targetReps}, RPE: ${s.rpe || 'N/A'}`)
        }))
      }));

      const prompt = `You are the NexaGlow AI Progression Engine. Analyze these recent workouts for a user with 5 years of gym experience. 
      The user is on a back-safe 4-day split (Upper/Lower). 
      Target reps: 20 for compounds, 30 for isolation.
      
      Workouts: ${JSON.stringify(recentWorkouts)}
      
      Provide a concise, professional "NexaGlow Optimization Report" in Markdown. 
      Include:
      1. Specific weight/rep progression suggestions for the next 4 sessions.
      2. Intensity analysis (based on RPE if available).
      3. A "Veteran Tip" (e.g., pre-exhaustion, rest-pause, or tempo control) to maximize hypertrophy while keeping the back safe.
      4. A "NexaGlow Efficiency Score" (1-100).`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiReport(result.text || "Unable to generate report.");
    } catch (error) {
      console.error("AI Analysis Error:", error);
      setAiReport("The NexaGlow AI Engine is currently offline. Please check your connection.");
    } finally {
      setAiLoading(false);
    }
  };

  // History Listener
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, "workouts"),
      where("userId", "==", user.uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WorkoutSession[];
      setHistory(logs);
    }, (error) => {
      console.error("History fetch error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const startSession = (day: WorkoutDay) => {
    if (!user) return;
    
    const exercises = getRoutineExercises(day);
    
    const newSession: WorkoutSession = {
      userId: user.uid,
      dayId: day.id,
      title: day.title,
      timestamp: Timestamp.now(),
      exercises: exercises.map(ex => ({
        exerciseId: ex.id,
        name: ex.name,
        type: ex.type,
        sets: Array.from({ length: ex.sets }, () => ({
          reps: 0,
          weight: 0,
          targetReps: ex.targetReps
        }))
      }))
    };
    
    setActiveSession(newSession);
    setView("session");
  };

  const updateSet = (exerciseIdx: number, setIdx: number, field: keyof LoggedSet, value: number) => {
    if (!activeSession) return;
    
    const newSession = { ...activeSession };
    newSession.exercises[exerciseIdx].sets[setIdx][field] = value;
    setActiveSession(newSession);
  };

  const finishSession = async () => {
    if (!activeSession || !user) return;
    setLoading(true);
    try {
      const sessionToSave = {
        ...activeSession,
        timestamp: serverTimestamp()
      };
      await addDoc(collection(db, "workouts"), sessionToSave);
      setActiveSession(null);
      setView("dashboard");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "workouts");
    } finally {
      setLoading(false);
    }
  };

  const deleteWorkout = async (id: string) => {
    if (!confirm("Are you sure you want to delete this workout log?")) return;
    try {
      await deleteDoc(doc(db, "workouts", id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `workouts/${id}`);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 overflow-hidden relative">
        {/* Futuristic Background Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="z-10 text-center space-y-8 max-w-md"
        >
          <div className="space-y-2">
            <div className="inline-flex p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 mb-4">
              <Logo className="w-16 h-16" />
            </div>
            <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-r from-white to-slate-500 bg-clip-text text-transparent italic">
              GYM FLOW
            </h1>
            <div className="space-y-1">
              <p className="text-blue-500 font-black tracking-[0.3em] uppercase text-[10px]">
                NexaGlow Systems
              </p>
              <p className="text-slate-500 font-medium tracking-widest uppercase text-[10px]">
                Performance Optimization Protocol
              </p>
            </div>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl space-y-6 shadow-2xl">
            <p className="text-slate-300 leading-relaxed text-sm">
              Comprehensive athletic management. Optimized back-safe routines with high-volume hypertrophy targets.
            </p>
            <button 
              onClick={signInWithGoogle}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-3 group"
            >
              <UserIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
              Initialize Session
            </button>
          </div>

          <div className="flex justify-center gap-6 text-slate-500 text-xs font-mono">
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Back-Safe</span>
            <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Real-time Sync</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30 pb-20">
      {/* Navigation Bar */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView("dashboard")}>
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-900/20">
              <Logo className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter hidden sm:block leading-none">GYM FLOW</h1>
              <p className="text-[8px] font-black text-blue-500 tracking-widest uppercase hidden sm:block">NexaGlow</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("history")}
              className={cn(
                "p-2 rounded-xl transition-all",
                view === "history" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800"
              )}
            >
              <History className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-800" />
            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden xs:block">
                <p className="text-xs font-bold text-white leading-none">{user.displayName}</p>
                <p className="text-[10px] text-slate-500 font-mono uppercase mt-1">Level 01 Athlete</p>
              </div>
              <button 
                onClick={signOut}
                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {view === "dashboard" && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Stats Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Workouts", value: history.length, icon: Activity, color: "text-blue-400" },
                  { label: "Streak", value: "4 Days", icon: Flame, color: "text-orange-500" },
                  { label: "Volume", value: "12.4k", icon: Trophy, color: "text-yellow-500" },
                  { label: "Time", value: "4.2h", icon: Clock, color: "text-green-400" },
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl">
                    <stat.icon className={cn("w-5 h-5 mb-2", stat.color)} />
                    <p className="text-2xl font-black text-white">{stat.value}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* AI Progression Engine */}
              <section className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl space-y-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Zap className="w-12 h-12 text-blue-500" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-blue-400">NexaGlow AI Engine</h3>
                    <p className="text-[10px] text-slate-400 font-mono">Veteran Progression Analysis</p>
                  </div>
                  <button 
                    onClick={analyzeProgress}
                    disabled={aiLoading || history.length === 0}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-blue-600/20"
                  >
                    {aiLoading ? "Analyzing..." : "Generate Optimization Report"}
                  </button>
                </div>
                {history.length === 0 && (
                  <p className="text-[10px] text-slate-500 italic">Log at least one session to initialize AI analysis.</p>
                )}
              </section>

              {/* Volume Flow Chart (Market Style) */}
              <section className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Volume Flow</h3>
                    <p className="text-[10px] text-blue-500 font-mono">NexaGlow Analytics</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-green-400">
                    <ChevronUp className="w-4 h-4" /> +12.4%
                  </div>
                </div>
                <div className="h-32 w-full relative group">
                  <svg viewBox="0 0 400 100" className="w-full h-full preserve-3d">
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Grid Lines */}
                    {[0, 25, 50, 75, 100].map(y => (
                      <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#1e293b" strokeWidth="0.5" />
                    ))}
                    {/* The Flow Line */}
                    <motion.path
                      d="M0 80 Q 50 70, 100 85 T 200 40 T 300 60 T 400 20"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="3"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 2, ease: "easeInOut" }}
                    />
                    {/* Area Fill */}
                    <motion.path
                      d="M0 80 Q 50 70, 100 85 T 200 40 T 300 60 T 400 20 V 100 H 0 Z"
                      fill="url(#chartGradient)"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 1, delay: 1 }}
                    />
                    {/* Data Points */}
                    {[
                      { x: 100, y: 85 },
                      { x: 200, y: 40 },
                      { x: 300, y: 60 },
                      { x: 400, y: 20 }
                    ].map((p, i) => (
                      <motion.circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        fill="#3b82f6"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 1.5 + i * 0.1 }}
                      />
                    ))}
                  </svg>
                  {/* Hover Tooltip Simulation */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[8px] font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                    PEAK VOLUME: 14,250 KG
                  </div>
                </div>
              </section>

              {/* Veteran Optimization Protocol */}
              <section className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-600/20 p-2 rounded-xl">
                    <Trophy className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Veteran Protocol</h3>
                    <p className="text-[10px] text-purple-500 font-mono">Pre-Exhaustion Strategy</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  With 5 years of experience, consider the <span className="text-purple-400 font-bold">Pre-Exhaustion Method</span>. 
                  Perform isolation exercises (e.g., Leg Extensions) before compounds (e.g., Leg Press). 
                  This fatigues the target muscle, allowing you to hit failure with lower absolute loads on compounds, 
                  further reducing spinal compression.
                </p>
              </section>

              {/* Split Selection */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Select Protocol</h2>
                  <div className="flex items-center gap-2 text-[10px] text-blue-500 font-bold uppercase">
                    <ShieldCheck className="w-3 h-3" /> Back-Safe Active
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {WORKOUT_ROUTINE.map((day, idx) => (
                    <motion.button
                      key={day.id}
                      whileHover={{ scale: 1.02, backgroundColor: "rgba(30, 41, 59, 0.8)" }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => startSession(day)}
                      className="group relative overflow-hidden bg-slate-900 border border-slate-800 p-6 rounded-3xl text-left transition-all hover:border-blue-500/50"
                    >
                      <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Dumbbell className="w-16 h-16" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <span className="bg-blue-600/20 text-blue-400 text-[10px] font-black px-2 py-1 rounded-md uppercase">
                          Day 0{idx + 1}
                        </span>
                        <div className="h-px flex-1 bg-slate-800" />
                      </div>
                      <h3 className="text-2xl font-black text-white mb-1 tracking-tight">{day.title}</h3>
                      <p className="text-slate-400 text-sm mb-4 font-medium">{day.focus}</p>
                      
                      <div className="space-y-2 mb-6">
                        {getRoutineExercises(day).map((ex, i) => (
                          <div key={i} className="flex items-center justify-between group/ex">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-blue-500" />
                              <span className="text-[11px] text-slate-300 font-medium">{ex.name}</span>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSwappingExercise({ dayId: day.id, exerciseIdx: i });
                              }}
                              className="text-[9px] text-slate-600 hover:text-blue-400 font-bold uppercase tracking-tighter opacity-0 group-hover/ex:opacity-100 transition-opacity"
                            >
                              Swap
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex -space-x-2">
                          {day.exercises.slice(0, 3).map((_, i) => (
                            <div key={i} className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-900" />
                          ))}
                          {day.exercises.length > 3 && (
                            <div className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold">
                              +{day.exercises.length - 3}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-blue-400 text-xs font-bold uppercase group-hover:gap-2 transition-all">
                          Initialize <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </section>
            </motion.div>
          )}

          {view === "session" && activeSession && (
            <motion.div
              key="session"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-32"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => {
                    if (confirm("Cancel session? Data will not be saved.")) {
                      setActiveSession(null);
                      setView("dashboard");
                    }
                  }}
                  className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors text-sm font-bold uppercase tracking-wider"
                >
                  <X className="w-4 h-4" /> Abort
                </button>
                <div className="text-center">
                  <h2 className="text-2xl font-black text-white tracking-tighter uppercase">{activeSession.title}</h2>
                  <p className="text-[10px] text-blue-500 font-mono font-black uppercase tracking-[0.3em]">Active Session</p>
                </div>
                <div className="w-16" /> {/* Spacer */}
              </div>

              <div className="space-y-6">
                {activeSession.exercises.map((ex, exIdx) => (
                  <div key={ex.exerciseId} className="bg-slate-900/50 border border-slate-800 rounded-3xl overflow-hidden">
                    <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/30">
                      <div>
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                          {ex.name}
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full uppercase",
                            ex.type === "compound" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"
                          )}>
                            {ex.type}
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 font-medium">Target: {ex.sets[0].targetReps} Reps</p>
                      </div>
                      <div className="bg-blue-600/10 p-2 rounded-xl">
                        <Activity className="w-5 h-5 text-blue-500" />
                      </div>
                    </div>

                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-5 gap-4 text-[10px] font-black uppercase text-slate-500 tracking-widest px-2">
                        <span>Set</span>
                        <span>Weight</span>
                        <span>Reps</span>
                        <span>RPE</span>
                        <span className="text-right">Status</span>
                      </div>
                      
                      {ex.sets.map((set, setIdx) => (
                      <div className="grid grid-cols-5 gap-4 items-center bg-slate-950/50 p-3 rounded-2xl border border-slate-800/50">
                        <span className="text-sm font-mono text-slate-400">0{setIdx + 1}</span>
                        <input 
                          type="number"
                          placeholder="0"
                          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors w-full"
                          onChange={(e) => updateSet(exIdx, setIdx, "weight", parseFloat(e.target.value) || 0)}
                        />
                        <input 
                          type="number"
                          placeholder={set.targetReps.toString()}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors w-full"
                          onChange={(e) => updateSet(exIdx, setIdx, "reps", parseInt(e.target.value) || 0)}
                        />
                        <input 
                          type="number"
                          placeholder="RPE"
                          min="1"
                          max="10"
                          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors w-full"
                          onChange={(e) => updateSet(exIdx, setIdx, "rpe", parseInt(e.target.value) || 0)}
                        />
                        <div className="flex justify-end">
                          {set.reps >= set.targetReps ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : set.reps > 0 ? (
                            <div className="w-5 h-5 rounded-full border-2 border-orange-500/50 flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-orange-500" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-slate-800" />
                          )}
                        </div>
                      </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Session Footer */}
              <div className="fixed bottom-0 left-0 right-0 p-6 bg-slate-950/80 backdrop-blur-xl border-t border-slate-800 z-50">
                <div className="max-w-5xl mx-auto">
                  <button 
                    onClick={finishSession}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl shadow-2xl shadow-blue-600/20 transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
                  >
                    {loading ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <>
                        <Save className="w-5 h-5" />
                        Finalize Protocol
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-6">
                <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Mission Logs</h2>
                <button 
                  onClick={() => setView("dashboard")}
                  className="text-slate-500 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Dashboard
                </button>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800">
                  <History className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                  <p className="text-slate-500 font-medium">No logs found in the archives.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((log) => (
                    <div key={log.id} className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 group">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-black text-white uppercase tracking-tight">{log.title}</h3>
                          <p className="text-xs text-slate-500 font-mono mt-1">
                            {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleDateString('en-US', {
                              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                            }) : 'Processing...'}
                          </p>
                        </div>
                        <button 
                          onClick={() => log.id && deleteWorkout(log.id)}
                          className="p-2 text-slate-700 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {log.exercises.map((ex, i) => (
                          <div key={i} className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800/50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-slate-300">{ex.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono">{ex.sets.length} Sets</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {ex.sets.map((set, si) => (
                                <div key={si} className="bg-slate-900 px-2 py-1 rounded-md text-[10px] font-mono border border-slate-800">
                                  {set.weight}kg × {set.reps}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* AI Report Modal */}
      <AnimatePresence>
        {aiReport && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAiReport(null)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-blue-600/5">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-lg">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tight">Optimization Report</h3>
                    <p className="text-[10px] text-blue-500 font-black tracking-widest uppercase">NexaGlow AI Engine v2.5</p>
                  </div>
                </div>
                <button onClick={() => setAiReport(null)} className="p-2 text-slate-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 prose prose-invert prose-blue max-w-none">
                <div className="text-slate-300 whitespace-pre-wrap font-sans leading-relaxed text-sm">
                  {aiReport}
                </div>
              </div>
              <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                <button 
                  onClick={() => setAiReport(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-black px-6 py-3 rounded-xl uppercase tracking-widest transition-all"
                >
                  Acknowledge & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Swap Exercise Modal */}
      <AnimatePresence>
        {swappingExercise && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSwappingExercise(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-800 flex flex-col gap-4 bg-slate-900/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tight">Swap Exercise</h3>
                    <p className="text-xs text-slate-500 font-medium">Select a replacement for your routine</p>
                  </div>
                  <button onClick={() => setSwappingExercise(null)} className="p-2 text-slate-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="relative">
                  <input 
                    type="text"
                    placeholder="Search exercises..."
                    value={exerciseSearch}
                    onChange={(e) => setExerciseSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {EXERCISE_LIBRARY.filter(ex => 
                  ex.name.toLowerCase().includes(exerciseSearch.toLowerCase()) ||
                  ex.muscleGroups.some(mg => mg.toLowerCase().includes(exerciseSearch.toLowerCase()))
                ).map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => {
                      swapExercise(swappingExercise.dayId, swappingExercise.exerciseIdx, ex.id);
                      setExerciseSearch("");
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-950/50 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/50 transition-all text-left group"
                  >
                    <div>
                      <p className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">{ex.name}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-[9px] text-slate-500 uppercase font-black">{ex.type}</span>
                        <span className="text-[9px] text-slate-600">•</span>
                        <span className="text-[9px] text-slate-500 uppercase font-black">{ex.muscleGroups.join(", ")}</span>
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-slate-700 group-hover:text-blue-500 transition-colors" />
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Safety Warning */}
      <div className="max-w-5xl mx-auto px-4 mt-12">
        <div className="bg-blue-500/5 border border-blue-500/10 p-6 rounded-3xl flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 text-blue-500 shrink-0" />
          <div>
            <h4 className="text-sm font-black text-blue-400 uppercase tracking-widest mb-1">Safety Override Active</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              All protocols are optimized for lumbar protection. If spinal pressure is detected, abort immediately. 
              High volume (20/30 reps) is designed for metabolic stress—form integrity is paramount.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
