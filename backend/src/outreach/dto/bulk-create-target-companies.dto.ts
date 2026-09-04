import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateTargetCompanyDto } from './create-target-company.dto';

export class BulkCreateTargetCompaniesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTargetCompanyDto)
  companies: CreateTargetCompanyDto[];
}
