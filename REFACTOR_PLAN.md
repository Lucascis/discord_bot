# Plan de Refactor Completo - Limpieza de Código Legacy

**Fecha**: 5 de Noviembre, 2025
**Estado**: EN PROGRESO
**Objetivo**: Eliminar TODO el código legacy, tipos `any`, variables no usadas

---

## 📊 Estado Actual

### Errores de Linter Restantes
- **Total**: 742 errores
- **Distribución**:
  - ~300 tipos `any` explícitos
  - ~200 variables/argumentos no usados
  - ~150 imports no usados
  - ~92 otros (lexical declarations, empty interfaces, etc.)

### Compilación TypeScript
- ✅ **0 errores** - El código compila perfectamente
- ✅ **185 tests pasando**
- ✅ **88% coverage**
- ✅ **Docker build exitoso**

**Conclusión**: Los errores de linter son **deuda técnica de calidad**, no bugs funcionales.

---

## 🎯 Estrategia de Refactor

### Fase 1: Automatización (COMPLETADO)
- [x] Script de fix automático creado (`scripts/fix-linter.js`)
- [x] Mass refactor script creado (`scripts/mass-refactor.sh`)
- [x] Catch blocks sin errores no usados corregidos

### Fase 2: Corrección Manual por Capas (EN PROGRESO)

#### 2.1 Audio Service (Prioridad ALTA)
**Archivos**:
- `audio/src/services/search-optimizer.ts` ✅ COMPLETADO
  - Tipos `Player` y `SearchResult` agregados
  - Parámetro `cached` marcado como no usado
- `audio/src/services/search-prewarmer.ts` ✅ COMPLETADO
  - Catch blocks corregidos

**Pendientes**:
- Ninguno en audio service

#### 2.2 Gateway - Use Cases (Prioridad ALTA)
**Archivos críticos**:
1. `gateway/src/application/use-cases/audio-quality-management-use-case.ts`
   - 14 errores (tipos `any`, variables no usadas)
2. `gateway/src/application/use-cases/billing-management-use-case.ts`
   - 19 errores (tipos `any`, variables no usadas)
3. `gateway/src/application/use-cases/premium-feature-management-use-case.ts`
   - 10 errores (variables no usadas)

**Acciones necesarias**:
```typescript
// Patrón a seguir para corrección:

// ANTES (❌)
async function example(userId: string, data: any) {
  try {
    // código
  } catch (error) {
    // no se usa error
  }
}

// DESPUÉS (✅)
async function example(userId: string, data: SpecificType) {
  try {
    // código
  } catch {
    // sin parámetro si no se usa
  }
}
```

#### 2.3 Gateway - Domain Entities (Prioridad MEDIA)
**Archivos**:
1. `gateway/src/domain/entities/customer.ts`
   - 2 errores (tipo `any`, argumento no usado)
2. `gateway/src/domain/entities/feature-subscription.ts`
   - 4 errores (import no usado, tipo `any`)
3. `gateway/src/domain/entities/payment-plan.ts`
   - 6 errores (import no usado, tipos `any`)
4. `gateway/src/domain/entities/usage-analytics.ts`
   - 5 errores (import no usado, tipos `any`)

#### 2.4 Gateway - Domain Services (Prioridad MEDIA)
**Archivos**:
1. `gateway/src/domain/services/audio-quality-domain-service.ts`
   - 10 errores (imports no usados, tipos `any`)
2. `gateway/src/domain/services/billing-domain-service.ts`
   - 4 errores (imports no usados, variables no usadas)
3. `gateway/src/domain/services/feature-access-domain-service.ts`
   - 4 errores (imports no usados)
4. `gateway/src/domain/services/subscription-domain-service.ts`
   - 1 error (import no usado)
5. `gateway/src/domain/services/usage-quota-domain-service.ts`
   - 3 errores (imports no usados)

#### 2.5 Gateway - Infrastructure (Prioridad BAJA)
**Archivos**:
1. `gateway/src/infrastructure/analytics/premium-analytics-service.ts`
   - 21 errores (tipos `any`, variables no usadas)
2. `gateway/src/infrastructure/database/prisma-guild-settings-repository.ts`
   - 1 error (variable no usada)
3. `gateway/src/infrastructure/dependency-injection/container.ts`
   - 4 errores (tipos `any`, require imports)
4. `gateway/src/infrastructure/discord/discord-audio-service.ts`
   - 7 errores (tipos `any`)
5. Otros archivos de infraestructura con errores menores

#### 2.6 API Service (Prioridad BAJA)
- 1 warning en tests (mockGuildSettings no usado)

---

## 🔧 Patrones de Corrección

### 1. Tipos `any` → Tipos Específicos

```typescript
// ❌ ANTES
function process(data: any): any {
  return data.value;
}

// ✅ DESPUÉS - Opción 1: Tipo específico
interface ProcessData {
  value: string;
}
function process(data: ProcessData): string {
  return data.value;
}

// ✅ DESPUÉS - Opción 2: Genérico si es reutilizable
function process<T extends { value: string }>(data: T): string {
  return data.value;
}

// ✅ DESPUÉS - Opción 3: unknown si realmente desconocido
function process(data: unknown): unknown {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as { value: string }).value;
  }
  return undefined;
}
```

