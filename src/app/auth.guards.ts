import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { canStartDrawing, ExchangeSection, isFamilyStepComplete } from './exchange.model';
import { ExchangeService } from './exchange.service';

export const signedInGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.waitForAuthState()) ? true : router.createUrlTree(['/']);
};

export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.waitForAuthState()) ? router.createUrlTree(['/main']) : true;
};

export const exchangeSectionGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const exchanges = inject(ExchangeService);
  const router = inject(Router);
  const userId = auth.user()?.uid;
  const exchangeId = route.paramMap.get('exchangeId');
  const section = route.paramMap.get('section') as ExchangeSection | null;
  if (userId) {
    await exchanges.load(userId);
  }
  const exchange = userId && exchangeId ? exchanges.getLoaded(userId, exchangeId) : undefined;

  if (!exchange || !['families', 'rules', 'drawing'].includes(section ?? '')) {
    return router.createUrlTree(['/main']);
  }
  if (section !== 'families' && !isFamilyStepComplete(exchange)) {
    return router.createUrlTree(['/exchanges', exchangeId, 'families']);
  }
  if (section === 'drawing' && !canStartDrawing(exchange)) {
    return router.createUrlTree([
      '/exchanges',
      exchangeId,
      isFamilyStepComplete(exchange) ? 'rules' : 'families',
    ]);
  }

  return true;
};
