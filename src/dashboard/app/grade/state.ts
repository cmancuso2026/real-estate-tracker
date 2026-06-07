import type { ManualGradeResult } from '@/lib/grade-manual';

/** State returned to the form: the graded result, or an error message. */
export interface GradeFormState {
  result: ManualGradeResult | null;
  error: string | null;
  /** Echoed inputs so the form can repopulate after submit. */
  values: Partial<Record<string, string>> | null;
}

export const INITIAL_GRADE_STATE: GradeFormState = {
  result: null,
  error: null,
  values: null,
};
