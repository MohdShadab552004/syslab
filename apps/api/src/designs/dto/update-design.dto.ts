import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { DesignDoc, UpdateDesignInput } from '@syslab/types';

export class UpdateDesignDto implements UpdateDesignInput {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Validated structurally in DesignsService.assertValidDoc */
  @IsOptional()
  @IsObject()
  doc?: DesignDoc;

  @IsInt()
  @Min(1)
  revision: number;
}
