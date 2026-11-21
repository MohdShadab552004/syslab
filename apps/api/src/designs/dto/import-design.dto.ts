import { IsObject } from 'class-validator';

/** Body of POST /designs/import: { spec: <SysLab design spec> }. The spec itself is validated by @syslab/spec. */
export class ImportDesignDto {
  @IsObject()
  spec: Record<string, unknown>;
}
