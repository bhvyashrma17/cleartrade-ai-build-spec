'use server';

import { signOut } from '@/lib/auth';

export async function signOutFromSettings() {
  await signOut({ redirectTo: '/login' });
}
