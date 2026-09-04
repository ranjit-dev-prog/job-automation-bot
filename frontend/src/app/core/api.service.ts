import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  ApplicationStatus,
  AutomationStatus,
  ConnectionMessage,
  CredentialSummary,
  JobApplication,
  JobFilter,
  MailCredentialStatus,
  OutreachChannel,
  OutreachEmail,
  OutreachLog,
  OutreachStatus,
  Platform,
  Profile,
  ResumeSuggestions,
  TargetCompany,
} from './models';

export interface FilterPayload {
  name: string;
  keywords: string;
  location?: string;
  remoteOnly?: boolean;
  easyApplyOnly?: boolean;
  minMatchScore?: number;
  directApply?: boolean;
  minSalary?: number | null;
  emailOutreachEnabled?: boolean;
  connectionOutreachEnabled?: boolean;
  platforms: Platform[];
  delaySeconds?: number;
  searchIntervalMinutes?: number;
  maxApplicationsPerDay?: number;
  customRulesJson?: string;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  // Profile
  getProfile() {
    return this.http.get<Profile>(`${this.base}/profile`);
  }

  updateProfile(data: Partial<Profile>) {
    return this.http.patch<Profile>(`${this.base}/profile`, data);
  }

  uploadResume(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ profile: Profile; suggestions: ResumeSuggestions | null }>(
      `${this.base}/profile/resume`,
      formData,
    );
  }

  // Credentials
  listCredentials() {
    return this.http.get<CredentialSummary[]>(`${this.base}/credentials`);
  }

  saveCredential(platform: Platform, username: string, password: string) {
    return this.http.post<CredentialSummary>(`${this.base}/credentials`, {
      platform,
      username,
      password,
    });
  }

  removeCredential(platform: Platform) {
    return this.http.delete<{ success: boolean }>(`${this.base}/credentials/${platform}`);
  }

  // Filters
  listFilters() {
    return this.http.get<JobFilter[]>(`${this.base}/filters`);
  }

  createFilter(data: FilterPayload) {
    return this.http.post<JobFilter>(`${this.base}/filters`, data);
  }

  updateFilter(id: string, data: FilterPayload) {
    return this.http.patch<JobFilter>(`${this.base}/filters/${id}`, data);
  }

  deleteFilter(id: string) {
    return this.http.delete<{ success: boolean }>(`${this.base}/filters/${id}`);
  }

  // Applications
  listApplications(status?: ApplicationStatus) {
    const url = status ? `${this.base}/applications?status=${status}` : `${this.base}/applications`;
    return this.http.get<JobApplication[]>(url);
  }

  getApplicationStats() {
    return this.http.get<Record<string, number>>(`${this.base}/applications/stats`);
  }

  // Automation
  startAutomation(filterId: string) {
    return this.http.post<{
      started: boolean;
      platformsLoggedIn: string[];
      platformErrors: Record<string, string>;
    }>(`${this.base}/automation/start`, { filterId });
  }

  stopAutomation() {
    return this.http.post<{ stopped: boolean }>(`${this.base}/automation/stop`, {});
  }

  pauseAutomation() {
    return this.http.post<{ paused: boolean }>(`${this.base}/automation/pause`, {});
  }

  resumeAutomation() {
    return this.http.post<{ paused: boolean }>(`${this.base}/automation/resume`, {});
  }

  getAutomationStatus() {
    return this.http.get<AutomationStatus>(`${this.base}/automation/status`);
  }

  // Outreach
  listOutreachEmails(status?: OutreachStatus) {
    const url = status ? `${this.base}/outreach/emails?status=${status}` : `${this.base}/outreach/emails`;
    return this.http.get<OutreachEmail[]>(url);
  }

  updateOutreachEmail(id: string, data: { toEmail?: string; ccEmails?: string; subject?: string; body?: string }) {
    return this.http.patch<OutreachEmail>(`${this.base}/outreach/emails/${id}`, data);
  }

  createOutreachEmail(data: {
    company: string;
    toEmail: string;
    ccEmails?: string;
    subject: string;
    body: string;
    attachResume?: boolean;
  }) {
    return this.http.post<OutreachEmail>(`${this.base}/outreach/emails`, data);
  }

  sendOutreachEmails(ids: string[]) {
    return this.http.post<{ sent: number; failed: number }>(`${this.base}/outreach/emails/send`, { ids });
  }

  deleteAllOutreachEmails() {
    return this.http.delete<{ deleted: number }>(`${this.base}/outreach/emails`);
  }

  listConnectionMessages(status?: OutreachStatus) {
    const url = status
      ? `${this.base}/outreach/connection-messages?status=${status}`
      : `${this.base}/outreach/connection-messages`;
    return this.http.get<ConnectionMessage[]>(url);
  }

  updateConnectionMessage(id: string, message: string) {
    return this.http.patch<ConnectionMessage>(`${this.base}/outreach/connection-messages/${id}`, { message });
  }

  sendConnectionMessages(ids: string[]) {
    return this.http.post<{ sent: number; failed: number }>(`${this.base}/outreach/connection-messages/send`, {
      ids,
    });
  }

  listOutreachLogs(channel?: OutreachChannel) {
    const url = channel ? `${this.base}/outreach/logs?channel=${channel}` : `${this.base}/outreach/logs`;
    return this.http.get<OutreachLog[]>(url);
  }

  // Target companies
  listTargetCompanies() {
    return this.http.get<TargetCompany[]>(`${this.base}/outreach/target-companies`);
  }

  bulkCreateTargetCompanies(companies: { companyName: string; email?: string }[]) {
    return this.http.post<{ created: number }>(`${this.base}/outreach/target-companies/bulk`, { companies });
  }

  updateTargetCompany(id: string, data: { companyName?: string; email?: string; roleOfInterest?: string }) {
    return this.http.patch<TargetCompany>(`${this.base}/outreach/target-companies/${id}`, data);
  }

  deleteTargetCompany(id: string) {
    return this.http.delete<{ success: boolean }>(`${this.base}/outreach/target-companies/${id}`);
  }

  deleteAllTargetCompanies() {
    return this.http.delete<{ deleted: number }>(`${this.base}/outreach/target-companies`);
  }

  draftTargetCompanies(limit: number) {
    return this.http.post<{ drafted: number }>(`${this.base}/outreach/target-companies/draft`, { limit });
  }

  draftAndSendAllCompanies() {
    return this.http.post<{ drafted: number; sent: number; failed: number }>(
      `${this.base}/outreach/target-companies/draft-and-send`,
      {},
    );
  }

  scrapeTargetCompanyEmails(limit: number) {
    return this.http.post<{ scraped: number; notFound: number; invalidDomain: number; attempted: number }>(
      `${this.base}/outreach/target-companies/scrape-emails`,
      { limit },
    );
  }

  // Mail (Gmail) credential — per-user App Password, saved instead of editing backend/.env
  getMailCredentialStatus() {
    return this.http.get<MailCredentialStatus>(`${this.base}/mail/credentials`);
  }

  saveMailCredential(gmailUser: string, gmailAppPassword: string) {
    return this.http.post<MailCredentialStatus>(`${this.base}/mail/credentials`, { gmailUser, gmailAppPassword });
  }

  removeMailCredential() {
    return this.http.delete<{ success: boolean }>(`${this.base}/mail/credentials`);
  }
}
