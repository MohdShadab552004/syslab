import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marks a route as reachable without a user (e.g. shared design links). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
