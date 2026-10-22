import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { FirebaseError, initializeApp } from 'firebase/app';
import {
  Auth,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { firebaseConfig } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth: Auth | null;
  private readonly userState = signal<User | null>(null);
  private readonly authErrorState = signal<string | null>(null);
  private resolveAuthState!: (user: User | null) => void;
  private readonly authStateReady = new Promise<User | null>((resolve) => {
    this.resolveAuthState = resolve;
  });

  readonly user = this.userState.asReadonly();
  readonly authError = this.authErrorState.asReadonly();
  readonly isConfigured = computed(() => this.auth !== null);

  constructor() {
    const config = firebaseConfig;
    if (![config.apiKey, config.authDomain, config.projectId, config.appId].every(Boolean)) {
      this.auth = null;
      this.resolveAuthState(null);
      return;
    }

    this.auth = getAuth(initializeApp(config));
    const unsubscribe = onAuthStateChanged(
      this.auth,
      (user) => {
        this.userState.set(user);
        this.resolveAuthState(user);
      },
      (error) => {
        this.authErrorState.set(getAuthErrorMessage(error));
        this.resolveAuthState(null);
      },
    );
    this.destroyRef.onDestroy(unsubscribe);
  }

  async waitForAuthState(): Promise<User | null> {
    await this.authStateReady;
    return this.userState();
  }

  async signIn(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.requireAuth(), email, password);
    this.userState.set(credential.user);
  }

  async signUp(email: string, password: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(this.requireAuth(), email, password);
    this.userState.set(credential.user);
  }

  async signOut(): Promise<void> {
    await signOut(this.requireAuth());
    this.userState.set(null);
  }

  private requireAuth(): Auth {
    if (!this.auth) {
      throw new Error('Firebase is not configured. Add your Firebase web app settings first.');
    }
    return this.auth;
  }
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'auth/email-already-in-use': 'An account already exists for this email address.',
      'auth/invalid-credential': 'The email or password is incorrect.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/network-request-failed': 'Unable to connect. Check your internet connection and retry.',
      'auth/too-many-requests': 'Too many attempts. Please wait a while and try again.',
      'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
    };
    return messages[error.code] ?? `Firebase Authentication returned: ${error.code}.`;
  }

  return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
}
