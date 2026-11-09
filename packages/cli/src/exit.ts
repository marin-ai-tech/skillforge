export const EXIT = {
  OK: 0,
  VALIDATION: 1,
  NOT_OWNER: 1,
  INVALID_INPUT: 2,
  CONFLICT: 2,
  UNREACHABLE: 3,
  UNAUTHORIZED: 4,
  LOCAL_CHANGES: 5,
  NOT_FOUND: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitFromHttpStatus(status: number): ExitCode {
  if (status === 401 || status === 403) return EXIT.UNAUTHORIZED;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 400 || status === 422) return EXIT.VALIDATION;
  if (status >= 400) return EXIT.VALIDATION;
  return EXIT.OK;
}
