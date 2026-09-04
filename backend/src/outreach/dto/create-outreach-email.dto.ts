import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOutreachEmailDto {
  @IsString()
  @MinLength(1)
  company: string;

  @IsString()
  @MinLength(1)
  toEmail: string;

  // Comma-separated CC addresses.
  @IsOptional()
  @IsString()
  ccEmails?: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsOptional()
  @IsBoolean()
  attachResume?: boolean;
}
