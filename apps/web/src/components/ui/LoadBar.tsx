export function LoadBar({ width, color, size = 40 }: { width: number; color: string; size?: number }) {
  return (
    <span className="bar" style={{ width: size }}>
      <i style={{ width: `${width}%`, background: color }} />
    </span>
  );
}
