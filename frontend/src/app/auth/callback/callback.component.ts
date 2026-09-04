import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-callback',
  standalone: true,
  template: `<p style="padding: 2rem; color: var(--text-dim)">Signing you in…</p>`,
})
export class CallbackComponent implements OnInit {
  constructor(
    private readonly route: ActivatedRoute,
    private readonly auth: AuthService,
  ) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      this.auth.setTokenFromCallback(token);
    }
  }
}
