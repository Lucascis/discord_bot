# Contribuir / Flujo de desarrollo

Este proyecto usa pnpm workspaces, Vitest y commitlint. Requiere Node 22+ y pnpm 8+. Para evitar roturas en CI y comportamientos inesperados en Discord, seguí estos pasos antes de comitear.

## Checklist previa al commit

- Tests unitarios:
  - `pnpm test` (no requiere build; Vitest aliasa paquetes del workspace a `src/`).
- Build de todos los paquetes:
  - `pnpm -r build`
- Sanidad local con Docker (opcional pero recomendado en cambios de integración):
  - `bash scripts/prod.sh` (o `make prod-reset` para limpiar y reconstruir)
  - Validar health:
    - Gateway: http://localhost:3001/health
    - Audio: http://localhost:3002/health
    - API: http://localhost:3000/health

## Pruebas manuales de UI (Now Playing)

- Reubicación del reproductor:
  1. Con un tema reproduciéndose, ejecutá `/play <consulta|url>`.
  2. Verificá que el mensaje “Now Playing” vuelva a aparecer al final del canal (relocalización).

- Desconexión del bot:
  1. Desconectá al bot del canal de voz.
  2. Ejecutá `/play ...` nuevamente.
  3. Debe crearse un nuevo “Now Playing” abajo (no debe editarse un mensaje viejo).

## Estilo de commits

- Convencional: `type(scope): subject` (máx. 100 caracteres en el header).
- Ejemplos de `type`: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## Notas de Vitest

- `vitest.config.ts` define alias para:
  - `@discord-bot/database`, `@discord-bot/logger`, `@discord-bot/config` → sus `src/`.
- Si agregás otro paquete del workspace que se use en tests, añadí su alias para evitar fallas en CI antes de build.

