export interface OnlineTeacher {
  readonly id: string;
  readonly name: string;
}

export type StudentSessionRequestStatus = 'idle' | 'waiting' | 'accepted' | 'rejected' | 'timeout';

export interface StudentSessionSnapshot {
  readonly status: StudentSessionRequestStatus;
  readonly message: string;
}

export type StudentSessionListener = (snapshot: StudentSessionSnapshot) => void;

export interface StudentSessionApi {
  getOnlineTeachers(): Promise<readonly OnlineTeacher[]>;
  requestSession(teacherId: string): Promise<StudentSessionSnapshot>;
  getState(): Promise<StudentSessionSnapshot>;
  onStateChanged(listener: StudentSessionListener): () => void;
}
