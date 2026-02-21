export type SourceQualityCapability = {
  source: string;
  maxEffectiveQuality: 'standard' | 'high' | 'lossless';
  losslessEligible: boolean;
  requiresExternalCatalog: boolean;
  notes: string;
};

export async function getAudioQualityMatrix(): Promise<SourceQualityCapability[]> {
  return [
    {
      source: 'youtube',
      maxEffectiveQuality: 'high',
      losslessEligible: false,
      requiresExternalCatalog: false,
      notes: 'Calidad limitada por el origen y la codificacion de la fuente.',
    },
    {
      source: 'spotify',
      maxEffectiveQuality: 'high',
      losslessEligible: false,
      requiresExternalCatalog: false,
      notes: 'Se usa como fuente de resolucion/catalogo, no como stream lossless nativo.',
    },
    {
      source: 'soundcloud',
      maxEffectiveQuality: 'high',
      losslessEligible: false,
      requiresExternalCatalog: false,
      notes: 'Depende del upload original y de la calidad provista por la plataforma.',
    },
    {
      source: 'http',
      maxEffectiveQuality: 'lossless',
      losslessEligible: true,
      requiresExternalCatalog: false,
      notes: 'Puede alcanzar lossless cuando la URL de origen entrega FLAC/WAV sin transcodificacion.',
    },
  ];
}
