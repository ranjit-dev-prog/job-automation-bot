import { IsString, MinLength } from 'class-validator';

export class ScoreRelevanceDto {
  @IsString()
  @MinLength(1)
  jobTitle: string;

  @IsString()
  jobDescription: string;
}
