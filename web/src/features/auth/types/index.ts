/** Sign-in state for this browser (GET /api/auth/session). */
export type Session = {
  authenticated: boolean;
  /** No account exists yet: the sign-in page offers to create one. */
  setup_required: boolean;
  username: string | null;
  /** False when the server runs with AUTH=false (sign-in handled elsewhere). */
  auth_enabled: boolean;
};

export type Credentials = { username: string; password: string };

/** The first account also needs the one-time set-up code the server writes to its logs (and data/setup-code). */
export type NewAccount = Credentials & { code: string };
