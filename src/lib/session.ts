 
export interface SessionUser {
  uid: string;
  name: string;
  email: string;
  purchasedBooks: number[];
  readingProgress: Record<number, number>;
  plan: 'free' | 'pro';
  isAdmin: boolean;
}

export async function getServerSession(idToken: string): Promise<SessionUser | null> {
  return null;
}