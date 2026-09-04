import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTargetCompanyDto {
  @IsString()
  @MinLength(1)
  companyName: string;

  // Optional — if omitted, a best-guess address is generated the same way job-posting-triggered
  // outreach does (guessCompanyEmail). Editable afterward either way.
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  roleOfInterest?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
