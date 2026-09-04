import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Profile, ResumeSuggestions } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent implements OnInit {
  profile: Partial<Profile> = {};
  saving = signal(false);
  saved = signal(false);
  uploading = signal(false);
  uploadError = signal<string | null>(null);
  selectedFile: File | null = null;

  suggestions = signal<ResumeSuggestions | null>(null);
  suggestionsApplied = signal(false);

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit() {
    this.api.getProfile().subscribe((p) => (this.profile = p));
  }

  save() {
    this.saving.set(true);
    this.saved.set(false);
    const {
      fullName,
      phone,
      address,
      skills,
      targetRoles,
      experienceYears,
      relevantExperienceYears,
      education,
      currentCompany,
      currentJobTitle,
      currentLocation,
      preferredLocation,
      linkedinUrl,
      noticePeriodDays,
      currentSalary,
      expectedSalary,
      workAuthorization,
      willingToRelocate,
    } = this.profile;
    this.api
      .updateProfile({
        fullName,
        phone,
        address,
        skills,
        targetRoles,
        experienceYears,
        relevantExperienceYears,
        education,
        currentCompany,
        currentJobTitle,
        currentLocation,
        preferredLocation,
        linkedinUrl,
        noticePeriodDays,
        currentSalary,
        expectedSalary,
        workAuthorization,
        willingToRelocate,
      })
      .subscribe({
        next: (p) => {
          this.profile = p;
          this.saving.set(false);
          this.saved.set(true);
          this.toast.success('Profile saved.');
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(err.error?.message ?? 'Failed to save profile');
        },
      });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  uploadResume() {
    if (!this.selectedFile) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    this.suggestions.set(null);
    this.suggestionsApplied.set(false);

    this.api.uploadResume(this.selectedFile).subscribe({
      next: ({ profile, suggestions }) => {
        this.profile = profile;
        this.uploading.set(false);
        this.selectedFile = null;
        this.suggestions.set(this.hasAnySuggestion(suggestions) ? suggestions : null);
        this.toast.success('Resume uploaded.');
      },
      error: (err) => {
        const message = err.error?.message ?? 'Upload failed';
        this.uploadError.set(message);
        this.uploading.set(false);
        this.toast.error(message);
      },
    });
  }

  private hasAnySuggestion(s: ResumeSuggestions | null): boolean {
    if (!s) return false;
    return Object.values(s).some((v) => v !== undefined && v !== null && v !== '');
  }

  applySuggestions() {
    const s = this.suggestions();
    if (!s) return;
    this.profile = {
      ...this.profile,
      fullName: s.fullName ?? this.profile.fullName,
      phone: s.phone ?? this.profile.phone,
      skills: s.skills ?? this.profile.skills,
      education: s.education ?? this.profile.education,
      experienceYears: s.experienceYears ?? this.profile.experienceYears,
    };
    this.suggestionsApplied.set(true);
  }

  dismissSuggestions() {
    this.suggestions.set(null);
  }
}
