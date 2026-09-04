import { IsString, MinLength } from 'class-validator';

export class UpdateConnectionMessageDto {
  @IsString()
  @MinLength(1)
  message: string;
}
