'use client';

import { Sidebar } from './Sidebar';
import type { GuildOverview } from '@/lib/guild-client';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { SourceQualityCapability } from '@/lib/capabilities-client';

interface Props {
  guilds: GuildOverview[];
  qualityMatrix: SourceQualityCapability[];
  noSidebar?: boolean;
}

const PERSONAL_CAPABILITIES = [
  'Controles completos de reproduccion desde panel',
  'Autoplay, filtros y cola avanzada',
  'Playlists colaborativas',
  'Monitoreo operativo integrado',
  'Acceso total para uso privado',
];

export function CapabilitiesContent({ guilds, qualityMatrix, noSidebar }: Props) {
  const router = useRouter();

  return (
    <div className={noSidebar ? '' : 'flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-140px)]'}>
      {!noSidebar && (
        <Sidebar guilds={guilds} onSelect={(guild) => router.push(`/dashboard?guild=${guild.id}`)} />
      )}

      <main className="flex-1 min-w-0 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-display text-white">Personal Capabilities</h1>
            <p className="text-white/50 text-sm mt-1">Modo personal activo, sin comercializacion.</p>
          </div>
        </div>

        <section className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white">Estado del modo personal</h3>
          <p className="text-xs text-white/60 mt-1">
            Se removieron los flujos comerciales y de monetizacion. Todas las capacidades avanzadas quedan habilitadas para uso privado.
          </p>
          <ul className="mt-4 grid gap-3 text-sm text-white/80 md:grid-cols-2">
            {PERSONAL_CAPABILITIES.map((capability) => (
              <li key={capability} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                {capability}
              </li>
            ))}
          </ul>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white">Calidad efectiva por fuente</h3>
          <p className="text-xs text-white/60 mt-1">
            Transparencia de producto: YouTube/Spotify no ofrecen lossless real en este flujo. El modo lossless aplica solo a fuentes elegibles.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/50 border-b border-white/10">
                  <th className="py-2 pr-4">Fuente</th>
                  <th className="py-2 pr-4">Máxima calidad efectiva</th>
                  <th className="py-2 pr-4">Lossless elegible</th>
                  <th className="py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {qualityMatrix.map((row) => (
                  <tr key={row.source} className="border-b border-white/5 text-white/75 align-top">
                    <td className="py-2 pr-4 uppercase">{row.source}</td>
                    <td className="py-2 pr-4 capitalize">{row.maxEffectiveQuality}</td>
                    <td className="py-2 pr-4">{row.losslessEligible ? 'Si' : 'No'}</td>
                    <td className="py-2 text-xs text-white/60">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
