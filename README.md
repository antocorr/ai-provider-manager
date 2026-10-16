# ai-provider-manager

A TypeScript library that resolves AI provider credentials, model settings, and
access policy for a host application. It decides *which* provider, model, and
credential a given user in a given project should use — it does not call an AI
provider, read environment variables, or implement storage.

- Node.js 18+
- No runtime dependencies
- Storage is supplied by the host through `IStorage`
- The registry cache comes from [models.dev](https://models.dev)

## Install

```bash
npm install ai-provider-manager
```

The package ships ESM only, with type declarations:

```ts
import { PlanManager, PlanManagerError } from 'ai-provider-manager';
import type { IStorage, ResolvedConfig } from 'ai-provider-manager';
```

## Quick start

The host supplies storage and an AI SDK integration. This example uses an
in-memory `IStorage`; a real host persists the same entities.

```ts
import { PlanManager } from 'ai-provider-manager';
import type { IStorage } from 'ai-provider-manager';
import { InMemoryStorage } from './in-memory-storage.js';

const storage: IStorage = new InMemoryStorage();

const planManager = new PlanManager({
    // true → one system provider for the whole installation
    singleProviderSetting: false,
    storage,
    registry: { ttlHours: 24 }, // optional, defaults to 24
    // optional virtual local providers
    localProviders: {
        ollamaLocal: { baseUrl: 'http://127.0.0.1:11434' },
        llamaCppLocal: { baseUrl: 'http://127.0.0.1:8080' },
    },
});

const userId = 'user-1';

// 1. A provider and its credential.
const provider = await planManager.createProviderConfig(userId, {
    npm: '@ai-sdk/openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
});
await planManager.setProviderApiKey(provider.id, userId, process.env.OPENAI_API_KEY!, 'Default');

// 2. A model with provider-specific options.
const model = await planManager.createModelConfig(userId, {
    providerId: provider.id,
    model: 'gpt-4o',
    options: { temperature: 0.2 },
});

// 3. A project that uses the owner's provider.
const project = await planManager.createProjectConfig({
    name: 'Demo',
    ownerId: userId,
    providerConfigAvailability: 'owner',
    currentProviderId: provider.id,
    defaultModelId: model.id,
});

// 4. Resolve the effective configuration.
const cfg = await planManager.getSettings(project.id, userId);
// { npm: '@ai-sdk/openai', model: 'gpt-4o', options: {...}, auth: {...}, apiKey: 'sk-...' }
```

## Architecture

`PlanManager` owns provider policy and configuration resolution. The host owns
every persistence concern through `IStorage`, including the models.dev registry
cache.

**The library owns:**

- provider, model, project, and user-project policy resolution
- provider-auth selection and activation
- registry TTL, network refresh, and stale-cache fallback
- the virtual local providers (`ollama-local`, `llama-cpp-local`) and their
  live model listing

**The host owns:**

- all persistence through `IStorage`
- authentication and authorization before calling mutation methods
- conversion of `ResolvedConfig` into an AI SDK provider
- protection of secrets in `ProviderAuth.data`

## Configuration model

A `ProviderConfig` holds provider metadata such as `npm`, `baseUrl`, `name`, and
the active `currentAuthId`. Credentials live in `ProviderAuth`, not in
`ProviderConfig`.

A provider can have several auth records and one active record.
`createProviderAuth`, `setProviderApiKey`, `setProviderOauthTokens`, and
`setProviderNoAuth` create a record and make it active; `setActiveProviderAuth`
switches the active record.

| `auth.type` | Created by               | Meaning                                              |
| ----------- | ------------------------ | ---------------------------------------------------- |
| `apiKey`    | `setProviderApiKey`      | `data: { key }`; `ResolvedConfig.apiKey` is populated |
| `oauth`     | `setProviderOauthTokens` | `data: { accessToken, refreshToken?, accountId? }`   |
| `none`      | `setProviderNoAuth`      | No credentials required (for example a local daemon) |

`getSettings()` returns the active credential as `ResolvedConfig.auth`, whose
`type` is one of the three above. `ResolvedConfig.apiKey` is only set for
`apiKey` auth. For any other type the host must build its provider from
`auth.data`.

A `ProjectConfig` chooses one provider policy:

| Policy  | Behavior                                                            |
| ------- | ------------------------------------------------------------------- |
| `owner` | The project owner supplies the provider.                            |
| `user`  | Each user supplies their own provider.                              |
| `both`  | The owner's provider is the fallback; users can override it.        |

`userConfigurable` permits a user model override while the provider stays fixed.
`userSelectableProvider` permits a user to choose among the owner's providers.

`UserProjectConfig` stores a user's provider/model override for one project.

## Registry and local providers

The registry source is `https://models.dev/api.json`. `Registry` keeps an
in-memory cache for the process lifetime and persists a `RegistryCache` through
`IStorage`. Lookup order:

1. Fresh in-memory cache
2. Fresh cache from host storage
3. Network refresh
4. Stale in-memory or persisted cache when refresh fails
5. `REGISTRY_UNAVAILABLE` when no cache exists

`getProviders()` always merges the models.dev providers with two virtual
entries, even when models.dev has no cache and is unreachable:

| Provider ID        | `npm`                        | Default base URL          |
| ------------------ | ---------------------------- | ------------------------- |
| `ollama-local`     | `@ai-sdk/ollama`             | `http://127.0.0.1:11434`  |
| `llama-cpp-local`  | `@ai-sdk/openai-compatible`  | `http://127.0.0.1:8080`   |

`getModels()` without a provider ID lists the cloud-only models.dev catalog and
never probes local daemons. An explicit `ollama-local` or `llama-cpp-local` ID
queries the daemon live (`GET {baseUrl}/api/tags` and `GET {baseUrl}/v1/models`),
never uses a cache, and throws `LOCAL_PROVIDER_UNAVAILABLE` (naming the provider
and endpoint) on failure — failing only that explicit query.

## Public API

### Resolution

| Method                          | Returns                          | Description                                                            |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `getSettings(projectId, userId)`| `Promise<ResolvedConfig>`        | Resolve the effective provider, model, and auth.                        |
| `updateRegistry()`              | `Promise<void>`                  | Fetch models.dev, persist it through storage, refresh the memory cache. |
| `getRegistry()`                 | `Promise<RegistryCache>`         | Return the cache, refreshing from the network when stale.               |
| `getProviders()`                | `Promise<Record<string, RegistryProvider>>` | models.dev providers merged with the virtual local providers. |
| `getModels(providerId?)`        | `Promise<(RegistryModel & { providerId: string })[]>` | Cloud catalog, or a live local-daemon query. |

### Provider

`createProviderConfig(userId, data)`, `updateProviderConfig(id, data)`,
`getProviderConfig(id)`, `getProvidersByUser(userId)`, `deleteProviderConfig(id)`

### Provider auth

`createProviderAuth(userId, providerConfigId, data)`,
`updateProviderAuth(id, data)`, `getProviderAuth(id)`,
`getProviderAuthsByProviderConfig(providerConfigId)`,
`getProviderAuthsByUser(userId)`, `deleteProviderAuth(id)`,
`setActiveProviderAuth(providerConfigId, authId)`,
`setProviderApiKey(providerConfigId, userId, apiKey, label?)`,
`setProviderNoAuth(providerConfigId, userId, label?)`,
`setProviderOauthTokens(providerConfigId, userId, tokens, label?)`

### Model

`createModelConfig(userId, data)`, `updateModelConfig(id, data)`,
`getModelConfig(id)`, `getModelsByUser(userId)`, `deleteModelConfig(id)`

### Project and user-project

`createProjectConfig(data)`, `updateProjectConfig(id, data)`,
`getProject(id)`, `deleteProject(id)`, `getOwnerProviders(projectId)`,
`saveUserProjectConfig(projectId, userId, data)`,
`getUserProjectConfig(projectId, userId)`,
`deleteUserProjectConfig(projectId, userId)`

### System provider (`singleProviderSetting: true`)

`saveSystemProvider(data)` and `getSystemProvider()` read and write the
`__system__` provider record.

## `IStorage` contract

The host persists all domain entities and the registry cache. All saves are
upserts by ID; `RegistryCache` is an opaque JSON blob owned by the library and
only read/written through storage.

```ts
interface IStorage {
    // Provider — upsert by id
    saveProviderConfig(config: ProviderConfig): Promise<ProviderConfig>;
    getProviderConfig(id: string): Promise<ProviderConfig | null>;
    getProviderConfigsByUser(userId: string): Promise<ProviderConfig[]>;
    deleteProviderConfig(id: string): Promise<void>;

    // ProviderAuth — upsert by id
    saveProviderAuth(auth: ProviderAuth): Promise<ProviderAuth>;
    getProviderAuth(id: string): Promise<ProviderAuth | null>;
    getProviderAuthsByProviderConfig(providerConfigId: string): Promise<ProviderAuth[]>;
    getProviderAuthsByUser(userId: string): Promise<ProviderAuth[]>;
    deleteProviderAuth(id: string): Promise<void>;

    // Model — upsert by id
    saveModelConfig(config: ModelConfig): Promise<ModelConfig>;
    getModelConfig(id: string): Promise<ModelConfig | null>;
    getModelConfigsByUser(userId: string): Promise<ModelConfig[]>;
    getModelConfigsByProvider(providerId: string): Promise<ModelConfig[]>;
    deleteModelConfig(id: string): Promise<void>;

    // Project — upsert by id
    saveProjectConfig(config: ProjectConfig): Promise<ProjectConfig>;
    getProjectConfig(id: string): Promise<ProjectConfig | null>;
    deleteProjectConfig(id: string): Promise<void>;

    // UserProject — upsert by projectId+userId
    saveUserProjectConfig(config: UserProjectConfig): Promise<UserProjectConfig>;
    getUserProjectConfig(projectId: string, userId: string): Promise<UserProjectConfig | null>;
    deleteUserProjectConfig(projectId: string, userId: string): Promise<void>;

    // Registry cache
    getRegistryCache(): Promise<RegistryCache | null>;
    saveRegistryCache(cache: RegistryCache): Promise<void>;
}
```

## Errors

`PlanManagerError.reason` is one of:

| Reason                       | Raised when                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| `PROJECT_NOT_FOUND`          | The project does not exist or `getOwnerProviders` fails.       |
| `USER_NOT_CONFIGURED`        | A `user` policy project has no `UserProjectConfig` for the user. |
| `PROVIDER_NOT_FOUND`         | The resolved provider record is missing.                       |
| `PROVIDER_AUTH_NOT_FOUND`    | The active auth record is missing or does not belong to the provider. |
| `MODEL_NOT_FOUND`            | The resolved model record (or the required default model ID) is missing. |
| `REGISTRY_UNAVAILABLE`       | The registry is unreachable and no cache exists.               |
| `LOCAL_PROVIDER_UNAVAILABLE` | A live local-daemon query failed.                              |

```ts
try {
    const cfg = await planManager.getSettings(projectId, userId);
} catch (err) {
    if (err instanceof PlanManagerError && err.reason === 'PROVIDER_AUTH_NOT_FOUND') {
        // No credential for the active provider → prompt the user to add one.
    }
    throw err;
}
```

## Host responsibility

After `getSettings()`, the host converts `ResolvedConfig` into its chosen AI SDK
provider. The `auth.type` selects the construction path: `apiKey` uses the key
directly, `oauth` needs a fetch interceptor (URL rewrite plus OAuth headers), and
`none` builds a keyless provider from `baseUrl` (local daemons).

`ProviderAuth.data` contains secrets. Never return it to an untrusted client or
log it.

## Development

```bash
npm install     # devDependencies: tsup, typescript, @types/node
npm run build   # tsup: ESM bundle + type declarations into dist/
npm run dev     # tsup --watch
```

Source layout:

```
src/
├── index.ts               # public exports
├── PlanManager.ts         # resolution + entity CRUD
├── errors.ts              # PlanManagerError + reasons
├── types.ts               # entities, registry, ResolvedConfig, config
├── registry/Registry.ts   # models.dev cache + virtual local providers
└── storage/IStorage.ts    # persistence contract
```

## License

MIT
