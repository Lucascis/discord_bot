export type EffectiveAudioQuality = 'standard' | 'high' | 'lossless';

export interface SourceQualityCapability {
  source: string;
  maxEffectiveQuality: EffectiveAudioQuality;
  losslessEligible: boolean;
  requiresPremiumCatalog: boolean;
  notes: string;
}

const AUDIO_SOURCE_QUALITY_MATRIX: SourceQualityCapability[] = [
  {
    source: 'youtube',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: false,
    notes: 'YouTube entrega audio comprimido; no hay lossless real extremo a extremo.'
  },
  {
    source: 'youtube_music',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: false,
    notes: 'YouTube Music via extractor/plugin: calidad comprimida, no lossless real.'
  },
  {
    source: 'spotify',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: true,
    notes: 'En este stack Spotify se usa para resolución de catálogo, no stream lossless nativo.'
  },
  {
    source: 'soundcloud',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: false,
    notes: 'SoundCloud depende del asset publicado; normalmente comprimido.'
  },
  {
    source: 'bandcamp',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: false,
    notes: 'Bandcamp suele entregar formatos comprimidos en streaming.'
  },
  {
    source: 'vimeo',
    maxEffectiveQuality: 'high',
    losslessEligible: false,
    requiresPremiumCatalog: false,
    notes: 'Vimeo no se considera fuente lossless en reproducción estándar del bot.'
  },
  {
    source: 'http',
    maxEffectiveQuality: 'lossless',
    losslessEligible: true,
    requiresPremiumCatalog: false,
    notes: 'Lossless real solo si la URL origen es FLAC/ALAC/PCM y la cadena se mantiene sin degradación.'
  },
  {
    source: 'local',
    maxEffectiveQuality: 'lossless',
    losslessEligible: true,
    requiresPremiumCatalog: false,
    notes: 'Requiere habilitar fuente local y archivos lossless válidos.'
  }
];

export function getAudioSourceQualityMatrix(): SourceQualityCapability[] {
  return AUDIO_SOURCE_QUALITY_MATRIX;
}

