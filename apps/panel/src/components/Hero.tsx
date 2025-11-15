'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import clsx from 'clsx';

const words = ['Lavalink regional', 'Panel Studio Mode', 'Pagos LATAM'];

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-brand-600/40 via-[#090114] to-black p-10 shadow-neon">
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex-1 space-y-6">
          <p className="uppercase tracking-[0.4em] text-xs text-white/60">Control Centralizado</p>
          <h1 className="text-4xl font-bold sm:text-5xl lg:text-6xl">
            La consola premium para tu <span className="text-brand-300">Music Bot</span>
          </h1>
          <p className="text-lg text-white/80 lg:text-xl">
            Gestioná planes, guilds y campañas en segundos. Sin YAML, sin redeploys: todo vive en la base de datos.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/signup"
              className="rounded-full bg-brand-500 px-8 py-3 text-lg font-semibold text-white shadow-neon transition hover:bg-brand-400"
            >
              Probar gratis
            </Link>
            <Link
              href="#plans"
              className="rounded-full border border-white/20 px-8 py-3 text-lg font-semibold text-white/90 backdrop-blur hover:bg-white/10"
            >
              Ver planes
            </Link>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-white/70">
            {words.map((word) => (
              <span key={word} className="rounded-full border border-white/10 px-4 py-2">
                {word}
              </span>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className={clsx('flex-1 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur', 'gradient-border')}
        >
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Snapshot en vivo</p>
          <h3 className="mt-4 text-2xl font-semibold">Studio Mode Preview</h3>
          <p className="mt-2 text-white/70">
            Configurá colores, mensajes y badges que verán tus servidores premium. Todo desde el navegador.
          </p>
          <div className="mt-6 grid gap-3 text-sm text-white/80">
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <span>Guilds premium</span>
              <span className="text-brand-200">42</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <span>Planes activos</span>
              <span className="text-emerald-300">Free / Basic / Premium / Enterprise</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <span>Tiempo real</span>
              <span className="text-sky-300">UI actualizada cada 5s</span>
            </div>
          </div>
        </motion.div>
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-50" aria-hidden>
        <div className="absolute -left-10 top-1/3 h-72 w-72 rounded-full bg-brand-500 blur-[160px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-400 blur-[180px]" />
      </div>
    </section>
  );
}
