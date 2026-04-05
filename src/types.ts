export type ExerciseType = "compound" | "isolation";

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  sets: number;
  targetReps: number;
  rest: string;
  notes?: string;
  isBackSafe: boolean;
  muscleGroups: string[];
}

export interface WorkoutDay {
  id: string;
  title: string;
  focus: string;
  exercises: Exercise[];
}

export interface LoggedSet {
  reps: number;
  weight: number;
  targetReps: number;
  rpe?: number; // 1-10 scale
}

export interface LoggedExercise {
  exerciseId: string;
  name: string;
  type: ExerciseType;
  sets: LoggedSet[];
}

export interface WorkoutSession {
  id?: string;
  userId: string;
  dayId: string;
  title: string;
  timestamp: any; // Firestore Timestamp
  exercises: LoggedExercise[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: any;
}
