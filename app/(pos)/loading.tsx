/** Mientras llega la pantalla siguiente: un esqueleto que solo aparece si la espera se nota. */
export default function Loading() {
  return (
    <div className="skeleton-delay space-y-4 py-2" aria-busy="true" aria-label="Cargando">
      <div className="shimmer h-9 w-56 rounded-xl bg-tinto/8" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="shimmer h-32 rounded-[22px] bg-tinto/6" />
        ))}
      </div>
    </div>
  );
}
