import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { CredentialSummary, PLATFORM_LABELS, PLATFORMS, Platform } from '../core/models';

@Component({
  selector: 'app-credentials',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './credentials.component.html',
  styleUrl: './credentials.component.css',
})
export class CredentialsComponent implements OnInit {
  readonly platforms = PLATFORMS;
  readonly labels = PLATFORM_LABELS;
  credentials = signal<CredentialSummary[]>([]);

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.api.listCredentials().subscribe((rows) => this.credentials.set(rows));
  }

  isConnected(platform: Platform) {
    return this.credentials().some((c) => c.platform === platform);
  }

  routeFor(platform: Platform) {
    return ['/credentials', platform.toLowerCase()];
  }
}
