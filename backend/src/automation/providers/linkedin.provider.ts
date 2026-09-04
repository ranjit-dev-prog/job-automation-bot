import { Injectable, Logger } from '@nestjs/common';
import { Locator, Page } from 'playwright';
import {
  ApplicantProfile,
  ApplyContext,
  JobListing,
  JobPlatformCredentials,
  JobPlatformProvider,
  JobSearchFilter,
  ManualActionRequiredError,
  SkipApplicationError,
} from '../interfaces/job-platform-provider.interface';
import { computeMatchScore } from '../job-matching.util';
import { answerScreeningQuestion, detectBlocker, ScreeningAnswer } from '../screening-answer.util';
import { AiService } from '../../ai/ai.service';

const MAX_WIZARD_STEPS = 10;

/**
 * Reference implementation of the provider interface, wired up against LinkedIn's current
 * (as of writing) login and job-search markup. This is the one provider meant to work with
 * real selectors — Naukri/Indeed/Hirist are left as skeletons.
 *
 * LinkedIn actively changes its DOM and has anti-automation defenses (CAPTCHAs, rate limits,
 * account flags). Only use this against your own account, keep delays conservative, and expect
 * to have to update selectors over time — this is not guaranteed to keep working unattended.
 */
@Injectable()
export class LinkedInProvider implements JobPlatformProvider {
  readonly platform = 'LINKEDIN';
  private readonly logger = new Logger(LinkedInProvider.name);

  constructor(private readonly ai: AiService) {}

