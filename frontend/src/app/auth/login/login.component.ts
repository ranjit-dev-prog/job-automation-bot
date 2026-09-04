import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: '../auth.css',
})
export class LoginComponent {
  email = '';
  password = '';
  error = signal<string | null>(null);

  constructor(private readonly auth: AuthService) {}

  submit() {
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      error: (err: HttpErrorResponse) =>
        this.error.set(err.error?.message ?? 'Login failed'),
    });
  }

  loginWithGoogle() {
    this.auth.loginWithGoogle();
  }
}
