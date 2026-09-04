import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, Subscription, startWith, switchMap, firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AutomationStatus, JobFilter, PLATFORMS, Platform } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ConfirmService } from '../core/confirm.service';

interface CsvRole {
  name: string;
  keywords: string;
  location: string;
}

const HEADER_WORDS = new Set(['name', 'role', 'job', 'title', 'job role', 'job title', 'keywords']);

/**
 * Deliberately not a full RFC-4180 CSV parser — job roles/keywords/location rarely contain
 * commas themselves, so a simple split covers the real use case (a plain list of role names,
 * optionally with ",keywords,location" columns) without pulling in a CSV library.
 */
function parseRolesCsv(text: string): CsvRole[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const roles: CsvRole[] = [];

  for (const line of lines) {
    if (!line) continue;
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (roles.length === 0 && HEADER_WORDS.has(cells[0].toLowerCase())) continue; // skip header row

    const [name, keywords, location] = cells;
    if (!name) continue;
    roles.push({ name, keywords: keywords || name, location: location || '' });
  }
  return roles;
}

const POLL_INTERVAL_MS = 8000;

interface FilterForm {
  name: string;
  keywords: string;
  location: string;
  remoteOnly: boolean;
  easyApplyOnly: boolean;
  minMatchScore: number;
  directApply: boolean;
  minSalary: number | null;
  emailOutreachEnabled: boolean;
  connectionOutreachEnabled: boolean;
  platforms: Platform[];
  delaySeconds: number;
  searchIntervalMinutes: number;
  maxApplicationsPerDay: number;
  customRulesJson: string;
}

export const SEARCH_INTERVAL_OPTIONS = [1, 5, 10, 15, 30];

function emptyForm(): FilterForm {
  return {
    name: '',
    keywords: '',
    location: '',
    remoteOnly: false,
    easyApplyOnly: true,
    minMatchScore: 60,
    directApply: true,
    minSalary: null,
    emailOutreachEnabled: false,
    connectionOutreachEnabled: false,
    platforms: [],
    delaySeconds: 1,
    searchIntervalMinutes: 5,
    maxApplicationsPerDay: 20,
    customRulesJson: '',
  };
}

@Component({
  selector: 'app-filters',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './filters.component.html',
  styleUrl: './filters.component.css',
})
export class FiltersComponent implements OnInit, OnDestroy {
  readonly platforms = PLATFORMS;
  readonly searchIntervalOptions = SEARCH_INTERVAL_OPTIONS;
  filters = signal<JobFilter[]>([]);
  loadingFilters = signal(true);
  form = emptyForm();
  saving = signal(false);
  error = signal<string | null>(null);
  startingId = signal<string | null>(null);
  startError = signal<string | null>(null);
  platformErrors = signal<Record<string, string>>({});
  startedPlatforms = signal<string[]>([]);

  status = signal<AutomationStatus | null>(null);
  stopping = signal(false);
  stopMessage = signal<string | null>(null);
  pausing = signal(false);
  resuming = signal(false);

  csvFile: File | null = null;
  csvImporting = signal(false);
  csvProgress = signal<{ done: number; total: number } | null>(null);
  csvResult = signal<string | null>(null);
  csvError = signal<string | null>(null);

