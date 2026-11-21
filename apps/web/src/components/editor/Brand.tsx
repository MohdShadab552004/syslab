import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/designs" className="brand">
      <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M60 10 L104 35 L60 60 L16 35 Z" fill="#d3e3f6" stroke="#232a33" strokeWidth="7" strokeLinejoin="round" />
        <path d="M16 35 L60 60 L60 110 L16 85 Z" fill="#a9c8ec" stroke="#232a33" strokeWidth="7" strokeLinejoin="round" />
        <path d="M60 60 L104 35 L104 85 L60 110 Z" fill="#8db3e2" stroke="#232a33" strokeWidth="7" strokeLinejoin="round" />
      </svg>
      <span>SysLab</span>
    </Link>
  );
}
