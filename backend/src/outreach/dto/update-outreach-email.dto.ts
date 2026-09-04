import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOutreachEmailDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  toEmail?: string;

  // Comma-separated CC addresses — pass an empty string to clear all of them.
  @IsOptional()
  @IsString()
  ccEmails?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;
}
