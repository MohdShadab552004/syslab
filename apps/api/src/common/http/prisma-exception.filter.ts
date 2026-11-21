import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

/** Maps known Prisma errors to HTTP responses instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [number, string]> = {
      P2025: [HttpStatus.NOT_FOUND, 'Not found'],
      P2002: [HttpStatus.CONFLICT, 'Already exists'],
      P2003: [HttpStatus.BAD_REQUEST, 'Invalid reference'],
    };
    const [statusCode, message] = map[err.code] ?? [HttpStatus.INTERNAL_SERVER_ERROR, 'Database error'];
    res.status(statusCode).json({ statusCode, message, error: err.code });
  }
}
