import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth/callback/callback.component').then((m) => m.CallbackComponent),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./profile/profile.component').then((m) => m.ProfileComponent),
      },
      {
        path: 'credentials',
        loadComponent: () =>
          import('./credentials/credentials.component').then((m) => m.CredentialsComponent),
      },
      {
        path: 'credentials/:platform',
        loadComponent: () =>
          import('./credentials/platform-login.component').then((m) => m.PlatformLoginComponent),
      },
      {
        path: 'filters',
        loadComponent: () => import('./filters/filters.component').then((m) => m.FiltersComponent),
      },
      {
        path: 'outreach',
        loadComponent: () => import('./outreach/outreach.component').then((m) => m.OutreachComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
