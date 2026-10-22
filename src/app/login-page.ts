import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, getAuthErrorMessage } from './auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-login-page',
  styleUrl: './login-page.css',
  templateUrl: './login-page.html',
})
export class LoginPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly mode = signal<'sign-in' | 'sign-up'>('sign-in');
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  email = '';
  password = '';

  async submit(): Promise<void> {
    this.busy.set(true);
    this.errorMessage.set(null);

    try {
      if (this.mode() === 'sign-up') {
        await this.auth.signUp(this.email, this.password);
      } else {
        await this.auth.signIn(this.email, this.password);
      }
      await this.router.navigateByUrl('/main');
    } catch (error) {
      this.errorMessage.set(getAuthErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  toggleMode(): void {
    this.mode.update((mode) => (mode === 'sign-in' ? 'sign-up' : 'sign-in'));
    this.errorMessage.set(null);
  }
}
