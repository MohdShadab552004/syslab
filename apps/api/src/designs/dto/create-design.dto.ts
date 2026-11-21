import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateDesignInput, TemplateKey } from '@syslab/types';

const TEMPLATE_KEYS: TemplateKey[] = ['blank', 'url', 'chat', 'ecom', 'lesson'];

export class CreateDesignDto implements CreateDesignInput {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsIn(TEMPLATE_KEYS)
  template: TemplateKey;
}
