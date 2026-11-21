import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateVersionInput } from '@syslab/types';

export class CreateVersionDto implements CreateVersionInput {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
