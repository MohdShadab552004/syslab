/** Central React Query keys so invalidation never drifts between hooks. */
export const qk = {
  designs: ['designs'] as const,
  design: (id: string) => ['designs', id] as const,
  versions: (designId: string) => ['designs', designId, 'versions'] as const,
};
