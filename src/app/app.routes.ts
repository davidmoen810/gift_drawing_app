import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth.guards';
import { LoginPage } from './login-page';
import { MainPage } from './main-page';

export const routes: Routes = [
  { path: '', component: LoginPage, canActivate: [signedOutGuard] },
  { path: 'main', component: MainPage, canActivate: [signedInGuard] },
  { path: '**', redirectTo: '' },
];
