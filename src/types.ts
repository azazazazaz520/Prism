export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}
