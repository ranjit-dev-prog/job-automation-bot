import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const STATUSES = ['APPLIED', 'SKIPPED', 'FAILED', 'MANUAL_ACTION_REQUIRED'];

export class ReportApplicationDto {
  @IsString()
  @MinLength(1)
  jobTitle: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  @MinLength(1)
  jobUrl: string;

  @IsIn(STATUSES)
  status: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  matchScore?: number;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
