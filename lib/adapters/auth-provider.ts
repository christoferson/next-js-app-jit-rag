/** AuthProvider seam — the ONLY place the current user is resolved. Cognito/Clerk impl later. */
export interface AuthProvider {
  currentUser(): Promise<{ userId: string }>;
}
