import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

const TOKEN_KEY = 'job_bot_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<AuthUser | null>(null);

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.token;
  }

  register(email: string, password: string, name: string) {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/register`, { email, password, name })
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  loginWithGoogle() {
    window.location.href = `${environment.apiUrl}/auth/google`;
  }

  setTokenFromCallback(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
    this.fetchCurrentUser();
    this.router.navigateByUrl('/dashboard');
  }

  fetchCurrentUser() {
    this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (user) => this.currentUser.set(user),
      error: () => this.logout(),
    });
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.currentUser.set(null);
    this.router.navigateByUrl('/login');
  }

  private handleAuthResponse(res: AuthResponse) {
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    this.currentUser.set(res.user);
    this.router.navigateByUrl('/dashboard');
  }
}