  private statusSub?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    private readonly confirmService: ConfirmService,
  ) {}

  ngOnInit() {
    this.refresh();
    this.statusSub = interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.api.getAutomationStatus()),
      )
      .subscribe((status) => this.status.set(status));
  }

  ngOnDestroy() {
    this.statusSub?.unsubscribe();
  }

  refresh() {
    this.api.listFilters().subscribe({
      next: (rows) => {
        this.filters.set(rows);
        this.loadingFilters.set(false);
      },
      error: () => this.loadingFilters.set(false),
    });
  }

  togglePlatform(p: Platform) {
    const idx = this.form.platforms.indexOf(p);
    if (idx >= 0) this.form.platforms.splice(idx, 1);
    else this.form.platforms.push(p);
  }

  create() {
    if (this.form.platforms.length === 0) {
      this.error.set('Select at least one platform');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.createFilter(this.form).subscribe({
      next: (filter) => {
        this.saving.set(false);
        this.form = emptyForm();
        this.refresh();
        this.toast.success(`Filter "${filter.name}" created.`);
      },
      error: (err) => {
        this.error.set(err.error?.message ?? 'Failed to create filter');
        this.saving.set(false);
      },
    });
  }

  async remove(filter: JobFilter) {
    const confirmed = await this.confirmService.ask(
      `Delete "${filter.name}"? This can't be undone.`,
      { title: 'Delete filter', confirmLabel: 'Delete', danger: true },
    );
    if (!confirmed) return;

    this.api.deleteFilter(filter.id).subscribe({
      next: () => {
        this.refresh();
        this.toast.success(`Filter "${filter.name}" deleted.`);
      },
      error: (err) => this.toast.error(err.error?.message ?? 'Failed to delete filter'),
    });
  }

  start(filter: JobFilter) {
    this.startingId.set(filter.id);
    this.startError.set(null);
    this.stopMessage.set(null);
    this.platformErrors.set({});
    this.startedPlatforms.set([]);

    this.api.startAutomation(filter.id).subscribe({
      next: (res) => {
        this.startingId.set(null);
        this.platformErrors.set(res.platformErrors ?? {});
        this.startedPlatforms.set(res.platformsLoggedIn ?? []);
        if (!res.started) {
          this.startError.set('Could not log into any platform — see details below.');
          this.toast.error('Could not start — no platform logged in successfully.');
        } else {
          this.toast.success(`Auto-apply running on ${res.platformsLoggedIn.join(', ')}.`);
        }
        this.refreshStatus();
      },
      error: (err) => {
        const message = err.error?.message ?? 'Failed to start automation';
        this.startError.set(message);
        this.startingId.set(null);
        this.toast.error(message);
      },
    });
  }

  platformErrorEntries() {
    return Object.entries(this.platformErrors());
  }

  stop() {
    this.stopping.set(true);
    this.stopMessage.set(null);
    this.api.stopAutomation().subscribe({
      next: () => {
        this.stopping.set(false);
        this.stopMessage.set('Automation stopped.');
        this.toast.info('Automation stopped.');
        this.refreshStatus();
      },
      error: (err) => {
        this.stopping.set(false);
        // A 404 here just means nothing was running — not really an error from the user's
        // point of view, so phrase it as a status rather than a failure.
        this.stopMessage.set(
          err.status === 404 ? 'Automation was not running.' : (err.error?.message ?? 'Failed to stop automation'),
        );
      },
    });
  }

  private refreshStatus() {
    this.api.getAutomationStatus().subscribe((status) => this.status.set(status));
  }

  pause() {
    this.pausing.set(true);
    this.api.pauseAutomation().subscribe({
      next: () => {
        this.pausing.set(false);
        this.toast.info('Automation paused.');
        this.refreshStatus();
      },
      error: (err) => {
        this.pausing.set(false);
        this.toast.error(err.error?.message ?? 'Failed to pause automation');
      },
    });
  }

  resume() {
    this.resuming.set(true);
    this.api.resumeAutomation().subscribe({
      next: () => {
        this.resuming.set(false);
        this.toast.success('Automation resumed.');
        this.refreshStatus();
      },
      error: (err) => {
        this.resuming.set(false);
        this.toast.error(err.error?.message ?? 'Failed to resume automation');
      },
    });
  }

  onCsvSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.csvFile = input.files?.[0] ?? null;
    this.csvResult.set(null);
    this.csvError.set(null);
  }

  async importCsv() {
    if (!this.csvFile) return;
    if (this.form.platforms.length === 0) {
      this.csvError.set('Select at least one platform in "New filter" below first — imported roles use those platform/delay/cap settings.');
      return;
    }

    const text = await this.csvFile.text();
    const roles = parseRolesCsv(text);
    if (roles.length === 0) {
      this.csvError.set('No job roles found in that file.');
      return;
    }

    this.csvImporting.set(true);
    this.csvError.set(null);
    this.csvResult.set(null);
    this.csvProgress.set({ done: 0, total: roles.length });

    let created = 0;
    let failed = 0;
    for (const role of roles) {
      try {
        await firstValueFrom(
          this.api.createFilter({
            name: role.name,
            keywords: role.keywords,
            location: role.location || this.form.location || undefined,
            remoteOnly: this.form.remoteOnly,
            easyApplyOnly: this.form.easyApplyOnly,
            minMatchScore: this.form.minMatchScore,
            directApply: this.form.directApply,
            emailOutreachEnabled: this.form.emailOutreachEnabled,
            connectionOutreachEnabled: this.form.connectionOutreachEnabled,
            platforms: this.form.platforms,
            delaySeconds: this.form.delaySeconds,
            searchIntervalMinutes: this.form.searchIntervalMinutes,
            maxApplicationsPerDay: this.form.maxApplicationsPerDay,
            customRulesJson: this.form.customRulesJson || undefined,
          }),
        );
        created++;
      } catch {
        failed++;
      }
      this.csvProgress.set({ done: created + failed, total: roles.length });
    }

    this.csvImporting.set(false);
    this.csvFile = null;
    const summary =
      failed === 0
        ? `Imported ${created} job role filter${created === 1 ? '' : 's'}.`
        : `Imported ${created} filter${created === 1 ? '' : 's'}, ${failed} failed.`;
    this.csvResult.set(summary);
    this.toast[failed === 0 ? 'success' : 'info'](summary);
    this.refresh();
  }
}
