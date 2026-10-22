import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, getAuthErrorMessage } from './auth.service';
import { ExchangeService } from './exchange.service';
import {
  canStartDrawing,
  GiftExchange,
  isFamilyStepComplete,
  isRulesStepComplete,
} from './exchange.model';

@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-main-page',
  styleUrl: './main-page.css',
  templateUrl: './main-page.html',
})
export class MainPage {
  readonly auth = inject(AuthService);
  private readonly exchangeService = inject(ExchangeService);
  private readonly router = inject(Router);
  readonly errorMessage = signal<string | null>(null);
  readonly busy = signal(false);
  readonly createBusy = signal(false);
  readonly createError = signal<string | null>(null);
  readonly exchangeName = signal('');

  readonly exchanges = computed(() => {
    const userId = this.auth.user()?.uid;
    return userId ? this.exchangeService.listLoaded(userId) : [];
  });

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.uid;
      if (userId) {
        void this.exchangeService.load(userId).catch((error: unknown) => {
          this.errorMessage.set(
            error instanceof Error ? error.message : 'Could not load your exchanges.',
          );
        });
      }
    });
  }

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

  async createExchange(): Promise<void> {
    const userId = this.auth.user()?.uid;
    if (!userId) {
      this.createError.set('Sign in again to create an exchange.');
      return;
    }
    this.createBusy.set(true);
    this.createError.set(null);
    try {
      const exchange = await this.exchangeService.create(userId, this.exchangeName());
      this.exchangeName.set('');
      await this.openExchange(exchange, 'families');
    } catch (error) {
      this.createError.set(error instanceof Error ? error.message : 'Could not create exchange.');
    } finally {
      this.createBusy.set(false);
    }
  }

  async openExchange(exchange: GiftExchange, section: 'families' | 'rules' | 'drawing') {
    const destination =
      section === 'drawing' && !canStartDrawing(exchange)
        ? isFamilyStepComplete(exchange)
          ? 'rules'
          : 'families'
        : section === 'rules' && !isFamilyStepComplete(exchange)
          ? 'families'
          : section;
    await this.router.navigate(['/exchanges', exchange.id, destination]);
  }

  progressLabel(exchange: GiftExchange): string {
    if (exchange.drawing) {
      return 'Drawing complete';
    }
    if (canStartDrawing(exchange)) {
      return 'Ready to draw';
    }
    if (isFamilyStepComplete(exchange)) {
      return isRulesStepComplete(exchange) ? 'Adjust rules or participants' : 'Rules to review';
    }
    return 'Add families';
  }
}
