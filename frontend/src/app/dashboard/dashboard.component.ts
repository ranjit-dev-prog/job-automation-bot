import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { interval, Subscription, switchMap, startWith } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AGENT_STATE_LABELS, AutomationStatus, JobApplication } from '../core/models';

const POLL_INTERVAL_MS = 8000;
const CLOCK_TICK_MS = 1000;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  applications = signal<JobApplication[]>([]);
  status = signal<AutomationStatus | null>(null);
  stats = signal<Record<string, number>>({});
  loading = signal(true);
  statusFilter = signal<string>('ALL');
  /** Ticks every second so uptime/countdown displays move smoothly between the 8s status polls. */
  now = signal(Date.now());
  private statusFetchedAt = Date.now();
  private sub?: Subscription;
  private clockSub?: Subscription;

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.sub = interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.api.getAutomationStatus()),
      )
      .subscribe((status) => {
        this.status.set(status);
        this.statusFetchedAt = Date.now();
      });

    this.clockSub = interval(CLOCK_TICK_MS).subscribe(() => this.now.set(Date.now()));

    interval(POLL_INTERVAL_MS)
      .pipe(startWith(0))
      .subscribe(() => this.refreshApplications());
  }

  refreshApplications() {
    this.api.listApplications().subscribe((rows) => {
      this.applications.set(rows);
      this.loading.set(false);
    });
    this.api.getApplicationStats().subscribe((stats) => this.stats.set(stats));
  }

  setStatusFilter(status: string) {
    this.statusFilter.set(status);
  }

  get filteredApplications(): JobApplication[] {
    const filter = this.statusFilter();
    if (filter === 'ALL') return this.applications();
    return this.applications().filter((a) => a.status === filter);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.clockSub?.unsubscribe();
  }

  count(status: string): number {
    return this.stats()[status] ?? 0;
  }

  get total(): number {
    return Object.values(this.stats()).reduce((sum, n) => sum + n, 0);
  }

  badgeClass(status: string) {
    return `badge badge-${status.toLowerCase()}`;
  }

  stateLabel(): string {
    const s = this.status();
    if (!s) return 'Stopped';
    return AGENT_STATE_LABELS[s.state] ?? s.state;
  }

  uptimeLabel(): string {
    const s = this.status();
    if (!s?.running) return '—';
    return formatDuration(s.uptimeMs + (this.now() - this.statusFetchedAt));
  }

  nextSearchLabel(): string | null {
    const s = this.status();
    if (!s?.running || !s.nextSearchAt) return null;
    return formatCountdown(s.nextSearchAt - this.now());
  }

  isStandby(): boolean {
    return this.status()?.state === 'WAITING_FOR_NEW_JOBS';
  }
}
