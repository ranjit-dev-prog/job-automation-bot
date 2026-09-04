import { Component, OnInit, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ConnectionMessage, EmailSource, MailCredentialStatus, OutreachEmail, OutreachLog, TargetCompany } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-outreach',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './outreach.component.html',
  styleUrl: './outreach.component.css',
})
export class OutreachComponent implements OnInit {
  emails = signal<OutreachEmail[]>([]);
  connectionMessages = signal<ConnectionMessage[]>([]);
  logs = signal<OutreachLog[]>([]);
  loadingEmails = signal(true);
  loadingConnections = signal(true);
  loadingLogs = signal(true);
  sendingEmails = signal(false);
  sendingConnections = signal(false);
  deletingEmails = signal(false);
  savingEdit = signal(false);

  selectedEmailIds = new Set<string>();
  selectedConnectionIds = new Set<string>();
  emailFilter = signal<'all' | 'verified' | 'guessed'>('all');
  filteredEmails = computed(() => {
    const filter = this.emailFilter();
    if (filter === 'all') return this.emails();
    return this.emails().filter((e) => this.isVerifiedSource(e.emailSource) === (filter === 'verified'));
  });
  expandedEmailId: string | null = null;
  expandedConnectionId: string | null = null;

  editingEmailId: string | null = null;
  editSubject = '';
  editBody = '';

  composingEmail = signal(false);
  creatingEmail = signal(false);
  newEmailCompany = '';
  newEmailTo = '';
  newEmailCc = '';
  newEmailSubject = '';
  newEmailBody = '';
  newEmailAttachResume = true;

  mailStatus = signal<MailCredentialStatus | null>(null);
  mailFormGmailUser = '';
  mailFormAppPassword = '';
  savingMailCredential = signal(false);
  removingMailCredential = signal(false);

  editingConnectionId: string | null = null;
  editMessage = '';

