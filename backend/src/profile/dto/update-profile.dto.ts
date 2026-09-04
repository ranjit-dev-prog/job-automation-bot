import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  skills?: string;

  // Comma-separated job titles (e.g. "Application Support Engineer, Technical Support Engineer")
  // used to weight job-relevance scoring toward the roles the user actually wants.
  @IsOptional()
  @IsString()
  targetRoles?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  experienceYears?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  relevantExperienceYears?: number;

  // JSON-encoded array of { school, degree, year } — validated as a plain string here,
  // structure is the frontend's responsibility.
  @IsOptional()
  @IsString()
  education?: string;

  @IsOptional()
  @IsString()
  currentCompany?: string;

  @IsOptional()
  @IsString()
  currentJobTitle?: string;

  @IsOptional()
  @IsString()
  currentLocation?: string;

  @IsOptional()
  @IsString()
  preferredLocation?: string;

  @IsOptional()
  @IsString()
  linkedinUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  noticePeriodDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentSalary?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedSalary?: number;

  @IsOptional()
  @IsString()
  workAuthorization?: string;

  @IsOptional()
  @IsBoolean()
  willingToRelocate?: boolean;
}
