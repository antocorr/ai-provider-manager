import { PlanManagerError } from '../errors.js';
import type { IStorage } from '../storage/IStorage.js';
import type {
    LocalProvidersConfig,
    RegistryCache,
    RegistryConfig,
    RegistryModel,
    RegistryProvider,
} from '../types.js';

const REGISTRY_URL = 'https://models.dev/api.json';

const OLLAMA_LOCAL_PROVIDER_ID = 'ollama-local';
const LLAMA_CPP_LOCAL_PROVIDER_ID = 'llama-cpp-local';

const DEFAULT_OLLAMA_LOCAL_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_LLAMA_CPP_LOCAL_BASE_URL = 'http://127.0.0.1:8080';
const LOCAL_PROVIDER_TIMEOUT_MS = 5_000;

// Minimal shapes of the local daemon responses; not part of the public API.
type OllamaLocalTagsResponse = {
    models?: Array<{
        name: string;
        modified_at?: string;
        details?: { family?: string };
    }>;
};

type LlamaCppLocalModelsResponse = {
    data?: Array<{ id: string }>;
};

// Virtual local providers always present in getProviders(), independently of
// the models.dev cache. Fresh objects avoid leaking shared state to callers.
function virtualProviders(): Record<string, RegistryProvider> {
    return {
        [OLLAMA_LOCAL_PROVIDER_ID]: {
            id: OLLAMA_LOCAL_PROVIDER_ID,
            name: 'Ollama (Local)',
            npm: '@ai-sdk/ollama',
            env: [],
            models: {},
        },
        [LLAMA_CPP_LOCAL_PROVIDER_ID]: {
            id: LLAMA_CPP_LOCAL_PROVIDER_ID,
            name: 'Llama.cpp (Local)',
            npm: '@ai-sdk/openai-compatible',
            env: [],
            models: {},
        },
    };
}

export class Registry {
    private readonly storage: IStorage;
    private readonly ttlMs: number;
    private readonly ollamaLocalBaseUrl: string;
    private readonly llamaCppLocalBaseUrl: string;
    private memCache: RegistryCache | null = null;

    constructor(config: RegistryConfig, storage: IStorage, localProviders: LocalProvidersConfig = {}) {
        this.storage = storage;
        this.ttlMs = (config.ttlHours === undefined ? 24 : config.ttlHours) * 60 * 60 * 1000;
        this.ollamaLocalBaseUrl = stripTrailingSlash(
            localProviders.ollamaLocal && localProviders.ollamaLocal.baseUrl !== undefined
                ? localProviders.ollamaLocal.baseUrl
                : DEFAULT_OLLAMA_LOCAL_BASE_URL,
        );
        this.llamaCppLocalBaseUrl = stripTrailingSlash(
            localProviders.llamaCppLocal && localProviders.llamaCppLocal.baseUrl !== undefined
                ? localProviders.llamaCppLocal.baseUrl
                : DEFAULT_LLAMA_CPP_LOCAL_BASE_URL,
        );
    }

    // Fetch models.dev, persist through host storage, and refresh the in-memory cache.
    async update(): Promise<void> {
        const raw = await fetch(REGISTRY_URL);
        if (!raw.ok) throw new Error(`Registry fetch failed: ${raw.status}`);
        const json = await raw.json();
        const cache: RegistryCache = {
            updatedAt: new Date().toISOString(),
            providers: json as RegistryCache['providers'],
        };
        await this.storage.saveRegistryCache(cache);
        this.memCache = cache;
    }

    // Cache lookup order:
    // 1. Fresh in-memory cache.
    // 2. Fresh cache from host storage.
    // 3. Refresh from the network.
    // 4. Stale in-memory or persisted cache when refresh fails.
    // 5. REGISTRY_UNAVAILABLE when no cache exists.
    async get(): Promise<RegistryCache> {
        if (this.memCache && !this.isExpired(this.memCache)) {
            return this.memCache;
        }

        const persisted = await this.storage.getRegistryCache();

        if (persisted && !this.isExpired(persisted)) {
            this.memCache = persisted;
            return persisted;
        }

        // The persisted cache is stale or absent; refresh it.
        try {
            await this.update();
            return this.memCache!;
        } catch {
            // Use stale cache when refresh fails.
            if (this.memCache) return this.memCache;
            if (persisted) {
                this.memCache = persisted;
                return persisted;
            }
            throw new PlanManagerError('REGISTRY_UNAVAILABLE', 'Registry is unavailable and no cached data exists.');
        }
    }

