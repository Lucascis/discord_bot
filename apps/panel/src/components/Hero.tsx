'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import clsx from 'clsx';

const words = ['Hi-Res Audio', 'No Lag', 'Smart Autoplay'];

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-brand-300/20 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.42),_rgba(3,0,20,0.95)_45%),linear-gradient(130deg,rgba(3,0,20,1)_10%,rgba(0,0,0,1)_80%)] p-8 shadow-neon lg:p-12">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:34px_34px]" />
      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.15fr,0.85fr] lg:items-center">
        <div className="space-y-6">
          <p className="uppercase tracking-[0.42em] text-xs text-brand-100/80">Aggressive Audio System</p>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl font-display">
            Hit Play. Hold Control.
            <span className="mt-2 block text-brand-200">No UI lag. No dead buttons. No dead air.</span>
          </h1>
          <p className="max-w-2xl text-base text-white/80 lg:text-lg">
            Diseñado para comunidades que no toleran cortes: reproducción estable, controles en tiempo real y panel operativo para producción.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot"
              className="rounded-full bg-brand-500 px-7 py-3 text-base font-semibold text-white shadow-neon-brand transition hover:bg-brand-400"
            >
              Add to Discord
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-white/20 bg-black/40 px-7 py-3 text-base font-semibold text-white/90 transition hover:bg-white/10"
            >
              Open Dashboard
            </Link>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-white/70">
            {words.map((word) => (
              <span key={word} className="rounded-full border border-white/15 bg-black/35 px-4 py-2">
                {word}
              </span>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className={clsx('rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-xl', 'gradient-border')}
        >
          <p className="text-xs uppercase tracking-[0.35em] text-white/45">Runtime Snapshot</p>
          <div className="mt-4 space-y-3 text-sm text-white/85">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span>Voice transport</span>
              <span className="text-emerald-300">stable</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span>NowPlaying sync</span>
              <span className="text-brand-200">instant</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span>Panel summon</span>
              <span className="text-cyan-300">paid plans</span>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-brand-300/30 bg-brand-400/10 px-4 py-3 text-sm text-brand-100">
            V1 focus: estabilidad audible y UX sin latencia perceptible.
          </div>
        </motion.div>
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-50" aria-hidden>
        <div className="absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-brand-500 blur-[160px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-400 blur-[180px]" />
      </div>
    </section>
  );
}
