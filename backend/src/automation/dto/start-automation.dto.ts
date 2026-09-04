import { IsString, MinLength } from 'class-validator';

export class StartAutomationDto {
  @IsString()
  @MinLength(1)
  filterId: string;
}
