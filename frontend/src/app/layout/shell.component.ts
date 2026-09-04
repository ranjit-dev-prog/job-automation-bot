import { Component, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ToastComponent } from '../core/toast.component';
import { ConfirmDialogComponent } from '../core/confirm-dialog.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ToastComponent, ConfirmDialogComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent implements OnInit {
  constructor(readonly auth: AuthService) {}

  ngOnInit() {
    if (!this.auth.currentUser()) {
      this.auth.fetchCurrentUser();
    }
  }

  logout() {
    this.auth.logout();
  }
}
