import { Routes } from '@angular/router';
import { exchangeSectionGuard, signedInGuard, signedOutGuard } from './auth.guards';
import { ExchangePage } from './exchange-page';
import { LoginPage } from './login-page';
import { MainPage } from './main-page';

export const routes: Routes = [
  { path: '', component: LoginPage, canActivate: [signedOutGuard] },
  { path: 'main', component: MainPage, canActivate: [signedInGuard] },
  {
    path: 'exchanges/:exchangeId/:section',
    component: ExchangePage,
    canActivate: [signedInGuard, exchangeSectionGuard],
  },
  { path: '**', redirectTo: '' },
];
