export interface OnlineTeacher {
  readonly id: string;
  readonly name: string;
}

export type StudentSessionRequestStatus =
  'idle' | 'waiting' | 'accepted' | 'rejected' | 'timeout' | 'connected' | 'ended';

export interface StudentSessionSnapshot {
  readonly status: StudentSessionRequestStatus;
  readonly message: string;
  readonly activeSessionId: string | undefined;
}

export type StudentSessionListener = (snapshot: StudentSessionSnapshot) => void;

export interface StudentSessionApi {
  getOnlineTeachers(): Promise<readonly OnlineTeacher[]>;
  requestSession(teacherId: string): Promise<StudentSessionSnapshot>;
  getState(): Promise<StudentSessionSnapshot>;
  endSession(): Promise<StudentSessionSnapshot>;
  onStateChanged(listener: StudentSessionListener): () => void;
}
