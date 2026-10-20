export function Skeleton({ height = 16, width = "100%", radius = 8 }: { height?: number; width?: string | number; radius?: number }) {
  return (
    <span
      className="skeleton"
      style={{ height, width, borderRadius: radius, display: "block" }}
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="page-enter" style={{ display: "grid", gap: 18 }}>
      <Skeleton height={28} width={220} />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="card" key={item} style={{ padding: 22 }}>
            <Skeleton height={14} width="55%" />
            <div style={{ height: 14 }} />
            <Skeleton height={34} width="40%" />
          </div>
        ))}
      </div>
      <Skeleton height={320} radius={16} />
    </div>
  );
}
