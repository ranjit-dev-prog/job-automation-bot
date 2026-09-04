import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpsertFilterDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  keywords: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsBoolean()
  remoteOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  easyApplyOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minMatchScore?: number;

  // When true, minMatchScore is ignored entirely — every job with Easy Apply gets applied to
  // regardless of relevance. Higher volume, no fit guarantee.
  @IsOptional()
  @IsBoolean()
  directApply?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSalary?: number;

  // Drafts only — nothing sends without a separate approval step in the Outreach queue.
  @IsOptional()
  @IsBoolean()
  emailOutreachEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  connectionOutreachEnabled?: boolean;

  @IsArray()
  @IsString({ each: true })
  platforms: string[];

  // Floor of 1s rather than 0 — user-requested max speed. Sub-5s pacing reads as clearly
  // non-human to the platform's anti-automation defenses; this is a real account-risk trade-off,
  // not a "safe" setting.
  @IsOptional()
  @IsInt()
  @Min(1)
  delaySeconds?: number;

  // How often to re-search once the queue runs dry — matches the intervals offered in the UI.
  @IsOptional()
  @IsIn([1, 5, 10, 15, 30])
  searchIntervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxApplicationsPerDay?: number;

  @IsOptional()
  @IsString()
  customRulesJson?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