    // models.dev providers merged with the virtual local providers. The virtual
    // entries are always present, even when the registry has no cache and is
    // unreachable.
    async getProviders(): Promise<Record<string, RegistryProvider>> {
        try {
            const cache = await this.get();
            return { ...cache.providers, ...virtualProviders() };
        } catch (err) {
            if (err instanceof PlanManagerError && err.reason === 'REGISTRY_UNAVAILABLE') {
                return virtualProviders();
            }
            throw err;
        }
    }

    // Without a providerId this is the cloud-only listing from models.dev and
    // local daemons are never probed. An explicit virtual providerId probes the
    // local daemon live; these queries never use the registry cache.
    async getModels(providerId?: string): Promise<(RegistryModel & { providerId: string })[]> {
        if (providerId === OLLAMA_LOCAL_PROVIDER_ID) {
            return this.fetchOllamaLocalModels();
        }
        if (providerId === LLAMA_CPP_LOCAL_PROVIDER_ID) {
            return this.fetchLlamaCppLocalModels();
        }

        const cache = await this.get();
        const results: (RegistryModel & { providerId: string })[] = [];
        for (const [pid, provider] of Object.entries(cache.providers)) {
            if (providerId && pid !== providerId) continue;
            for (const model of Object.values(provider.models)) {
                results.push({ ...model, providerId: pid });
            }
        }
        return results;
    }

    private async fetchOllamaLocalModels(): Promise<(RegistryModel & { providerId: string })[]> {
        const url = `${this.ollamaLocalBaseUrl}/api/tags`;
        let raw: Response;
        try {
            raw = await fetch(url, { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) });
        } catch (err) {
            throw this.localProviderError(OLLAMA_LOCAL_PROVIDER_ID, url, err);
        }
        if (!raw.ok) throw this.localProviderError(OLLAMA_LOCAL_PROVIDER_ID, url, undefined, raw.status);
        try {
            const json = (await raw.json()) as OllamaLocalTagsResponse;
            return (json.models || []).map((tag) => ({
                id: tag.name,
                name: tag.name,
                family: tag.details?.family,
                last_updated: tag.modified_at,
                providerId: OLLAMA_LOCAL_PROVIDER_ID,
            }));
        } catch (err) {
            throw this.localProviderError(OLLAMA_LOCAL_PROVIDER_ID, url, err);
        }
    }

    private async fetchLlamaCppLocalModels(): Promise<(RegistryModel & { providerId: string })[]> {
        const url = `${this.llamaCppLocalBaseUrl}/v1/models`;
        let raw: Response;
        try {
            raw = await fetch(url, { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) });
        } catch (err) {
            throw this.localProviderError(LLAMA_CPP_LOCAL_PROVIDER_ID, url, err);
        }
        if (!raw.ok) throw this.localProviderError(LLAMA_CPP_LOCAL_PROVIDER_ID, url, undefined, raw.status);
        try {
            const json = (await raw.json()) as LlamaCppLocalModelsResponse;
            return (json.data || []).map((model) => ({
                id: model.id,
                name: model.id,
                providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
            }));
        } catch (err) {
            throw this.localProviderError(LLAMA_CPP_LOCAL_PROVIDER_ID, url, err);
        }
    }

    // Identifies the virtual provider and endpoint so a daemon failure fails
    // only the explicit local query that triggered it.
    private localProviderError(
        providerId: string,
        url: string,
        cause?: unknown,
        status?: number,
    ): PlanManagerError {
        const detail = status !== undefined ? `HTTP ${status}` : cause instanceof Error ? cause.message : String(cause);
        return new PlanManagerError(
            'LOCAL_PROVIDER_UNAVAILABLE',
            `Local provider "${providerId}" is unreachable at ${url}: ${detail}`,
        );
    }

    private isExpired(cache: RegistryCache): boolean {
        return Date.now() - new Date(cache.updatedAt).getTime() > this.ttlMs;
    }
}

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}
