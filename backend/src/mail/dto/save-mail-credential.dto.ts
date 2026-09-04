import { IsEmail, IsString, MinLength } from 'class-validator';

export class SaveMailCredentialDto {
  @IsEmail()
  gmailUser: string;

  // Google displays App Passwords with spaces ("abcd efgh ijkl mnop") — normalized (spaces
  // stripped) before storage, so accept it either way here rather than rejecting a valid paste.
  @IsString()
  @MinLength(8)
  gmailAppPassword: string;
}
