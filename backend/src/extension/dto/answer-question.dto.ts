import { IsString, MinLength } from 'class-validator';

export class AnswerQuestionDto {
  @IsString()
  @MinLength(1)
  question: string;
}