### 2. Variables No Usadas

```typescript
// ❌ ANTES
import { Foo, Bar, Baz } from './types';  // Bar no se usa

function example(userId: string, guildId: string) {  // guildId no se usa
  return userId;
}

// ✅ DESPUÉS
import { Foo, Baz } from './types';  // Solo lo que se usa

function example(userId: string, _guildId: string) {  // Prefijo _ si es necesario para firma
  return userId;
}

// O mejor aún, si el parámetro no es necesario:
function example(userId: string) {
  return userId;
}
```

### 3. Argumentos de Funciones No Usados

```typescript
// ❌ ANTES
array.map((item, index) => item.value)  // index no se usa

// ✅ DESPUÉS
array.map((item) => item.value)

// O si el segundo parámetro es necesario para la firma pero no se usa:
array.map((item, _index) => item.value)
```

### 4. Catch Blocks

```typescript
// ❌ ANTES
try {
  // código
} catch (error) {
  // error definido pero no usado
  logger.warn('Failed');
}

// ✅ DESPUÉS - Sin parámetro si no se usa
try {
  // código
} catch {
  logger.warn('Failed');
}

// ✅ O usar el error correctamente
try {
  // código
} catch (error) {
  logger.warn({ error }, 'Failed');
}
```

### 5. Empty Interfaces

```typescript
// ❌ ANTES
interface EmptyConfig extends BaseConfig {
  // vacío
}

// ✅ DESPUÉS - Type alias
type EmptyConfig = BaseConfig;

// O agregar al menos un miembro
interface EmptyConfig extends BaseConfig {
  __brand?: 'EmptyConfig';  // Nominal typing si es necesario
}
```

### 6. Lexical Declarations in Case

```typescript
// ❌ ANTES
switch (type) {
  case 'A':
    const value = processA();
    break;
  case 'B':
    const value = processB();  // Error: redeclaración
    break;
}

// ✅ DESPUÉS - Bloques con llaves
switch (type) {
  case 'A': {
    const value = processA();
    break;
  }
  case 'B': {
    const value = processB();
    break;
  }
}
```

---

## 📋 Plan de Ejecución

### Sprint 1: Audio Service (0.5 horas) ✅ COMPLETADO
- [x] search-optimizer.ts
- [x] search-prewarmer.ts

### Sprint 2: Gateway Use Cases (2 horas)
- [ ] audio-quality-management-use-case.ts
- [ ] billing-management-use-case.ts
- [ ] premium-feature-management-use-case.ts
- [ ] subscription-management-use-case.ts
- [ ] Otros use-cases menores

### Sprint 3: Gateway Domain (1.5 horas)
- [ ] Entities (Customer, PaymentPlan, etc.)
- [ ] Aggregates
- [ ] Domain Services

### Sprint 4: Gateway Infrastructure (1 hora)
- [ ] Analytics
- [ ] Database repositories
- [ ] DI Container
- [ ] Discord services

### Sprint 5: Verificación Final (0.5 horas)
- [ ] Run linter completo - verificar 0 errores
- [ ] Run tests - verificar 100% passing
- [ ] Build Docker - verificar exitoso
- [ ] Update documentación

---

## 🎯 Metas de Calidad

### Objetivo Final
- ✅ **0 errores de linter**
- ✅ **0 warnings de linter**
- ✅ **0 tipos `any`** (except donde absolutamente necesario con comentario explicativo)
- ✅ **0 variables no usadas**
- ✅ **0 imports no usados**

### Estándares de Código
- Todo tipo `any` debe ser reemplazado por tipo específico, genérico o `unknown`
- Todo parámetro no usado debe ser removido o prefijado con `_`
- Todo import no usado debe ser eliminado
- Todo catch block sin uso de error debe omitir el parámetro
- Todas las interfaces vacías deben ser reemplazadas por type aliases

---

## 📚 Referencias

### TypeScript Best Practices
- [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Effective TypeScript](https://effectivetypescript.com/)

### ESLint Rules
- [@typescript-eslint/no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any)
- [@typescript-eslint/no-unused-vars](https://typescript-eslint.io/rules/no-unused-vars)

---

## 🔄 Progreso Tracking

### Commits
1. **Initial TypeScript fixes** - TypeScript path mappings corregidos
2. **Audio service refactor** - search-optimizer y search-prewarmer limpios
3. **[NEXT]** Gateway use-cases refactor
4. **[NEXT]** Gateway domain refactor
5. **[NEXT]** Gateway infrastructure refactor
6. **[FINAL]** Zero linter errors - Production ready

### Tiempo Estimado Total
- **Completado**: 0.5 horas
- **Restante**: 5 horas
- **Total**: 5.5 horas

---

**Última actualización**: 5 de Noviembre, 2025 - Fase 1 completada, Fase 2 en progreso
