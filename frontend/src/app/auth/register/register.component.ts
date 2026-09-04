import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: '../auth.css',
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  error = signal<string | null>(null);

  constructor(private readonly auth: AuthService) {}

  submit() {
    this.error.set(null);
    this.auth.register(this.email, this.password, this.name).subscribe({
      error: (err: HttpErrorResponse) =>
        this.error.set(err.error?.message ?? 'Registration failed'),
    });
  }

  registerWithGoogle() {
    this.auth.loginWithGoogle();
  }
}
