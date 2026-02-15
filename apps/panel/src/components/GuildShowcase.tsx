import Image from 'next/image';
import type { GuildOverview } from '@/lib/guild-client';

interface Props {
  guilds: GuildOverview[];
  id?: string;
}

const fallbackGuilds = [
  { id: 'placeholder-1', name: 'Tu comunidad', icon: null },
  { id: 'placeholder-2', name: 'Eventos LATAM', icon: null },
  { id: 'placeholder-3', name: 'Gaming Zone', icon: null }
];

export function GuildShowcase({ guilds, id }: Props) {
  const entries = guilds.length > 0 ? guilds.slice(0, 3) : fallbackGuilds;

  return (
    <section id={id} className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/40">Casos reales</p>
          <h2 className="text-2xl font-semibold">Guilds que confían en NebuDJ</h2>
        </div>
        <span className="text-xs text-white/60">Sin límites de miembros ni latencia en saltos</span>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {entries.map((guild) => (
          <article key={guild.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center gap-3">
              {guild.icon ? (
                <Image
                  src={guild.icon}
                  alt={`Icono de ${guild.name}`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full border border-white/10 object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-12 w-12 rounded-full border border-white/10 bg-white/10 text-center text-lg font-semibold leading-[48px] text-white">
                  {guild.name?.charAt(0).toUpperCase() ?? '★'}
                </div>
              )}
              <div>
                <p className="text-lg font-semibold text-white">{guild.name ?? 'Servidor privado'}</p>
                <p className="text-xs text-white/50">Activo</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-white/70">
              Flujos automáticos, Studio Mode y monitoreo en tiempo real para eventos, gaming y comunidades educativas.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
