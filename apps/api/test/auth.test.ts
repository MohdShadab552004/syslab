import { describe, test, expect, vi } from 'vitest';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DevAuthGuard } from '../src/common/auth/dev-auth.guard';
import { CurrentUser } from '../src/common/auth/current-user.decorator';
import { IS_PUBLIC, Public } from '../src/common/auth/public.decorator';

function fakeCtx(req: Record<string, unknown>, handler: () => void = () => {}, cls: object = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

describe('@Public', () => {
  test('marks a handler with IS_PUBLIC = true', () => {
    class C { route() {} }
    Public()(C.prototype, 'route', Object.getOwnPropertyDescriptor(C.prototype, 'route')!);
    expect(IS_PUBLIC).toBe('isPublic');
    expect(Reflect.getMetadata(IS_PUBLIC, C.prototype.route)).toBe(true);
  });
});

describe('@CurrentUser', () => {
  test('returns request.user from the execution context', () => {
    class C { route(_user: unknown) {} }
    CurrentUser()(C.prototype, 'route', 0);
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'route') as Record<string, { factory: (d: unknown, ctx: ExecutionContext) => unknown }>;
    const [entry] = Object.values(meta);
    const user = { id: 'u1', email: 'a@b.c' };
    expect(entry.factory(undefined, fakeCtx({ user }))).toBe(user);
  });
});

describe('DevAuthGuard', () => {
  const make = (isPublic: boolean | undefined) => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(isPublic) } as unknown as Reflector;
    const users = { upsertByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'dev@x' }) };
    const config = { get: vi.fn().mockReturnValue('dev@x') };
    const guard = new DevAuthGuard(reflector, users as never, config as never);
    return { guard, reflector, users, config };
  };

  test('public routes pass without resolving a user', async () => {
    const { guard, reflector, users } = make(true);
    const handler = () => {};
    class Ctl {}
    const req: Record<string, unknown> = {};
    await expect(guard.canActivate(fakeCtx(req, handler, Ctl))).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC, [handler, Ctl]);
    expect(users.upsertByEmail).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('other routes get the dev user, resolved once and cached', async () => {
    const { guard, users, config } = make(undefined);
    const r1: Record<string, unknown> = {};
    const r2: Record<string, unknown> = {};
    await expect(guard.canActivate(fakeCtx(r1))).resolves.toBe(true);
    await expect(guard.canActivate(fakeCtx(r2))).resolves.toBe(true);
    expect(config.get).toHaveBeenCalledWith('devUserEmail', { infer: true });
    expect(users.upsertByEmail).toHaveBeenCalledTimes(1);
    expect(users.upsertByEmail).toHaveBeenCalledWith('dev@x', 'Dev User');
    expect(r1.user).toEqual({ id: 'u1', email: 'dev@x' });
    expect(r2.user).toBe(r1.user);
  });

  test('a failed user lookup is not cached: the next request tries again', async () => {
    const { guard, users } = make(undefined);
    users.upsertByEmail.mockRejectedValueOnce(new Error('db down'));
    await expect(guard.canActivate(fakeCtx({}))).rejects.toThrow('db down');
    const req: Record<string, unknown> = {};
    await expect(guard.canActivate(fakeCtx(req))).resolves.toBe(true);
    expect(users.upsertByEmail).toHaveBeenCalledTimes(2);
    expect(req.user).toEqual({ id: 'u1', email: 'dev@x' });
  });

  test('works with the real Reflector and @Public metadata', async () => {
    class Ctl { open() {} closed() {} }
    Public()(Ctl.prototype, 'open', Object.getOwnPropertyDescriptor(Ctl.prototype, 'open')!);
    const users = { upsertByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'dev@x' }) };
    const guard = new DevAuthGuard(new Reflector(), users as never, { get: () => 'dev@x' } as never);
    await guard.canActivate(fakeCtx({}, Ctl.prototype.open, Ctl));
    expect(users.upsertByEmail).not.toHaveBeenCalled();
    await guard.canActivate(fakeCtx({}, Ctl.prototype.closed, Ctl));
    expect(users.upsertByEmail).toHaveBeenCalledTimes(1);
  });
});