  async login(page: Page, credentials: JobPlatformCredentials): Promise<void> {
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    // LinkedIn renders React-generated element ids (e.g. "«r0»") that change on every load and
    // duplicates the form markup (one hidden copy per breakpoint) — so target the visible field
    // by its stable `autocomplete` attribute instead of an id, using a `*=` contains match since
    // the value itself varies too (e.g. "username" vs "username webauthn").
    const usernameField = page.locator('input[autocomplete*="username"]:visible').first();
    const passwordField = page.locator('input[autocomplete*="current-password"]:visible').first();
    const signInButton = page.locator('button:visible').filter({ hasText: /^Sign in$/ }).first();

    const foundLoginForm = await usernameField
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!foundLoginForm) {
      throw new Error(
        `LinkedIn did not show the expected login form (page title: "${await page.title()}", url: ${page.url()}). ` +
          'LinkedIn may have changed its markup again, or is showing a checkpoint/consent page — try PLAYWRIGHT_HEADLESS=false to see what actually loaded.',
      );
    }

    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);
    await signInButton.click();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const stillOnLogin = page.url().includes('/login') || page.url().includes('/checkpoint');
    if (stillOnLogin) {
      throw new Error(
        'LinkedIn login did not complete — likely a wrong password, or a CAPTCHA/2FA checkpoint ' +
          'that requires manual intervention (LinkedIn shows these especially often for automated browsers).',
      );
    }
  }

  async searchJobs(page: Page, filter: JobSearchFilter): Promise<JobListing[]> {
    const params = new URLSearchParams({ keywords: filter.keywords });
    if (filter.location) params.set('location', filter.location);
    if (filter.remoteOnly) params.set('f_WT', '2');
    // LinkedIn's own "Easy Apply" search filter (f_AL=true) — restricting the search itself
    // means non-Easy-Apply postings are never queued in the first place, instead of visiting
    // each job page just to skip it in applyToJob.
    if (filter.easyApplyOnly) params.set('f_AL', 'true');

    await page.goto(`https://www.linkedin.com/jobs/search/?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
    });

    // The guest/logged-out jobs-search page and the authenticated one (what a logged-in session
    // actually gets redirected to) use entirely different markup — this provider used to target
    // the guest page's classes (.jobs-search__results-list, .base-search-card__title, …), which
    // silently matched nothing once logged in and made every search return 0 listings. Job
    // posting links are the one thing LinkedIn has kept stable across every redesign: they always
    // look like /jobs/view/<id>. Anchor on that instead of any class name.
    const jobLinkSelector = 'a[href*="/jobs/view/"]';
    await page.waitForSelector(jobLinkSelector, { timeout: 15000 }).catch(() => undefined);

    const links = page.locator(jobLinkSelector);
    const linkCount = await links.count();
    const seenUrls = new Set<string>();
    const listings: JobListing[] = [];
    for (let i = 0; i < linkCount; i++) {
      const link = links.nth(i);
      const listing = await this.extractListing(link);
      if (!listing || seenUrls.has(listing.url)) continue;
      seenUrls.add(listing.url);
      listings.push(listing);
    }
    // A per-card "Easy Apply" badge check was tried here to catch anything slipping past the
    // f_AL=true filter above, but it was based on a text match that doesn't actually appear in
    // LinkedIn's card markup — it dropped 100% of real results in a live run. The URL-level
    // filter plus applyToJob's own per-page Easy Apply button check (the actual source of truth)
    // are what's reliable; don't add a card-level re-check without verifying it against a live
    // page first.
    this.logger.debug(`Found ${listings.length} LinkedIn listings for "${filter.keywords}"`);
    return listings;
  }

  /**
   * Turns one /jobs/view/ link into a listing: the title is the link's own accessible text
   * (LinkedIn's job title link always carries it, in both card layouts LinkedIn has used), and
   * the company name is best-effort — read from the nearest list-item ancestor's text, since
   * that class name changes more often than the link itself. A listing with no title is dropped
   * rather than queued with a blank one.
   */
  private async extractListing(link: Locator): Promise<JobListing | null> {
    const href = await link.getAttribute('href').catch(() => null);
    if (!href) return null;
    const url = new URL(href, 'https://www.linkedin.com').toString().split('?')[0];

    const title = (await link.innerText().catch(() => '')).trim().split('\n')[0].trim();
    if (!title) return null;

    const card = link.locator('xpath=ancestor::li[1]');
    const cardText = await card.innerText().catch(() => '');
    // The card's full text is "Title\nCompany\n..." — the line right after the title is
    // consistently the company name across LinkedIn's card layouts.
    const lines = cardText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const titleIdx = lines.indexOf(title);
    const company = titleIdx >= 0 && lines[titleIdx + 1] ? lines[titleIdx + 1] : undefined;

    return { title, company, url };
  }

  async applyToJob(page: Page, job: JobListing, context: ApplyContext): Promise<void> {
    await page.goto(job.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Score relevance against the user's profile BEFORE ever clicking anything — a job is never
    // applied to just because Easy Apply exists; it has to clear the user's minimum match first.
    // Skipped entirely when the filter has directApply on: no description fetch, no keyword/AI
    // call, matchScore stays unset on the resulting Application.
    let matchScore: number | undefined;
    if (!context.skipRelevanceCheck) {
      const description = await page
        .locator('.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text')
        .first()
        .innerText()
        .catch(() => '');
      const { score, source: scoreSource } = await this.scoreRelevance(context.profile, job.title, description);
      matchScore = score;
      if (score < context.minMatchScore) {
        throw new SkipApplicationError(
          `Not relevant — scored ${score}% (${scoreSource}) against your profile's skills/target roles ` +
            `(minimum ${context.minMatchScore}%).`,
          score,
        );
      }
    }

    // Match by visible text rather than a specific CSS class — LinkedIn has redesigned its
    // markup (utility classes, generated ids) more than once, but the button's accessible
    // label ("Easy Apply") is a functional requirement they keep stable across redesigns.
    const easyApplyButton = page.locator('button:visible').filter({ hasText: /Easy Apply/i }).first();
    const hasEasyApply = await easyApplyButton
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!hasEasyApply) {
      throw new SkipApplicationError(
        'No "Easy Apply" button — this job requires applying on an external site.',
        matchScore,
      );
    }

    await easyApplyButton.click();

    // The wizard step/submit buttons are the reliable signal that the apply modal actually
    // opened — waiting on a specific modal container class is what broke previously.
    const wizardButton = page
      .locator('button:visible')
      .filter({ hasText: /^(Next|Review|Continue|Submit application)$/ })
      .first();
    const modalOpened = await wizardButton
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!modalOpened) {
      throw new Error(
        `Clicked "Easy Apply" but the application form never appeared (page title: "${await page.title()}"). ` +
          'LinkedIn may have changed its Easy Apply markup again — try PLAYWRIGHT_HEADLESS=false to see what actually opened.',
      );
    }

    // Easy Apply is a multi-step wizard. On every step: bail out immediately if the step is
    // asking for something we must never handle ourselves (CAPTCHA/OTP/payment); otherwise try
    // to answer any screening questions from the user's stored profile; then click
    // "Next"/"Review"/"Continue" until "Submit application" appears. If a required field is
    // left unanswered because the profile doesn't confirm a value, stop rather than guess.
    for (let step = 0; step < MAX_WIZARD_STEPS; step++) {
      const submitted = await this.runWizardStep(page, context.profile, matchScore);
      if (submitted) return;
    }
    throw new SkipApplicationError(
      'Could not complete the Easy Apply flow within the expected number of steps.',
      matchScore,
    );
  }

  /**
   * Handles one Easy Apply wizard step: bail out on a CAPTCHA/OTP/payment prompt, fill any
   * screening questions the profile can confidently answer, then either submit, advance to the
   * next step, or stop (missing info vs. an unhandled required field). Returns true once
   * "Submit application" has been clicked.
   */
  private async runWizardStep(
    page: Page,
    profile: ApplicantProfile,
    matchScore: number | undefined,
  ): Promise<boolean> {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const blockerReason = detectBlocker(bodyText);
    if (blockerReason) {
      throw new ManualActionRequiredError(
        `Easy Apply step appears to require ${blockerReason} — this needs you to complete it manually.`,
      );
    }

    await this.fillKnownScreeningFields(page, profile);

    const submitButton = page.locator('button:visible').filter({ hasText: /^Submit application$/ }).first();
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
      return true;
    }

    const nextButton = page
      .locator('button:visible')
      .filter({ hasText: /^(Next|Review|Continue)$/ })
      .first();
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(1000);
      return false;
    }

    const unanswered = await this.findUnansweredRequiredField(page);
    if (unanswered) {
      throw new ManualActionRequiredError(
        `Easy Apply has a required question the bot can't answer from your profile: "${unanswered}". ` +
          'Add the relevant detail to your Profile, or fill this application manually.',
      );
    }
    throw new SkipApplicationError(
      'Easy Apply form has extra required fields this bot cannot fill in automatically.',
      matchScore,
    );
  }

  /**
   * Scores job relevance via the configured AI provider (Claude/Gemini) when one is set up,
   * falling back to the deterministic keyword score — on missing config, an API error, or a
   * malformed response — so a relevance judgement is always available either way.
   */
  private async scoreRelevance(
    profile: ApplicantProfile,
    jobTitle: string,
    jobDescription: string,
  ): Promise<{ score: number; source: 'ai' | 'keyword' }> {
    const keywordScore = computeMatchScore(profile, jobTitle, jobDescription);
    if (!this.ai.isEnabled()) return { score: keywordScore, source: 'keyword' };

    const aiResult = await this.ai.scoreRelevance(profile, jobTitle, jobDescription).catch(() => null);
    if (!aiResult) return { score: keywordScore, source: 'keyword' };
    return { score: aiResult.score, source: 'ai' };
  }

  /**
   * Resolves one screening question to an answer: the configured AI provider first (Gemini can
   * parse a wider variety of question phrasings than the regex rules), falling back to the
   * deterministic rules in screening-answer.util when AI is disabled, errors, or hits its own
   * rate limit. Either source returning null/unconfirmed means "the profile doesn't support an
   * answer" — never guessed, never defaulted.
   */
  private async resolveAnswer(profile: ApplicantProfile, label: string): Promise<ScreeningAnswer | null> {
    if (this.ai.isEnabled()) {
      const aiAnswer = await this.ai.answerQuestion(profile, label).catch(() => null);
      if (aiAnswer) {
        const kind = /^(yes|no)$/i.test(aiAnswer.value) ? 'boolean' : 'text';
        return { kind, value: aiAnswer.value };
      }
    }
    return answerScreeningQuestion(profile, label);
  }

  /** Reads the accessible label for a form control: aria-label first, then an associated <label for>. */
  private async labelFor(page: Page, locator: Locator): Promise<string> {
    const ariaLabel = await locator.getAttribute('aria-label').catch(() => null);
    if (ariaLabel) return ariaLabel.trim();

    const id = await locator.getAttribute('id').catch(() => null);
    if (id) {
      const label = page.locator(`label[for="${id}"]`).first();
      const text = await label.innerText().catch(() => '');
      if (text) return text.trim();
    }
    return '';
  }

  /**
   * Fills text/number/textarea inputs, <select> dropdowns, and Yes/No radio groups on the
   * current step using resolveAnswer (deterministic rules, then AI fallback) — only when it
   * returns a confirmed answer. Fields it can't confidently answer are left untouched;
   * findUnansweredRequiredField below is what turns "still empty after this" into a stop-and-ask.
   */
  private async fillKnownScreeningFields(page: Page, profile: ApplicantProfile): Promise<void> {
    const textInputs = page.locator('input[type="text"]:visible, input[type="number"]:visible, textarea:visible');
    const textCount = await textInputs.count().catch(() => 0);
    for (let i = 0; i < textCount; i++) {
      const input = textInputs.nth(i);
      const existing = await input.inputValue().catch(() => '');
      if (existing) continue;
      const label = await this.labelFor(page, input);
      if (!label) continue;
      const answer = await this.resolveAnswer(profile, label);
      if (answer) await input.fill(answer.value).catch(() => undefined);
    }

    const selects = page.locator('select:visible');
    const selectCount = await selects.count().catch(() => 0);
    for (let i = 0; i < selectCount; i++) {
      const select = selects.nth(i);
      const label = await this.labelFor(page, select);
      if (!label) continue;
      const answer = await this.resolveAnswer(profile, label);
      if (answer) await select.selectOption({ label: answer.value }).catch(() => undefined);
    }

    const fieldsets = page.locator('fieldset:visible');
    const fieldsetCount = await fieldsets.count().catch(() => 0);
    for (let i = 0; i < fieldsetCount; i++) {
      const fieldset = fieldsets.nth(i);
      const alreadyChecked = await fieldset.locator('input[type="radio"]:checked').count().catch(() => 0);
      if (alreadyChecked > 0) continue;
      const legend = await fieldset.locator('legend').first().innerText().catch(() => '');
      if (!legend) continue;
      const answer = await this.resolveAnswer(profile, legend);
      if (!answer) continue;
      const option = fieldset.locator('label:visible').filter({ hasText: new RegExp(`^${answer.value}$`, 'i') }).first();
      if (await option.isVisible().catch(() => false)) {
        await option.click().catch(() => undefined);
      }
    }
  }

  /**
   * Scans the current step for a required field that's still empty (text/select/textarea) or a
   * required radio group with nothing selected, and returns its label — or null if the step
   * looks fully answered. Used to distinguish "needs info we don't have" from "just needs Next".
   */
  private async findUnansweredRequiredField(page: Page): Promise<string | null> {
    const requiredFields = page.locator('input:visible[required], select:visible[required], textarea:visible[required]');
    const count = await requiredFields.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const field = requiredFields.nth(i);
      const type = await field.getAttribute('type').catch(() => null);
      if (type === 'radio' || type === 'checkbox') continue; // handled via the fieldset scan below
      const value = await field.inputValue().catch(() => '');
      if (!value) {
        const label = await this.labelFor(page, field);
        return label || 'an unlabeled required field';
      }
    }

    const fieldsets = page.locator('fieldset:visible');
    const fieldsetCount = await fieldsets.count().catch(() => 0);
    for (let i = 0; i < fieldsetCount; i++) {
      const fieldset = fieldsets.nth(i);
      const radioCount = await fieldset.locator('input[type="radio"]').count().catch(() => 0);
      if (radioCount === 0) continue;
      const checked = await fieldset.locator('input[type="radio"]:checked').count().catch(() => 0);
      if (checked === 0) {
        const legend = await fieldset.locator('legend').first().innerText().catch(() => '');
        return legend.trim() || 'an unanswered question';
      }
    }
    return null;
  }

  /**
   * Finds 1st-degree connections whose profile mentions the given company, via LinkedIn's
   * people-search filtered to your network. Profile links (/in/<slug>/) are the stable anchor,
   * same reasoning as the job-search fix — but unlike that fix, this hasn't been run against a
   * live logged-in session, so treat the selectors below as a first attempt, not a verified one.
   */
  async findConnectionsAtCompany(page: Page, company: string): Promise<{ name: string; profileUrl: string }[]> {
    const params = new URLSearchParams({
      keywords: company,
      network: '["F"]', // first-degree connections only
    });
    await page.goto(`https://www.linkedin.com/search/results/people/?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
    });

    const profileLinkSelector = 'a[href*="/in/"]';
    await page.waitForSelector(profileLinkSelector, { timeout: 15000 }).catch(() => undefined);

    const links = page.locator(profileLinkSelector);
    const linkCount = await links.count();
    const seen = new Set<string>();
    const results: { name: string; profileUrl: string }[] = [];

    for (let i = 0; i < linkCount && results.length < 10; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute('href').catch(() => null);
      if (!href) continue;
      const profileUrl = new URL(href, 'https://www.linkedin.com').toString().split('?')[0];
      if (seen.has(profileUrl)) continue;

      const name = (await link.innerText().catch(() => '')).trim().split('\n')[0].trim();
      if (!name) continue;

      seen.add(profileUrl);
      results.push({ name, profileUrl });
    }
    return results;
  }

  /**
   * Opens a 1st-degree connection's profile and sends them a direct message. Best-effort,
   * unverified against a live session (see findConnectionsAtCompany above) — LinkedIn's
   * messaging UI is a contenteditable box, not a plain <textarea>, which is more fragile than
   * the form fields elsewhere in this provider.
   */
  async sendMessage(page: Page, profileUrl: string, message: string): Promise<void> {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const messageButton = page.locator('button:visible').filter({ hasText: /^Message$/ }).first();
    const hasMessageButton = await messageButton
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!hasMessageButton) {
      throw new Error('No "Message" button on this profile — likely not a 1st-degree connection anymore.');
    }
    await messageButton.click();

    const composeBox = page.locator('div[role="textbox"]:visible, div.msg-form__contenteditable:visible').first();
    const composeReady = await composeBox
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!composeReady) {
      throw new Error('Message compose box never appeared — LinkedIn may have changed its messaging UI.');
    }
    await composeBox.click();
    await composeBox.fill(message);

    const sendButton = page.locator('button:visible').filter({ hasText: /^Send$/ }).first();
    const sendReady = await sendButton
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!sendReady) {
      throw new Error('No "Send" button found after composing the message.');
    }
    await sendButton.click();
  }
}
