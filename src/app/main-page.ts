import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, getAuthErrorMessage } from './auth.service';

@Component({
  imports: [RouterLink],
  selector: 'app-main-page',
  styleUrl: './main-page.css',
  templateUrl: './main-page.html',
})
export class MainPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly errorMessage = signal<string | null>(null);
  readonly busy = signal(false);

  async signOut(): Promise<void> {
    this.errorMessage.set(null);
    this.busy.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.errorMessage.set(getAuthErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
