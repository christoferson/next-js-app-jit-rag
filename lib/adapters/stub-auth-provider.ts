import type { AuthProvider } from "./auth-provider";

export class StubAuthProvider implements AuthProvider {
  async currentUser(): Promise<{ userId: string }> {
    return { userId: process.env.DEFAULT_USER_ID ?? "local-user" };
  }
}