  targetCompanies = signal<TargetCompany[]>([]);
  loadingCompanies = signal(true);
  importText = '';
  importing = signal(false);
  drafting = signal(false);
  scrapingEmails = signal(false);
  deletingCompanies = signal(false);
  editingCompanyId: string | null = null;
  editCompanyEmail = '';

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    private readonly confirmService: ConfirmService,
  ) {}

  ngOnInit() {
    this.refreshEmails();
    this.refreshConnections();
    this.refreshLogs();
    this.refreshCompanies();
    this.refreshMailStatus();
  }

  refreshMailStatus() {
    this.api.getMailCredentialStatus().subscribe({
      next: (status) => this.mailStatus.set(status),
      error: () => this.mailStatus.set({ connected: false, gmailUser: null }),
    });
  }

  saveMailCredential() {
    if (!this.mailFormGmailUser.trim() || !this.mailFormAppPassword.trim()) {
      this.toast.error('Enter both your Gmail address and the App Password.');
      return;
    }
    this.savingMailCredential.set(true);
    this.api.saveMailCredential(this.mailFormGmailUser.trim(), this.mailFormAppPassword.trim()).subscribe({
      next: (status) => {
        this.savingMailCredential.set(false);
        this.mailStatus.set(status);
        this.mailFormGmailUser = '';
        this.mailFormAppPassword = '';
        this.toast.success('Gmail App Password saved — outreach emails will send from this account.');
      },
      error: (err) => {
        this.savingMailCredential.set(false);
        this.toast.error(err.error?.message ?? 'Failed to save credential');
      },
    });
  }

  async removeMailCredential() {
    const confirmed = await this.confirmService.ask(
      'Remove your saved Gmail App Password? Outreach sending will fall back to the server-wide default (if configured) or stop working.',
      { title: 'Remove Gmail credential', confirmLabel: 'Remove', danger: true },
    );
    if (!confirmed) return;

    this.removingMailCredential.set(true);
    this.api.removeMailCredential().subscribe({
      next: () => {
        this.removingMailCredential.set(false);
        this.mailStatus.set({ connected: false, gmailUser: null });
        this.toast.info('Gmail credential removed.');
      },
      error: (err) => {
        this.removingMailCredential.set(false);
        this.toast.error(err.error?.message ?? 'Failed to remove credential');
      },
    });
  }

  refreshCompanies() {
    this.api.listTargetCompanies().subscribe({
      next: (rows) => {
        this.targetCompanies.set(rows);
        this.loadingCompanies.set(false);
      },
      error: () => this.loadingCompanies.set(false),
    });
  }

  get pendingCompanyCount(): number {
    return this.targetCompanies().filter((c) => !c.draftedAt).length;
  }

  get unscrapedCompanyCount(): number {
    return this.targetCompanies().filter((c) => c.emailSource === 'guessed').length;
  }

  scrapeEmails() {
    const count = Math.min(100, this.unscrapedCompanyCount);
    if (count === 0) return;
    this.scrapingEmails.set(true);
    this.api.scrapeTargetCompanyEmails(100).subscribe({
      next: (res) => {
        this.scrapingEmails.set(false);
        this.toast.info(
          `Checked ${res.attempted} compan${res.attempted === 1 ? 'y' : 'ies'} — found real emails for ${res.scraped}, ` +
            `nothing found for ${res.notFound}, ${res.invalidDomain} guessed domain${res.invalidDomain === 1 ? '' : 's'} can't receive mail at all.`,
        );
        this.refreshCompanies();
      },
      error: (err) => {
        this.scrapingEmails.set(false);
        this.toast.error(err.error?.message ?? 'Failed to scrape emails');
      },
    });
  }

  importCompanies() {
    const names = this.importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    this.importing.set(true);
    this.api.bulkCreateTargetCompanies(names.map((companyName) => ({ companyName }))).subscribe({
      next: (res) => {
        this.importing.set(false);
        this.importText = '';
        this.toast.success(`Added ${res.created} compan${res.created === 1 ? 'y' : 'ies'} (guessed email addresses — edit any that look wrong).`);
        this.refreshCompanies();
      },
      error: (err) => {
        this.importing.set(false);
        this.toast.error(err.error?.message ?? 'Failed to import companies');
      },
    });
  }

  startEditCompanyEmail(c: TargetCompany) {
    this.editingCompanyId = c.id;
    this.editCompanyEmail = c.email;
  }

  cancelEditCompanyEmail() {
    this.editingCompanyId = null;
  }

  saveEditCompanyEmail(id: string) {
    if (!this.editCompanyEmail.trim()) return;
    this.api.updateTargetCompany(id, { email: this.editCompanyEmail.trim() }).subscribe({
      next: (updated) => {
        this.editingCompanyId = null;
        this.targetCompanies.update((rows) => rows.map((r) => (r.id === id ? updated : r)));
        this.toast.success('Email updated.');
      },
      error: (err) => this.toast.error(err.error?.message ?? 'Failed to update'),
    });
  }

  removeCompany(c: TargetCompany) {
    this.api.deleteTargetCompany(c.id).subscribe({
      next: () => {
        this.targetCompanies.update((rows) => rows.filter((r) => r.id !== c.id));
        this.toast.info(`Removed ${c.companyName}.`);
      },
      error: (err) => this.toast.error(err.error?.message ?? 'Failed to remove'),
    });
  }

  async draftAndSendAll() {
    const remaining = this.pendingCompanyCount;
    if (remaining === 0) return;
    const confirmed = await this.confirmService.ask(
      `Draft AND immediately send outreach emails for all ${remaining} pending compan${remaining === 1 ? 'y' : 'ies'}? ` +
        `Each is scraped for a real HR email first, but there is no review step — emails go out ` +
        `right after drafting. Gmail personal accounts cap around 500 sends/day, so a large batch ` +
        `may partially fail with a quota error (retriable tomorrow via "Retry all failed"). This ` +
        `can take a while for a large list — keep this tab open.`,
      { title: 'Draft & send all', confirmLabel: `Draft & send ${remaining}`, danger: true },
    );
    if (!confirmed) return;

    this.drafting.set(true);
    this.api.draftAndSendAllCompanies().subscribe({
      next: (res) => {
        this.drafting.set(false);
        this.toast[res.failed === 0 ? 'success' : 'info'](
          `Drafted ${res.drafted}, sent ${res.sent}, failed ${res.failed}.`,
        );
        this.refreshCompanies();
        this.refreshEmails();
        this.refreshLogs();
      },
      error: (err) => {
        this.drafting.set(false);
        this.toast.error(err.error?.message ?? 'Failed to draft and send outreach');
      },
    });
  }

  refreshLogs() {
    this.api.listOutreachLogs().subscribe({
      next: (rows) => {
        this.logs.set(rows);
        this.loadingLogs.set(false);
      },
      error: () => this.loadingLogs.set(false),
    });
  }

  refreshEmails() {
    // Show DRAFT and FAILED together (both are "not successfully sent") — SENT stays out of the
    // working queue and only shows in Send history below.
    this.api.listOutreachEmails().subscribe({
      next: (rows) => {
        this.emails.set(rows.filter((r) => r.status !== 'SENT'));
        this.loadingEmails.set(false);
      },
      error: () => this.loadingEmails.set(false),
    });
  }

  refreshConnections() {
    this.api.listConnectionMessages('DRAFT').subscribe({
      next: (rows) => {
        this.connectionMessages.set(rows);
        this.loadingConnections.set(false);
      },
      error: () => this.loadingConnections.set(false),
    });
  }

  toggleEmail(id: string) {
    if (this.selectedEmailIds.has(id)) this.selectedEmailIds.delete(id);
    else this.selectedEmailIds.add(id);
  }

  toggleAllEmails(checked: boolean) {
    const selectable = this.filteredEmails().filter((e) => e.status === 'DRAFT' || e.status === 'FAILED');
    this.selectedEmailIds = checked ? new Set(selectable.map((e) => e.id)) : new Set();
  }

  allEmailsSelected(): boolean {
    const selectable = this.filteredEmails().filter((e) => e.status === 'DRAFT' || e.status === 'FAILED');
    return selectable.length > 0 && selectable.every((e) => this.selectedEmailIds.has(e.id));
  }

  isVerifiedSource(source: EmailSource): boolean {
    return source === 'scraped' || source === 'manual';
  }

  get verifiedEmailCount(): number {
    return this.emails().filter((e) => this.isVerifiedSource(e.emailSource)).length;
  }

  get guessedEmailCount(): number {
    return this.emails().filter((e) => !this.isVerifiedSource(e.emailSource)).length;
  }

  setEmailFilter(filter: 'all' | 'verified' | 'guessed') {
    this.emailFilter.set(filter);
    this.selectedEmailIds = new Set();
  }

  toggleExpandEmail(id: string) {
    this.expandedEmailId = this.expandedEmailId === id ? null : id;
    if (this.editingEmailId !== id) this.editingEmailId = null;
  }

  startEditEmail(e: OutreachEmail) {
    this.expandedEmailId = e.id;
    this.editingEmailId = e.id;
    this.editSubject = e.subject;
    this.editBody = e.body;
  }

  cancelEditEmail() {
    this.editingEmailId = null;
  }

  saveEditEmail(id: string) {
    if (!this.editSubject.trim() || !this.editBody.trim()) {
      this.toast.error('Subject and body can\'t be empty');
      return;
    }
    this.savingEdit.set(true);
    this.api
      .updateOutreachEmail(id, {
        subject: this.editSubject,
        body: this.editBody,
      })
      .subscribe({
      next: (updated) => {
        this.savingEdit.set(false);
        this.editingEmailId = null;
        this.emails.update((rows) => rows.map((r) => (r.id === id ? updated : r)));
        this.toast.success('Draft updated.');
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.toast.error(err.error?.message ?? 'Failed to update draft');
      },
    });
  }

  async sendSelectedEmails() {
    const ids = [...this.selectedEmailIds];
    if (ids.length === 0) return;
    const confirmed = await this.confirmService.ask(
      `Send ${ids.length} email${ids.length === 1 ? '' : 's'}? These go to best-guess addresses — some may bounce.`,
      { title: 'Send outreach emails', confirmLabel: `Send ${ids.length}` },
    );
    if (!confirmed) return;
    this.sendEmailIds(ids);
  }

  get failedEmailCount(): number {
    return this.emails().filter((e) => e.status === 'FAILED').length;
  }

  async retryAllFailed() {
    const ids = this.emails()
      .filter((e) => e.status === 'FAILED')
      .map((e) => e.id);
    if (ids.length === 0) return;
    const confirmed = await this.confirmService.ask(
      `Retry sending ${ids.length} failed email${ids.length === 1 ? '' : 's'}?`,
      { title: 'Retry failed emails', confirmLabel: `Retry ${ids.length}` },
    );
    if (!confirmed) return;
    this.sendEmailIds(ids);
  }

  private sendEmailIds(ids: string[]) {
    this.sendingEmails.set(true);
    this.api.sendOutreachEmails(ids).subscribe({
      next: (res) => {
        this.sendingEmails.set(false);
        this.selectedEmailIds = new Set();
        this.toast[res.failed === 0 ? 'success' : 'info'](`Sent ${res.sent}, failed ${res.failed}.`);
        this.refreshEmails();
        this.refreshLogs();
      },
      error: (err) => {
        this.sendingEmails.set(false);
        this.toast.error(err.error?.message ?? 'Failed to send emails');
      },
    });
  }

  toggleComposeEmail() {
    this.composingEmail.set(!this.composingEmail());
  }

  createNewDraft() {
    if (!this.newEmailCompany.trim() || !this.newEmailTo.trim() || !this.newEmailSubject.trim() || !this.newEmailBody.trim()) {
      this.toast.error('Company, To, subject, and body are all required.');
      return;
    }
    this.creatingEmail.set(true);
    this.api
      .createOutreachEmail({
        company: this.newEmailCompany.trim(),
        toEmail: this.newEmailTo.trim(),
        ccEmails: this.newEmailCc.trim() || undefined,
        subject: this.newEmailSubject.trim(),
        body: this.newEmailBody,
        attachResume: this.newEmailAttachResume,
      })
      .subscribe({
        next: (created) => {
          this.creatingEmail.set(false);
          this.emails.update((rows) => [created, ...rows]);
          this.toast.success('Draft created — review it below before sending.');
          this.newEmailCompany = '';
          this.newEmailTo = '';
          this.newEmailCc = '';
          this.newEmailSubject = '';
          this.newEmailBody = '';
          this.newEmailAttachResume = true;
          this.composingEmail.set(false);
        },
        error: (err) => {
          this.creatingEmail.set(false);
          this.toast.error(err.error?.message ?? 'Failed to create draft');
        },
      });
  }

  async deleteAllEmails() {
    if (this.emails().length === 0) return;
    const confirmed = await this.confirmService.ask(
      `Delete all ${this.emails().length} email draft${this.emails().length === 1 ? '' : 's'}? This can't be undone.`,
      { title: 'Delete all drafts', confirmLabel: 'Delete all', danger: true },
    );
    if (!confirmed) return;

    this.deletingEmails.set(true);
    this.api.deleteAllOutreachEmails().subscribe({
      next: (res) => {
        this.deletingEmails.set(false);
        this.selectedEmailIds = new Set();
        this.toast.info(`Deleted ${res.deleted} draft${res.deleted === 1 ? '' : 's'}.`);
        this.refreshEmails();
        this.refreshCompanies();
      },
      error: (err) => {
        this.deletingEmails.set(false);
        this.toast.error(err.error?.message ?? 'Failed to delete drafts');
      },
    });
  }

  toggleConnection(id: string) {
    if (this.selectedConnectionIds.has(id)) this.selectedConnectionIds.delete(id);
    else this.selectedConnectionIds.add(id);
  }

  toggleAllConnections(checked: boolean) {
    this.selectedConnectionIds = checked ? new Set(this.connectionMessages().map((c) => c.id)) : new Set();
  }

  allConnectionsSelected(): boolean {
    return this.connectionMessages().length > 0 && this.selectedConnectionIds.size === this.connectionMessages().length;
  }

  toggleExpandConnection(id: string) {
    this.expandedConnectionId = this.expandedConnectionId === id ? null : id;
    if (this.editingConnectionId !== id) this.editingConnectionId = null;
  }

  startEditConnection(c: ConnectionMessage) {
    this.expandedConnectionId = c.id;
    this.editingConnectionId = c.id;
    this.editMessage = c.message;
  }

  cancelEditConnection() {
    this.editingConnectionId = null;
  }

  saveEditConnection(id: string) {
    if (!this.editMessage.trim()) {
      this.toast.error('Message can\'t be empty');
      return;
    }
    this.savingEdit.set(true);
    this.api.updateConnectionMessage(id, this.editMessage).subscribe({
      next: (updated) => {
        this.savingEdit.set(false);
        this.editingConnectionId = null;
        this.connectionMessages.update((rows) => rows.map((r) => (r.id === id ? updated : r)));
        this.toast.success('Draft updated.');
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.toast.error(err.error?.message ?? 'Failed to update draft');
      },
    });
  }

  async sendSelectedConnections() {
    const ids = [...this.selectedConnectionIds];
    if (ids.length === 0) return;
    const confirmed = await this.confirmService.ask(
      `Send ${ids.length} LinkedIn message${ids.length === 1 ? '' : 's'} to your real connections?`,
      { title: 'Send connection messages', confirmLabel: `Send ${ids.length}` },
    );
    if (!confirmed) return;

    this.sendingConnections.set(true);
    this.api.sendConnectionMessages(ids).subscribe({
      next: (res) => {
        this.sendingConnections.set(false);
        this.selectedConnectionIds = new Set();
        this.toast[res.failed === 0 ? 'success' : 'info'](`Sent ${res.sent}, failed ${res.failed}.`);
        this.refreshConnections();
        this.refreshLogs();
      },
      error: (err) => {
        this.sendingConnections.set(false);
        this.toast.error(err.error?.message ?? 'Failed to send messages');
      },
    });
  }

  badgeClass(status: string) {
    return `badge badge-${status.toLowerCase()}`;
  }

  async deleteAllCompanies() {
    if (this.targetCompanies().length === 0) return;
    const confirmed = await this.confirmService.ask(
      `Delete all ${this.targetCompanies().length} companies from your target list? This can't be undone. ` +
        `(Already-sent outreach emails are kept — only the target-company list entries are removed.)`,
      { title: 'Delete all companies', confirmLabel: 'Delete all', danger: true },
    );
    if (!confirmed) return;

    this.deletingCompanies.set(true);
    this.api.deleteAllTargetCompanies().subscribe({
      next: (res) => {
        this.deletingCompanies.set(false);
        this.toast.info(`Deleted ${res.deleted} compan${res.deleted === 1 ? 'y' : 'ies'}.`);
        this.refreshCompanies();
      },
      error: (err) => {
        this.deletingCompanies.set(false);
        this.toast.error(err.error?.message ?? 'Failed to delete companies');
      },
    });
  }
}
