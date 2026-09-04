import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTargetCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
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
