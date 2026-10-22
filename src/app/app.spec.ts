import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LoginPage } from './login-page';
import { MainPage } from './main-page';
import { signedInGuard, signedOutGuard } from './auth.guards';
import { AuthService } from './auth.service';

describe('LoginPage', () => {
  const user = signal<{ email: string } | null>(null);

  beforeEach(async () => {
    user.set(null);
    await TestBed.configureTestingModule({
      imports: [LoginPage, MainPage],
      providers: [
        provideRouter([
          { path: '', component: LoginPage, canActivate: [signedOutGuard] },
          { path: 'main', component: MainPage, canActivate: [signedInGuard] },
        ]),
        {
          provide: AuthService,
          useValue: {
            isConfigured: signal(true),
            user,
            authError: signal(null),
            waitForAuthState: async () => user(),
            signIn: async () => user.set({ email: 'guest@example.com' }),
            signUp: async () => user.set({ email: 'guest@example.com' }),
            signOut: async () => user.set(null),
          },
        },
      ],
    }).compileComponents();
  });

  it('should render the gift exchange welcome and sign-in form', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Make gift giving feel effortless.');
    expect(compiled.textContent).toContain('Your next celebration starts here.');
    expect(compiled.querySelector('input[type="email"]')).toBeTruthy();
    expect(compiled.querySelector('input[type="password"]')).toBeTruthy();
  });

  it('should navigate to /main after a successful sign-in', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.componentInstance.submit();
    expect(TestBed.inject(Router).url).toBe('/main');
  });

  it('should navigate to /main after a successful sign-up', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.mode.set('sign-up');
    await fixture.componentInstance.submit();
    expect(TestBed.inject(Router).url).toBe('/main');
  });

  it('should redirect signed-out visitors away from /main', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/main');
    expect(router.url).toBe('/');
  });

  it('should redirect signed-in visitors from sign-in to /main', async () => {
    user.set({ email: 'guest@example.com' });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    expect(router.url).toBe('/main');
  });
});
