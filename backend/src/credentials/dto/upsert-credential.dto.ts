import { IsIn, IsString, MinLength } from 'class-validator';

export const SUPPORTED_PLATFORMS = ['LINKEDIN', 'NAUKRI', 'INDEED', 'HIRIST', 'CUSTOM'] as const;
export type Platform = (typeof SUPPORTED_PLATFORMS)[number];

export class UpsertCredentialDto {
  @IsIn(SUPPORTED_PLATFORMS)
  platform: Platform;

  @IsString()
  @MinLength(1)
  username: string;

  @IsString()
  @MinLength(1)
  password: string;
}
