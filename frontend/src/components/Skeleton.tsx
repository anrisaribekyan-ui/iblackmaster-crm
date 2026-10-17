/** Заглушка на время загрузки: силуэт будущего списка вместо слова «Загрузка…» — страница не прыгает. */
export default function Skeleton({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`grid gap-2 ${className}`} role="status" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface" style={{ opacity: 1 - i * (0.6 / rows), animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  )
}
