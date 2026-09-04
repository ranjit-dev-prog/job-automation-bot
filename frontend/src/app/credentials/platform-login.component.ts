import { Component, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { CredentialSummary, PLATFORM_LABELS, PLATFORMS, Platform } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-platform-login',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './platform-login.component.html',
  styleUrl: './platform-login.component.css',
})
export class PlatformLoginComponent implements OnInit {
  platform: Platform | null = null;
  label = '';
  connected = signal<CredentialSummary | null>(null);

  username = '';
  password = '';
  saving = signal(false);
  saveError = signal<string | null>(null);
  saved = signal(false);
  removing = signal(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly toast: ToastService,
    private readonly confirmService: ConfirmService,
  ) {}

  ngOnInit() {
    const param = (this.route.snapshot.paramMap.get('platform') ?? '').toUpperCase() as Platform;
    if (!PLATFORMS.includes(param)) {
      this.router.navigateByUrl('/credentials');
      return;
    }
    this.platform = param;
    this.label = PLATFORM_LABELS[param];
    this.refresh();
  }

  private refresh() {
    if (!this.platform) return;
    this.api.listCredentials().subscribe((rows) => {
      this.connected.set(rows.find((r) => r.platform === this.platform) ?? null);
    });
  }

  save() {
    if (!this.platform) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);
    this.api.saveCredential(this.platform, this.username, this.password).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.username = '';
        this.password = '';
        this.refresh();
        this.toast.success(`${this.label} login saved.`);
      },
      error: (err) => {
        const message = err.error?.message ?? 'Failed to save credential';
        this.saveError.set(message);
        this.saving.set(false);
        this.toast.error(message);
      },
    });
  }

  async remove() {
    if (!this.platform) return;
    const confirmed = await this.confirmService.ask(
      `Disconnect your ${this.label} login? Automation won't be able to log into ${this.label} until you reconnect it.`,
      { title: 'Disconnect login', confirmLabel: 'Disconnect', danger: true },
    );
    if (!confirmed) return;

    this.removing.set(true);
    this.api.removeCredential(this.platform).subscribe({
      next: () => {
        this.removing.set(false);
        this.refresh();
        this.toast.info(`${this.label} login disconnected.`);
      },
      error: (err) => {
        this.removing.set(false);
        this.toast.error(err.error?.message ?? 'Failed to disconnect');
      },
    });
  }
}
