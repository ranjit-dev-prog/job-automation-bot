import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  request = signal<ConfirmRequest | null>(null);
  private resolver: ((confirmed: boolean) => void) | null = null;

  /** Resolves true if the user confirmed, false if they cancelled/dismissed. */
  ask(message: string, opts?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    this.request.set({
      title: opts?.title ?? 'Are you sure?',
      message,
      confirmLabel: opts?.confirmLabel ?? 'Confirm',
      danger: opts?.danger ?? false,
    });
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  respond(confirmed: boolean) {
    this.request.set(null);
    this.resolver?.(confirmed);
    this.resolver = null;
  }
}
